"use strict";
/* PSE · 渲染层 (render.js) —— 真实地理多边形地图
 * · Web Mercator 投影 + 摄像机（缩放/平移），按视口裁剪绘制
 * · 图层：political / terrain / supply(管网图) / front(战线折线) / air(空域) / naval(海区+航线) / resistance
 * · 非方块表现：补给=枢纽节点+线路（粗细=运力，颜色=负载），前线=战线折线，海空=区域叠加
 */
(function (root) {
    'use strict';
    const PSE = (root.PSE = root.PSE || {});
    const R = (PSE.Render = {});
    const MD = PSE.MapData;
    const SEA_DEEP = '#0e2233';
    const SEA_SHALLOW = '#173a54';
    const TERRAIN_COLOR = {
        plain: '#93ac6e', hills: '#a89a5e', forest: '#4e7a49', mountain: '#8a8073',
        desert: '#d9c68d', marsh: '#6e8a6a', tundra: '#b9c4c9',
    };
    const TERRAIN_NAME = {
        plain: '平原', hills: '丘陵', forest: '森林', mountain: '山地',
        desert: '沙漠', marsh: '沼泽', tundra: '苔原',
    };
    const LAYERS = ['political', 'terrain', 'supply', 'front', 'air', 'naval', 'resistance'];
    const LAYER_NAME = {
        political: '政治', terrain: '地形', supply: '补给网络', front: '战线',
        air: '空域与制空', naval: '海区与航线', resistance: '占领抵抗',
    };
    R.LAYERS = LAYERS;
    R.LAYER_NAME = LAYER_NAME;
    R.TERRAIN_NAME = TERRAIN_NAME;
    R.init = function (canvas, game) {
        R.canvas = canvas;
        R.ctx = canvas.getContext('2d');
        R.game = game;
        R.layer = 'political';
        R.cam = { x: 0.52, y: 0.34, zoom: 3.2 }; // 归一化中心 + 缩放（1 = 全球充满）
        R.hover = null;
        R.selectedProv = null;
        R.showLabels = true;
        R.resize();
        if (root.addEventListener)
            root.addEventListener('resize', R.resize);
        // 视口变化兜底：旋转 / 分屏 / MIUI 不触发 window resize 的场景，靠 ResizeObserver 重算画布
        if (root.ResizeObserver && canvas.parentElement) {
            let lastW = 0, lastH = 0;
            const ro = new root.ResizeObserver(() => {
                if (canvas.clientWidth !== lastW || canvas.clientHeight !== lastH) {
                    lastW = canvas.clientWidth;
                    lastH = canvas.clientHeight;
                    R.resize();
                }
            });
            ro.observe(canvas.parentElement);
        }
    };
    // 重算画布尺寸。给 canvas.width/height 赋值会清空画布并重置 2D 上下文，
    // 因此：① 尺寸没变就绝不赋值（避免无谓清空）；② 一旦赋值就在同一个任务里同步补画一帧，
    // 保证画布不会停留在"已清空、还没重绘"的空白态（屏幕截图/切换窗口会看到空白帧或残影）。
    R.resize = function () {
        const c = R.canvas;
        if (!c)
            return;
        const dpr = Math.min(2, root.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(c.clientWidth || 1200));
        const h = Math.max(1, Math.round(c.clientHeight || 800));
        R.dpr = dpr;
        R.vw = w;
        R.vh = h;
        const pw = Math.floor(w * dpr), ph = Math.floor(h * dpr);
        if (c.width === pw && c.height === ph)
            return; // 尺寸未变：不要赋值
        c.width = pw;
        c.height = ph;
        if (R._syncing || !R.game || !R.game.world)
            return; // 绘制中由本帧负责；世界未建则无需补画
        R._syncing = true;
        try {
            R.draw(0);
        }
        catch (e) {
            if (root.console)
                root.console.error('resize 后同步重绘失败', e);
        }
        finally {
            R._syncing = false;
        }
    };
    // ---------- 坐标变换 ----------
    function viewScale() {
        const base = Math.min(R.vw, R.vh * 1.6);
        return base * R.cam.zoom;
    }
    R.lonLatToScreen = function (lon, lat) {
        const p = MD.project(lon, lat);
        const s = viewScale();
        const cx = R.cam.x * s, cy = R.cam.y * s;
        return [R.vw / 2 + (p[0] * s - cx), R.vh / 2 + (p[1] * s - cy)];
    };
    R.screenToLonLat = function (px, py) {
        const s = viewScale();
        const cx = R.cam.x * s, cy = R.cam.y * s;
        const nx = (px - R.vw / 2 + cx) / s;
        const ny = (py - R.vh / 2 + cy) / s;
        return MD.unproject(nx, ny);
    };
    R.pan = function (dxPx, dyPx) {
        const s = viewScale();
        R.cam.x -= dxPx / s;
        R.cam.y -= dyPx / s;
        clampCam();
    };
    R.zoomAt = function (px, py, factor) {
        const before = R.screenToLonLat(px, py);
        R.cam.zoom = Math.max(1.2, Math.min(60, R.cam.zoom * factor));
        const after = R.screenToLonLat(px, py);
        const d = MD.project(before[0], before[1]);
        const e = MD.project(after[0], after[1]);
        R.cam.x += d[0] - e[0];
        R.cam.y += d[1] - e[1];
        clampCam();
    };
    function clampCam() {
        R.cam.x = Math.max(0, Math.min(1, R.cam.x));
        R.cam.y = Math.max(0, Math.min(1, R.cam.y));
    }
    R.centerOn = function (lon, lat, zoom) {
        const p = MD.project(lon, lat);
        R.cam.x = p[0];
        R.cam.y = p[1];
        if (zoom)
            R.cam.zoom = zoom;
        clampCam();
    };
    R.setLayer = function (l) { R.layer = l; };
    // ---------- 颜色 ----------
    function shade(hex, f) {
        if (!hex || hex[0] !== '#')
            return hex || '#888';
        const c = hex.slice(1);
        const r = Math.min(255, Math.round(parseInt(c.slice(0, 2), 16) * f));
        const g = Math.min(255, Math.round(parseInt(c.slice(2, 4), 16) * f));
        const b = Math.min(255, Math.round(parseInt(c.slice(4, 6), 16) * f));
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
    R.shade = shade;
    function supplyColor(v) {
        if (v >= 0.9)
            return '#4caf50';
        if (v >= 0.6)
            return '#c9b037';
        if (v > 0)
            return '#e08a2a';
        return '#d3402f';
    }
    // ---------- 视口裁剪 ----------
    function visibleBox() {
        const a = R.screenToLonLat(-80, -80);
        const b = R.screenToLonLat(R.vw + 80, R.vh + 80);
        const lon0 = Math.min(a[0], b[0]), lon1 = Math.max(a[0], b[0]);
        const lat0 = Math.min(a[1], b[1]), lat1 = Math.max(a[1], b[1]);
        return { lon0, lon1, lat0, lat1 };
    }
    function provVisible(p, vb) {
        return !(p._maxLon < vb.lon0 || p._minLon > vb.lon1 || p._maxLat < vb.lat0 || p._minLat > vb.lat1);
    }
    // ============================================================
    // 主绘制
    // ============================================================
    R.draw = function (dt) {
        const g = R.game, w = g.world, ctx = R.ctx;
        if (!w)
            return;
        // 自检：backing store 与视口/dpr 不一致（例如上一次 resize 被跳过）时先补齐尺寸，本帧随后整幅重绘
        const cvs = R.canvas;
        if (cvs && !R._syncing) {
            const d = R.dpr || 1;
            if (cvs.width !== Math.floor(R.vw * d) || cvs.height !== Math.floor(R.vh * d))
                R.resize();
        }
        const t0 = (root.performance || Date).now();
        ctx.setTransform(R.dpr || 1, 0, 0, R.dpr || 1, 0, 0);
        const layer = R.layer || 'political';
        const vb = visibleBox();
        // 海洋背景（按纬度渐变）
        const grad = ctx.createLinearGradient(0, 0, 0, R.vh);
        grad.addColorStop(0, SEA_DEEP);
        grad.addColorStop(0.5, '#12314a');
        grad.addColorStop(1, SEA_DEEP);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, R.vw, R.vh);
        // 海区叠加（naval / air 图层）
        if (layer === 'naval' || layer === 'air')
            drawSeaZones(ctx, w, layer);
        // 陆地
        for (const p of w.provinces) {
            if (p._maxLon === undefined)
                computeBounds(p);
            if (!provVisible(p, vb))
                continue;
            ctx.beginPath();
            pathProvince(ctx, p);
            ctx.fillStyle = provinceFill(w, p, layer);
            ctx.fill();
        }
        // 省界 / 国界
        const lineW = Math.max(0.4, 0.9 / Math.sqrt(R.cam.zoom / 3));
        ctx.lineWidth = lineW;
        ctx.strokeStyle = 'rgba(0,0,0,0.30)';
        for (const p of w.provinces) {
            if (!provVisible(p, vb))
                continue;
            ctx.beginPath();
            pathProvince(ctx, p);
            ctx.stroke();
        }
        ctx.lineWidth = Math.max(0.9, 1.8 / Math.sqrt(R.cam.zoom / 3));
        ctx.strokeStyle = 'rgba(8,12,16,0.85)';
        for (const p of w.provinces) {
            if (!provVisible(p, vb))
                continue;
            const be = p.borderEdges;
            if (!be || !be.length)
                continue;
            ctx.beginPath();
            for (const [i, j] of be) {
                const a = p.poly[i], b2 = p.poly[j];
                if (!a || !b2)
                    continue;
                const [ax, ay] = R.lonLatToScreen(a[0], a[1]);
                const [bx, by] = R.lonLatToScreen(b2[0], b2[1]);
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
            }
            ctx.stroke();
        }
        // 图层专有叠加
        if (layer === 'supply')
            drawSupplyNetwork(ctx, w, vb);
        if (layer === 'front')
            drawFrontLines(ctx, w, vb);
        if (layer === 'resistance')
            drawResistanceOverlay(ctx, w, vb);
        if (layer === 'air')
            drawAirZones(ctx, w, vb);
        if (layer === 'naval')
            drawNavalRoutes(ctx, w, vb);
        // 战略轰炸/核爆痕迹
        if (w.nukeMarks) {
            for (const m of w.nukeMarks) {
                const [sx, sy] = R.lonLatToScreen(m.lon, m.lat);
                const rr = 18 * Math.max(0.5, R.cam.zoom / 6);
                const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
                gr.addColorStop(0, 'rgba(255,220,120,0.85)');
                gr.addColorStop(1, 'rgba(255,80,40,0)');
                ctx.fillStyle = gr;
                ctx.beginPath();
                ctx.arc(sx, sy, rr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        // 城市
        ctx.textAlign = 'center';
        for (const p of w.provinces) {
            if (!p.vp || !provVisible(p, vb))
                continue;
            const [sx, sy] = R.lonLatToScreen(p.cx, p.cy);
            const r = p.isCapital ? 3.4 : 2.2;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fillStyle = p.isCapital ? '#fff' : '#e8e8e8';
            ctx.fill();
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 0.8;
            ctx.stroke();
            if (R.showLabels && (R.cam.zoom > 4 || p.isCapital)) {
                ctx.font = (p.isCapital ? 'bold ' : '') + Math.max(8, Math.min(13, 8 + R.cam.zoom / 4)) + 'px system-ui, sans-serif';
                const tw = ctx.measureText(p.name).width;
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(sx - tw / 2 - 2, sy + 4, tw + 4, 12);
                ctx.fillStyle = '#fff';
                ctx.fillText(p.name, sx, sy + 13);
            }
        }
        // 部队
        drawUnits(ctx, w, vb);
        // 战斗
        for (const b of w.battles) {
            const p = w.provinces[b.prov];
            if (!p)
                continue;
            const [sx, sy] = R.lonLatToScreen(p.cx, p.cy);
            const pulse = 0.55 + 0.45 * Math.abs(Math.sin(((root.performance || Date).now() % 1100) / 1100 * Math.PI));
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = '#ff4b3a';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(sx, sy, 12 * Math.max(1, R.cam.zoom / 6), 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            ctx.font = 'bold 11px system-ui, sans-serif';
            ctx.fillStyle = '#ff8b7a';
            ctx.fillText('⚔ ' + b.atk.length + 'v' + b.def.length, sx, sy - 14);
            if (b.engaged) {
                ctx.fillStyle = '#ffd24a';
                ctx.font = '10px system-ui, sans-serif';
                ctx.fillText('宽度 ' + b.engaged.atk + '/' + b.engaged.def, sx, sy + 22);
            }
        }
        // 选中 / 悬停
        if (R.hover != null)
            strokeProvince(ctx, w.provinces[R.hover], 'rgba(255,255,255,0.85)', 2);
        if (R.selectedProv != null)
            strokeProvince(ctx, w.provinces[R.selectedProv], '#ffd24a', 2.5);
        R.lastFrameMs = (root.performance || Date).now() - t0;
    };
    function computeBounds(p) {
        let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
        for (const v of p.poly) {
            if (v[0] < a)
                a = v[0];
            if (v[0] > c)
                c = v[0];
            if (v[1] < b)
                b = v[1];
            if (v[1] > d)
                d = v[1];
        }
        p._minLon = a;
        p._minLat = b;
        p._maxLon = c;
        p._maxLat = d;
    }
    function pathProvince(ctx, p) {
        const poly = p.poly;
        for (let i = 0; i < poly.length; i++) {
            const [sx, sy] = R.lonLatToScreen(poly[i][0], poly[i][1]);
            if (i === 0)
                ctx.moveTo(sx, sy);
            else
                ctx.lineTo(sx, sy);
        }
        ctx.closePath();
    }
    function strokeProvince(ctx, p, color, lw) {
        if (!p)
            return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        pathProvince(ctx, p);
        ctx.stroke();
    }
    function provinceFill(w, p, layer) {
        const ctrl = w.countries[p.controller];
        switch (layer) {
            case 'terrain': return TERRAIN_COLOR[p.terrain] || '#93ac6e';
            case 'resistance':
                if (p.controller !== p.owner) {
                    const r = Math.min(100, p.resistance || 0) / 100;
                    return 'rgb(' + Math.round(90 + r * 150) + ',' + Math.round(150 - r * 90) + ',80)';
                }
                return ctrl ? shade(ctrl.color, 0.5) : '#666';
            case 'supply':
            case 'front':
            case 'air':
            case 'naval':
                // 这些图层用"网络/线条"表达，陆地只保留低饱和底色
                return ctrl ? shade(ctrl.color, 0.42) : '#555';
            default: {
                if (!ctrl)
                    return '#666';
                if (p.controller !== p.owner)
                    return shade(ctrl.color, 0.68);
                return ctrl.color;
            }
        }
    }
    // ============================================================
    // 补给网络图层：枢纽节点 + 线路（非方块）
    // ============================================================
    function drawSupplyNetwork(ctx, w, vb) {
        // 1) 干线：相邻省之间的补给流，粗细=流量，颜色=两端供给水平
        for (const p of w.provinces) {
            if (!provVisible(p, vb))
                continue;
            for (const nb of p.neighbors) {
                const q = w.provinces[nb];
                if (!q || q.id < p.id)
                    continue;
                if (q.controller !== p.controller)
                    continue; // 只管本国管网
                const lvl = Math.max(p.supply, q.supply);
                if (lvl <= 0.02)
                    continue;
                const [ax, ay] = R.lonLatToScreen(p.cx, p.cy);
                const [bx, by] = R.lonLatToScreen(q.cx, q.cy);
                ctx.strokeStyle = supplyColor(lvl);
                ctx.globalAlpha = 0.30 + 0.55 * lvl;
                ctx.lineWidth = Math.max(0.7, (0.8 + 2.2 * lvl) * Math.min(2.2, R.cam.zoom / 5));
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
        // 2) 补给枢纽（首都/港口/工业城市）
        for (const p of w.provinces) {
            if (!provVisible(p, vb))
                continue;
            const isHub = p.isCapital || p.isPort || (p.buildings && (p.buildings.civ >= 2 || p.buildings.mil >= 2));
            if (!isHub)
                continue;
            const [sx, sy] = R.lonLatToScreen(p.cx, p.cy);
            const r = (p.isCapital ? 5 : 3.4) * Math.min(1.8, Math.max(0.8, R.cam.zoom / 6));
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fillStyle = p.isCapital ? '#ffd24a' : '#7fd0ff';
            ctx.fill();
            ctx.strokeStyle = '#0b1420';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            if (R.cam.zoom > 5 || p.isCapital) {
                ctx.fillStyle = '#cfe8ff';
                ctx.font = '10px system-ui, sans-serif';
                ctx.fillText('补给 ' + Math.round(p.supply * 100) + '%', sx, sy - r - 3);
            }
        }
        // 3) 断供省（斜线阴影，不用色块）
        ctx.save();
        ctx.strokeStyle = 'rgba(255,70,50,0.75)';
        ctx.lineWidth = 1.6;
        for (const p of w.provinces) {
            if (!provVisible(p, vb))
                continue;
            if (p.supply > 0 || p.controller === p.owner)
                continue;
            hatchProvince(ctx, p);
        }
        ctx.restore();
        // 4) 铁路/基建等级图例
        const legend = [['≥90% 充足', '#4caf50'], ['≥60% 受限', '#c9b037'], ['>0 匮乏', '#e08a2a'], ['=0 断供', '#d3402f']];
        drawLegend(ctx, '补给管网', legend, '线宽=流量，节点=枢纽');
    }
    function hatchProvince(ctx, p) {
        ctx.save();
        ctx.beginPath();
        pathProvince(ctx, p);
        ctx.clip();
        const [x0, y0] = R.lonLatToScreen(p._minLon, p._maxLat);
        const [x1, y1] = R.lonLatToScreen(p._maxLon, p._minLat);
        for (let x = x0; x < x1 + (y1 - y0); x += 7) {
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x - (y1 - y0), y1);
            ctx.stroke();
        }
        ctx.restore();
    }
    function drawLegend(ctx, title, items, note) {
        ctx.save();
        ctx.font = '11px system-ui, sans-serif';
        const h = 20 + items.length * 15 + (note ? 14 : 0);
        ctx.fillStyle = 'rgba(12,18,26,0.82)';
        ctx.fillRect(10, R.vh - h - 12, 190, h);
        ctx.strokeStyle = '#2c3a4a';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, R.vh - h - 12, 190, h);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.fillText(title, 20, R.vh - h + 2);
        items.forEach((it, i) => {
            const y = R.vh - h + 19 + i * 15;
            ctx.fillStyle = it[1];
            ctx.fillRect(20, y - 8, 12, 8);
            ctx.fillStyle = '#cfd8e3';
            ctx.fillText(it[0], 38, y);
        });
        if (note) {
            ctx.fillStyle = '#7f8fa3';
            ctx.fillText(note, 20, R.vh - h + 19 + items.length * 15);
        }
        ctx.restore();
    }
    // ============================================================
    // 战线图层：折线表示接触线，箭头表示进攻方向
    // ============================================================
    function drawFrontLines(ctx, w, vb) {
        const segs = [];
        for (const p of w.provinces) {
            if (!provVisible(p, vb))
                continue;
            for (const nb of p.neighbors) {
                const q = w.provinces[nb];
                if (!q || q.id < p.id)
                    continue;
                if (!PSE.World.areAtWar(w, p.controller, q.controller))
                    continue;
                segs.push([p, q]);
            }
        }
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = Math.max(1.6, 3.2 * Math.min(1.6, R.cam.zoom / 5));
        for (const [p, q] of segs) {
            const [ax, ay] = R.lonLatToScreen(p.cx, p.cy);
            const [bx, by] = R.lonLatToScreen(q.cx, q.cy);
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            const dx = bx - ax, dy = by - ay;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len, ny = dx / len;
            ctx.beginPath();
            ctx.moveTo(mx - nx * len * 0.3, my - ny * len * 0.3);
            ctx.lineTo(mx + nx * len * 0.3, my + ny * len * 0.3);
            ctx.stroke();
        }
        // 进攻箭头
        for (const b of w.battles) {
            const p = w.provinces[b.prov];
            if (!p || !b.atkTag)
                continue;
            const src = w.divisions.find((d) => d.tag === b.atkTag && d.loc !== b.prov);
            if (!src)
                continue;
            const s = w.provinces[src.loc];
            if (!s)
                continue;
            const [ax, ay] = R.lonLatToScreen(s.cx, s.cy);
            const [bx, by] = R.lonLatToScreen(p.cx, p.cy);
            const ang = Math.atan2(by - ay, bx - ax);
            const L = Math.hypot(bx - ax, by - ay) * 0.55;
            ctx.strokeStyle = '#ff6b52';
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax + Math.cos(ang) * L, ay + Math.sin(ang) * L);
            ctx.stroke();
            const hx = ax + Math.cos(ang) * L, hy = ay + Math.sin(ang) * L;
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(hx - Math.cos(ang - 0.4) * 9, hy - Math.sin(ang - 0.4) * 9);
            ctx.lineTo(hx - Math.cos(ang + 0.4) * 9, hy - Math.sin(ang + 0.4) * 9);
            ctx.closePath();
            ctx.fillStyle = '#ff6b52';
            ctx.fill();
        }
        const nWar = w.wars.length;
        drawLegend(ctx, '战线图', [[nWar + ' 场战争', '#ffd24a'], ['黄线=接触线', '#ffd24a'], ['红箭头=进攻', '#ff6b52']], '交战省份会显示战斗圈');
    }
    // ============================================================
    // 海区与航线
    // ============================================================
    function drawSeaZones(ctx, w, layer) {
        ctx.save();
        for (const z of MD.seaZones) {
            const [cx, cy] = R.lonLatToScreen(z.cx, z.cy);
            const [x0, y0] = R.lonLatToScreen(z.cx - z.rx, z.cy + z.ry);
            const [x1, y1] = R.lonLatToScreen(z.cx + z.rx, z.cy - z.ry);
            const power = seaZonePower(w, z.id);
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = power > 0.2 ? 'rgba(90,160,255,0.20)' : power < -0.2 ? 'rgba(255,90,90,0.20)' : 'rgba(200,200,200,0.10)';
            ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = '#4f7fa8';
            ctx.setLineDash([6, 6]);
            ctx.lineWidth = 1;
            ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            ctx.setLineDash([]);
            ctx.fillStyle = '#9dc4e8';
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            if (R.cam.zoom > 2.2)
                ctx.fillText(z.name, cx, cy);
            if (layer === 'naval') {
                const fleets = [];
                for (const t in w.countries) {
                    const c = w.countries[t];
                    if (!c.fleets)
                        continue;
                    for (const f of c.fleets)
                        if (f.zone === z.id && f.ships > 0)
                            fleets.push(t + '×' + f.ships);
                }
                if (fleets.length) {
                    ctx.fillStyle = '#ffd24a';
                    ctx.font = '10px system-ui, sans-serif';
                    ctx.fillText(fleets.slice(0, 4).join(' '), cx, cy + 14);
                }
            }
        }
        ctx.restore();
    }
    function seaZonePower(w, zoneId) {
        let mine = 0, foe = 0;
        for (const t in w.countries) {
            const c = w.countries[t];
            if (!c.fleets)
                continue;
            for (const f of c.fleets)
                if (f.zone === zoneId)
                    mine += 0;
        }
        // 简化：以玩家与主要交战方在该海区的舰船总吨位对比
        const player = w.countries[w.playerTag];
        if (!player)
            return 0;
        for (const f of (player.fleets || []))
            if (f.zone === zoneId)
                mine += f.ships;
        for (const e of PSE.World.enemiesOf(w, w.playerTag)) {
            const c = w.countries[e];
            if (!c)
                continue;
            for (const f of (c.fleets || []))
                if (f.zone === zoneId)
                    foe += f.ships;
        }
        const tot = mine + foe;
        return tot ? (mine - foe) / tot : 0;
    }
    function drawNavalRoutes(ctx, w, vb) {
        // 贸易航线：从出口国首都到进口国首都的虚线（穿越海区）
        ctx.save();
        ctx.setLineDash([5, 5]);
        for (const t in w.countries) {
            const c = w.countries[t];
            if (!c.trades)
                continue;
            const cap = w.provinces[c.capital];
            if (!cap)
                continue;
            for (const tr of c.trades) {
                const pc = w.countries[tr.partner];
                if (!pc)
                    continue;
                const pcap = w.provinces[pc.capital];
                if (!pcap)
                    continue;
                const [ax, ay] = R.lonLatToScreen(cap.cx, cap.cy);
                const [bx, by] = R.lonLatToScreen(pcap.cx, pcap.cy);
                const risk = (tr.risk || 0);
                ctx.strokeStyle = risk > 0.3 ? 'rgba(255,90,70,0.7)' : 'rgba(120,220,150,0.55)';
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
            }
        }
        ctx.restore();
        drawLegend(ctx, '海区与航线', [['蓝=我方控制', 'rgba(90,160,255,0.6)'], ['红=敌方控制', 'rgba(255,90,90,0.6)'], ['虚线=贸易航线', '#78dc96']], '舰队可派往海区执行任务');
    }
    function drawAirZones(ctx, w, vb) {
        ctx.save();
        for (const t in w.countries) {
            const c = w.countries[t];
            if (!c.airWings)
                continue;
            for (const wing of c.airWings) {
                const p = w.provinces[wing.loc];
                if (!p || wing.count <= 0)
                    continue;
                const [sx, sy] = R.lonLatToScreen(p.cx, p.cy);
                const r = Math.max(14, 40 * Math.min(2, R.cam.zoom / 5));
                const isPlayer = (t === w.playerTag);
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
                ctx.fillStyle = isPlayer ? 'rgba(90,180,255,0.13)' : 'rgba(255,120,90,0.10)';
                ctx.fill();
                ctx.strokeStyle = isPlayer ? 'rgba(120,200,255,0.5)' : 'rgba(255,120,90,0.4)';
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#dbe9f5';
                ctx.font = '10px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText((wing.type === 'fighter' ? '✈' : wing.type === 'cas' ? '🛩' : '✈✈') + wing.count, sx, sy - 3);
                ctx.fillText(PSE.AIR_MISSION_NAME[wing.mission] || '', sx, sy + 10);
            }
        }
        ctx.restore();
        const legend = [['战斗机', '#78c8ff'], ['近距支援', '#ffc86b'], ['战术/战略轰炸', '#ff9a7a']];
        drawLegend(ctx, '空域与制空', legend, '圆圈=联队航程，制空权影响战斗');
    }
    function drawResistanceOverlay(ctx, w, vb) {
        ctx.save();
        for (const p of w.provinces) {
            if (!provVisible(p, vb))
                continue;
            if (p.controller === p.owner)
                continue;
            const r = Math.min(100, p.resistance || 0);
            const [sx, sy] = R.lonLatToScreen(p.cx, p.cy);
            ctx.beginPath();
            ctx.arc(sx, sy, 3 + r * 0.12, 0, Math.PI * 2);
            ctx.fillStyle = r > 60 ? 'rgba(255,60,50,0.75)' : r > 30 ? 'rgba(255,150,50,0.7)' : 'rgba(255,220,120,0.6)';
            ctx.fill();
            if (r > 30) {
                ctx.fillStyle = '#ffd8d0';
                ctx.font = '10px system-ui, sans-serif';
                ctx.fillText('抵抗 ' + Math.round(r), sx, sy - 6);
            }
        }
        ctx.restore();
        drawLegend(ctx, '占领与抵抗', [['抵抗 >60', '#ff3c32'], ['30~60', '#ff9632'], ['<30', '#ffdc78']], '抵抗高会破坏工厂并袭击驻军');
    }
    // ============================================================
    // 部队
    // ============================================================
    function drawUnits(ctx, w, vb) {
        const byLoc = {};
        for (const d of w.divisions)
            (byLoc[d.loc] = byLoc[d.loc] || []).push(d);
        const scale = Math.min(1.8, Math.max(0.65, R.cam.zoom / 6));
        for (const pid in byLoc) {
            const p = w.provinces[pid];
            if (!p || !provVisible(p, vb))
                continue;
            const list = byLoc[pid];
            const c = w.countries[list[0].tag];
            const [sx, sy] = R.lonLatToScreen(p.cx, p.cy);
            const bw = (14 + Math.min(16, list.length * 1.6)) * scale;
            const bh = 9 * scale;
            const inBattle = list.some((d) => d.battleId != null);
            ctx.fillStyle = c ? c.color : '#999';
            ctx.fillRect(sx - bw / 2, sy + 6 * scale, bw, bh);
            ctx.strokeStyle = inBattle ? '#ff3b30' : '#0b1420';
            ctx.lineWidth = inBattle ? 2.2 : 1;
            ctx.strokeRect(sx - bw / 2, sy + 6 * scale, bw, bh);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold ' + Math.round(8 * scale + 1) + 'px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(list.length), sx, sy + 6 * scale + bh - 2);
            // 组织度条
            const avg = list.reduce((s, d) => s + d.org / Math.max(0.01, d.orgMax * d.str), 0) / list.length;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(sx - bw / 2, sy + 6 * scale + bh + 1, bw, 3);
            ctx.fillStyle = avg > 0.66 ? '#4cd964' : avg > 0.33 ? '#ffcc00' : '#ff3b30';
            ctx.fillRect(sx - bw / 2, sy + 6 * scale + bh + 1, bw * Math.max(0, Math.min(1, avg)), 3);
            // 移动箭头
            const mover = list.find((d) => d.status === 'moving' && d.path && d.path.length);
            if (mover) {
                const t = w.provinces[mover.path[0]];
                if (t) {
                    const [tx, ty] = R.lonLatToScreen(t.cx, t.cy);
                    const ang = Math.atan2(ty - sy, tx - sx);
                    const L = 16 * scale;
                    ctx.strokeStyle = '#ffe066';
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(sx + Math.cos(ang) * L, sy + Math.sin(ang) * L);
                    ctx.stroke();
                }
            }
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
