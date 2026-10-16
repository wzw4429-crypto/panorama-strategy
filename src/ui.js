"use strict";
/* PSE · UI 层 (ui.js)
 * DOM 面板：顶栏 / 生产 / 科研 / 国策 / 军队 / 外交 / 后勤 / 事件弹窗 / 日志 / 省份详情 / 存档。
 * 所有改动通过 PSE.Cmd 与 PSE.Diplo 提交，不直接改 world。
 */
(function (root) {
    'use strict';
    const PSE = (root.PSE = root.PSE || {});
    const UI = (PSE.UI = {});
    const $ = (id) => document.getElementById(id);
    /** 容错写入：DOM 缺元素时告警而非抛异常（原型曾因缺 #speedLabel 导致首帧中断、地图不渲染） */
    function setText(id, v) {
        const el = document.getElementById(id);
        if (el)
            el.textContent = v;
        else if (!setText._warned) {
            setText._warned = {};
        }
        if (!el && !(setText._warned[id])) {
            setText._warned[id] = true;
            console.warn('[PSE] 缺少 DOM 元素 #' + id);
        }
    }
    function setHtml(id, v) {
        const el = document.getElementById(id);
        if (el)
            el.innerHTML = v;
        else if (!(setText._warned || {})[id]) {
            setText._warned = setText._warned || {};
            setText._warned[id] = true;
            console.warn('[PSE] 缺少 DOM 元素 #' + id);
        }
    }
    let tab = 'production';
    let selectedDivs = [];
    UI.state = { tab: () => tab, selectedDivs: () => selectedDivs };
    // ============================================================
    // 顶栏
    // ============================================================
    function player(w) { return w.countries[w.playerTag]; }
    UI.renderTop = function (g) {
        const w = g.world, c = player(w);
        const t = PSE.Time.decompose(w.hour);
        setText('date', t.year + '年' + t.month + '月' + t.day + '日 ' + String(t.hour).padStart(2, '0') + ':00');
        setText('speedLabel', w.speed === 0 ? '暂停' : w.speed + 'x');
        setText('countryName', c.name + '（' + c.tag + '）');
        setText('ideology', PSE.IDEOLOGY_NAME[c.ideology] + '・' + PSE.REGIME_NAME[c.regime]);
        setText('pp', Math.floor(c.pp));
        setText('manpower', Math.round(c.manpower) + 'k');
        setText('stability', Math.round(c.stability * 100) + '%');
        setText('warSupport', Math.round(c.warSupport * 100) + '%');
        setText('factories', c.factories.civ + ' / ' + c.factories.mil + ' / ' + c.factories.dock);
        setText('credits', Math.round(c.credits || 0));
        setText('tension', Math.round(w.tension));
        const tb = $('tensionBar');
        if (tb)
            tb.style.width = Math.min(100, w.tension) + '%';
        const res = c.dailyHave || {};
        const need = c.dailyNeed || {};
        const parts = [];
        const avail = c.resourceAvail || {};
        for (const k of ['coal', 'steel', 'oil', 'rubber', 'aluminum', 'tungsten', 'chromium']) {
            const nd = Math.round(need[k] || 0);
            const av = Math.round(avail[k] || 0);
            const short = nd > 0 && av < nd - 0.5;
            parts.push('<span class="res' + (short ? ' short' : '') + '" title="可用/需求">' +
                PSE.Sim.resourceName(k) + ' ' + av + '/' + nd + '</span>');
        }
        setHtml('resources', parts.join(''));
        setText('resourceFactor', '供给系数 ' + Math.round((c.resourceFactor || 1) * 100) + '%');
        const divs = c.divisions.length;
        const battles = w.battles.filter((b) => b.atkTag === c.tag || b.defTag === c.tag).length;
        setText('armyInfo', divs + ' 个师' + (battles ? '｜交战 ' + battles : ''));
        setHtml('alerts', alertsHtml(w, c));
    };
    function alertsHtml(w, c) {
        const a = [];
        if (w.events.current && w.events.current.tag === c.tag)
            a.push('<span class="alert">事件待决</span>');
        if (!c.focus.current)
            a.push('<span class="alert">无国策进行中</span>');
        if (c.research.length < PSE.World.researchSlotsOf(w, c))
            a.push('<span class="alert">科研槽空缺</span>');
        if (c.construction.length === 0)
            a.push('<span class="alert">无建设队列</span>');
        if ((c.stockpile.infantry_equipment_1 || 0) < 500)
            a.push('<span class="alert">步兵装备不足</span>');
        const wars = PSE.World.warsOf(w, c.tag).length;
        if (wars)
            a.push('<span class="alert war">' + wars + ' 场战争</span>');
        return a.join('');
    }
    // ============================================================
    // 右侧面板
    // ============================================================
    const TAB_NAME = {
        production: '生产', equipment: '装备设计', research: '科研', focus: '国策', army: '陆军',
        navy: '海军', air: '空军', spy: '谍报', diplomacy: '外交', logistics: '后勤',
    };
    let panelHtml = null; // 上次写入 #panelBody 的 HTML：用于跳过无变化的重绘
    let panelPressed = false; // 面板内按住鼠标期间不重绘（否则点击会被吞掉）
    let panelFs = false; // 面板全屏（国策/科研等放大观看）
    let headerKey = ''; // 顶部条缓存（避免每帧重建按钮）
    let lastGame = null; // 供顶部条按钮回到游戏上下文
    let newProdPick = 'infantry_equipment_1'; // 新增产线下拉的当前选择（重绘后仍保留）
    /**
     * 面板顶部条（#tabs 原本是空条）：显示当前面板名；全屏时额外提供全部标签页按钮，
     * 全屏按钮在所有面板都可用——国策树/科研列表放大后更好看也好点。
     */
    function renderPanelHeader(force) {
        const el = $('tabs');
        if (!el)
            return;
        const key = tab + '|' + (panelFs ? 'fs' : '') + '|' + (panelFs ? '' : TAB_NAME[tab]);
        if (!force && el.innerHTML && key === headerKey)
            return;
        headerKey = key;
        let h = '<span class="panelTitle">' + (TAB_NAME[tab] || tab) + '</span>';
        if (panelFs) {
            h += '<span class="panelTabs">' + Object.keys(TAB_NAME).map((k) => '<button class="mini' + (k === tab ? ' on' : '') + '" data-panelfstab="' + k + '">' + TAB_NAME[k] + '</button>').join('') + '</span>';
        }
        h += '<span class="grow"></span>' +
            '<button class="mini' + (panelFs ? ' on' : '') + '" data-panelfs="1" title="面板全屏，国策/科研看得更全（Esc 退出）">' +
            (panelFs ? '✕ 退出全屏' : '⛶ 全屏') + '</button>';
        el.innerHTML = h;
        const fsBtn = el.querySelector('[data-panelfs]');
        if (fsBtn)
            fsBtn.onclick = () => UI.setPanelFullscreen(!panelFs);
        el.querySelectorAll('[data-panelfstab]').forEach((b) => b.onclick = () => UI.setTab(b.dataset.panelfstab, lastGame));
    }
    /** 面板全屏：把 #side 铺满窗口（地图仍在后面），标签页与全屏按钮随面板一起放大 */
    UI.setPanelFullscreen = function (on) {
        panelFs = !!on;
        const side = $('side');
        if (side)
            side.classList.toggle('panelFs', panelFs);
        renderPanelHeader(true);
        if (lastGame)
            UI.renderPanel(lastGame); // 立刻重绘：国策树/科研列表的高度随全屏马上变化
        if (panelFs)
            UI.toast('面板全屏：Esc 或再点「退出全屏」返回');
        return panelFs;
    };
    UI.panelFullscreen = () => panelFs;
    /** 面板内是否正在被操作（下拉展开 / 输入框聚焦 / 鼠标按住）——此时重建 DOM 会关掉下拉、丢点击 */
    function panelBusy(el) {
        if (panelPressed)
            return true;
        try {
            const a = document.activeElement;
            if (a && a !== document.body && el && el.contains && el.contains(a)) {
                const t = String(a.tagName || '').toUpperCase();
                if (t === 'SELECT' || t === 'INPUT' || t === 'TEXTAREA')
                    return true;
            }
        }
        catch (e) { /* 测试桩没有 activeElement */ }
        return false;
    }
    function panelHtmlOf(g) {
        const w = g && g.world;
        if (!w)
            return '';
        const c = player(w);
        switch (tab) {
            case 'production': return panelProduction(w, c);
            case 'research': return panelResearch(w, c);
            case 'focus': return panelFocus(w, c);
            case 'army': return panelArmy(w, c);
            case 'diplomacy': return panelDiplomacy(w, c);
            case 'logistics': return panelLogistics(w, c);
            case 'equipment': return panelEquipment(w, c);
            case 'navy': return panelNavy(w, c);
            case 'air': return panelAir(w, c);
            case 'spy': return panelSpy(w, c);
            default: return '';
        }
    }
    /** 命令/按钮回调后重绘：无条件重建 DOM，保证面板立刻反映新状态 */
    UI.renderPanel = function (g) {
        const el = $('panelBody');
        if (!el)
            return;
        lastGame = g;
        const h = panelHtmlOf(g);
        panelHtml = h;
        if (el.innerHTML !== h)
            el.innerHTML = h;
        UI.bindPanel(g);
    };
    /**
     * 定时刷新（主循环每 350ms）：内容没变就完全不动 DOM；玩家正在操作面板控件时跳过。
     * 修复「点开生产线的下拉 → 面板每 350ms 重建 → 下拉闪一下变白、选项点不中」。
     */
    UI.tickPanel = function (g) {
        const el = $('panelBody');
        if (!el)
            return;
        lastGame = g;
        const h = panelHtmlOf(g);
        if (h === panelHtml)
            return; // 内容没变：一个 DOM 节点都不碰
        if (panelBusy(el))
            return; // 交互结束后由下一次 tick 或命令回调接上
        UI.renderPanel(g);
    };
    // ============================================================
    // 装备设计器 + 军事装备贸易
    // ============================================================
    let design = { role: 'tank', chassis: 'medium', gun: 'medium', armor: 'medium', engine: 'petrol', airframe: 'multirole' };
    function panelEquipment(w, c) {
        const parts = PSE.EQ_PARTS;
        const spec = Object.assign({}, design, {
            name: c.name + (design.role === 'air' ? '自制战机' : '自制坦克'),
            id: 'custom_preview',
        });
        const preview = PSE.deriveEquipment(spec);
        let h = '<div class="sec"><div class="secTitle">装备设计器 <span class="muted">（组合底盘/火炮/装甲/引擎，成本随配置变化）</span></div>';
        h += '<div class="row wrap"><button class="mini' + (design.role === 'tank' ? ' on' : '') + '" data-design="role:tank">坦克</button>' +
            '<button class="mini' + (design.role === 'air' ? ' on' : '') + '" data-design="role:air">飞机</button></div>';
        const sel = (label, key, opts) => '<div class="row"><span class="eqName">' + label + '</span><select data-design="' + key + '">' +
            Object.keys(opts).map((k) => '<option value="' + k + '"' + (design[key] === k ? ' selected' : '') + '>' + opts[k].name + '</option>').join('') +
            '</select></div>';
        if (design.role === 'tank') {
            h += sel('底盘', 'chassis', parts.chassis);
            h += sel('主炮', 'gun', parts.gun);
            h += sel('装甲', 'armor', parts.armor);
            h += sel('引擎', 'engine', parts.engine);
        }
        else {
            h += sel('机架', 'airframe', parts.airframe);
            h += sel('武器', 'gun', parts.gun);
            h += sel('引擎', 'engine', parts.engine);
        }
        h += '<div class="preview"><b>' + preview.name + '</b>　成本 ' + preview.cost +
            '　资源 ' + Object.keys(preview.res).map((k) => PSE.Sim.resourceName(k) + ' ' + preview.res[k]).join('、') + '</div>';
        h += '<div class="small">软攻 ' + preview.stats.soft + '｜硬攻 ' + preview.stats.hard + '｜防御 ' + preview.stats.def +
            '｜突破 ' + preview.stats.brk + '｜装甲 ' + (preview.stats.armor || 0) + '｜穿甲 ' + (preview.stats.pierce || 0) +
            '｜速度 ' + preview.stats.speed + '</div>';
        h += '<div class="row"><button data-design-save="1">定型投产（解锁新型号）</button></div>';
        h += '<div class="small muted">定型后：该国对应营（轻/中/重坦或战机）改用新型号，产线可直接选择生产。</div></div>';
        // 已定型型号
        const mine = Object.keys(w.customEquipment || {}).filter((id) => {
            const ov = c.equipOverride || {};
            for (const k in ov)
                if (ov[k] === id)
                    return true;
            return false;
        });
        if (mine.length) {
            h += '<div class="sec"><div class="secTitle">已定型型号</div>';
            for (const id of mine) {
                const e = PSE.EQUIPMENT[id];
                h += '<div class="row"><span class="eqName">' + e.name + '</span><span class="muted">成本 ' + e.cost +
                    '｜库存 ' + Math.floor(c.stockpile[id] || 0) + '</span></div>';
            }
            h += '</div>';
        }
        // 生产线新增型号
        h += '<div class="sec"><div class="secTitle">装备贸易市场</div>';
        h += '<div class="row wrap"><span class="muted">信用点 ' + Math.round(c.credits) + '</span></div>';
        const market = (w.market || []).filter((o) => o.seller !== c.tag && !PSE.World.areAtWar(w, c.tag, o.seller));
        if (!market.length)
            h += '<div class="muted">市场上暂无报价（各国会在库存过剩时挂单）</div>';
        for (const o of market) {
            const seller = w.countries[o.seller];
            h += '<div class="row"><span class="eqName">' + PSE.EQUIP_NAME(o.equipId) + '</span>' +
                '<span class="muted">' + (seller ? seller.name : o.seller) + '｜' + Math.round(o.amount) + ' 件｜' + o.price.toFixed(1) + ' 信用/件</span>' +
                '<button class="mini" data-buy="' + o.id + '">购买 500</button></div>';
        }
        h += '<div class="row wrap"><span class="eqName">挂牌出售</span>' +
            '<select id="sellEquip">' + equipOptions('infantry_equipment_1') + '</select>' +
            '<button data-sell="1">挂牌 2000 件</button></div>';
        // 租借
        h += '<div class="secTitle" style="margin-top:8px">租借盟友（每日输送）</div>';
        const allies = PSE.World.alliesOf(w, c.tag);
        if (!allies.length)
            h += '<div class="muted">暂无盟友</div>';
        for (const a of allies) {
            h += '<div class="row"><span class="eqName">' + PSE.COUNTRY_NAME[a] + '</span>' +
                '<button class="mini" data-lend="' + a + '">租借步兵装备 60/日</button></div>';
        }
        h += '</div>';
        return h;
    }
    // ============================================================
    // 海军 / 空军 / 谍报
    // ============================================================
    function panelNavy(w, c) {
        let h = '<div class="sec"><div class="secTitle">舰队 <span class="muted">（舰船战力 ' + Math.round(PSE.Navy.power(c)) + '）</span></div>';
        if (!(c.fleets || []).length)
            h += '<div class="muted">尚未编成舰队（有舰船后每周自动编队）</div>';
        for (const f of (c.fleets || [])) {
            const z = PSE.MapData.seaZones.find((x) => x.id === f.zone);
            h += '<div class="row"><span class="eqName">' + (z ? z.name : '海区' + f.zone) + '</span>' +
                '<span class="muted">战力 ' + Math.round(f.ships) + '｜任务 ' + (f.mission === 'raid' ? '破交' : f.mission === 'escort' ? '护航' : '巡逻') + '</span></div>';
        }
        h += '</div><div class="sec"><div class="secTitle">舰船库存</div>';
        for (const k in PSE.SHIP_TYPES) {
            const n = Math.floor(c.stockpile[k] || 0);
            if (!n)
                continue;
            h += '<div class="row"><span class="eqName">' + PSE.SHIP_TYPES[k].name + '</span><span class="num">' + n + '</span></div>';
        }
        h += '</div>';
        // 海区控制
        h += '<div class="sec"><div class="secTitle">制海权（本国沿海）</div>';
        const zones = {};
        for (const p of w.provinces)
            if (p.controller === c.tag)
                for (const z of (p.seaZones || []))
                    zones[z] = (zones[z] || 0) + 1;
        for (const z in zones) {
            const zz = PSE.MapData.seaZones.find((x) => x.id === +z);
            const ctl = PSE.Navy.seaControl(w, +z, c.tag);
            h += '<div class="row"><span class="eqName">' + (zz ? zz.name : z) + '</span>' +
                '<div class="bar"><i style="width:' + Math.round(ctl * 100) + '%"></i></div><span class="num">' + Math.round(ctl * 100) + '%</span></div>';
        }
        h += '</div>';
        // 两栖登陆
        const sel = PSE.UI.selectedDivs();
        h += '<div class="sec"><div class="secTitle">两栖登陆</div><div class="small muted">' +
            '先在「军队」面板选中部队（需在沿海省份），再点地图上的敌方沿海省 → 详情里点「两栖登陆」。</div>' +
            '<div class="row"><button data-invasion="sel">对当前选中省发起登陆</button></div></div>';
        return h;
    }
    function panelAir(w, c) {
        let h = '<div class="sec"><div class="secTitle">空军联队 <span class="muted">（' + c.airWings.length + ' 支）</span></div>';
        if (!c.airWings.length)
            h += '<div class="muted">没有联队（生产战斗机/支援机后自动编成）</div>';
        for (const wing of c.airWings) {
            const p = w.provinces[wing.loc];
            h += '<div class="row"><span class="eqName">' + (wing.type === 'fighter' ? '战斗机' : wing.type === 'cas' ? '近距支援' : wing.type === 'transport' ? '运输机' : '战术轰炸') +
                ' ×' + Math.round(wing.count) + '</span>' +
                '<span class="muted">' + (p ? p.name : '') + '</span>' +
                '<select data-wing="' + wing.id + '">' +
                PSE.AIR_MISSIONS.concat(['transport']).map((m) => '<option value="' + m + '"' + (wing.mission === m ? ' selected' : '') + '>' + (PSE.AIR_MISSION_NAME[m] || m) + '</option>').join('') +
                '</select></div>';
        }
        h += '</div><div class="sec"><div class="secTitle">机库库存</div>';
        for (const k of ['fighter_1', 'fighter_2', 'cas_1', 'tactical_bomber_1', 'strategic_bomber_1', 'transport_plane']) {
            const n = Math.floor(c.stockpile[k] || 0);
            if (!n)
                continue;
            h += '<div class="row"><span class="eqName">' + PSE.EQUIP_NAME(k) + '</span><span class="num">' + n + '</span></div>';
        }
        h += '</div><div class="sec"><div class="secTitle">任务说明</div><div class="small muted">' +
            '争夺制空：与敌机交战并抢夺制空权；近距支援：为邻近战斗提供 org 伤害与突破加成；' +
            '拦截：防守本土空域；战略轰炸：摧毁敌工厂（需战术/战略轰炸机）；对海打击：攻击敌方舰队；空中补给：为断供省补货。</div></div>';
        if ((c.stockpile.transport_plane || 0) > 20 || c.airWings.some((x) => x.type === 'transport')) {
            h += '<div class="sec"><div class="secTitle">空降作战</div><div class="small muted">选中伞兵师（需伞兵模板），点目标省后在详情里执行空降。</div></div>';
        }
        return h;
    }
    function panelSpy(w, c) {
        let h = '<div class="sec"><div class="secTitle">情报局</div>';
        if (!c.agency || !c.agency.exists) {
            h += '<div class="muted">尚未成立情报局（50 政治点）</div>' +
                '<div class="row"><button data-agency="1"' + (c.pp < 50 ? ' disabled' : '') + '>成立情报局</button></div></div>';
            return h;
        }
        h += '<div class="row"><span class="eqName">特工 ' + c.agency.agents.length + ' 名</span>' +
            '<button class="mini" data-recruit-spy="1"' + (c.pp < 30 ? ' disabled' : '') + '>招募特工（30pp）</button></div>';
        for (const a of c.agency.agents) {
            h += '<div class="row"><span class="eqName">特工 #' + a.id + '（技能 ' + a.skill + '）</span>' +
                (a.status === 'mission'
                    ? '<span class="muted">执行中：' + (PSE.SPY_MISSIONS[a.mission] ? PSE.SPY_MISSIONS[a.mission].name : a.mission) +
                        ' → ' + (PSE.COUNTRY_NAME[a.target] || a.target) + '（' + Math.round(100 * a.progress / Math.max(1, a.total)) + '%）</span>'
                    : a.status === 'captured' ? '<span class="alert">已被捕</span>' : '<span class="ok">待命</span>') +
                '</div>';
        }
        h += '</div>';
        h += '<div class="sec"><div class="secTitle">派遣任务</div>';
        for (const m in PSE.SPY_MISSIONS) {
            const d = PSE.SPY_MISSIONS[m];
            h += '<div class="row"><span class="eqName">' + d.name + '</span><span class="small muted">' + d.desc + '（' + d.days + ' 天，风险 ' + Math.round(d.risk * 100) + '%）</span>' +
                '<select data-spy-opt="' + m + '">' + Object.keys(w.countries).filter((t) => t !== c.tag && t !== 'NEU')
                .map((t) => '<option value="' + t + '">' + PSE.COUNTRY_NAME[t] + '</option>').join('') + '</select>' +
                '<button class="mini" data-spy-go="' + m + '">执行</button></div>';
        }
        h += '</div>';
        h += '<div class="sec"><div class="secTitle">情报网</div>';
        const net = c.agency.network || {};
        const keys = Object.keys(net);
        if (!keys.length)
            h += '<div class="muted">尚未建立情报网（派遣特工即可逐步建立）</div>';
        for (const k of keys) {
            h += '<div class="row"><span class="eqName">' + (PSE.COUNTRY_NAME[k] || k) + '</span>' +
                '<div class="bar"><i style="width:' + Math.round(net[k]) + '%"></i></div><span class="num">' + Math.round(net[k]) + '</span></div>';
        }
        h += '</div>';
        return h;
    }
    /** 装备下拉：kind='mil' 只列陆空军装备，'dock' 只列舰船，缺省列全部 */
    function equipOptions(sel, kind) {
        const ids = Object.keys(PSE.EQUIPMENT);
        const isNaval = (id) => PSE.EQUIPMENT[id].type === 'naval';
        const one = (id) => '<option value="' + id + '"' + (id === sel ? ' selected' : '') + '>' + PSE.EQUIPMENT[id].name + '</option>';
        if (kind === 'mil')
            return ids.filter((id) => !isNaval(id)).map(one).join('');
        if (kind === 'dock')
            return ids.filter(isNaval).map(one).join('');
        return ids.map(one).join('');
    }
    /** 新增产线的装备下拉：按「陆空军 / 舰船」分组，选舰船会自动开船坞产线 */
    function newProdOptions(sel) {
        const ids = Object.keys(PSE.EQUIPMENT);
        const one = (id) => '<option value="' + id + '"' + (id === sel ? ' selected' : '') + '>' + PSE.EQUIPMENT[id].name + '</option>';
        const mil = ids.filter((id) => PSE.EQUIPMENT[id].type !== 'naval');
        const dock = ids.filter((id) => PSE.EQUIPMENT[id].type === 'naval');
        return (mil.length ? '<optgroup label="陆空军装备">' + mil.map(one).join('') + '</optgroup>' : '') +
            (dock.length ? '<optgroup label="舰船（占船坞）">' + dock.map(one).join('') + '</optgroup>' : '');
    }
    function panelProduction(w, c) {
        // 与命令共用同一口径：船坞产线不占军工（曾因面板按 !dock 统计、命令把船坞算进 used 而不一致）
        const used = PSE.Cmd.prodUsedMil(c);
        const free = PSE.Cmd.prodFreeMil(c);
        const dockLines = c.production.filter((l) => l.dock);
        const freeDock = Math.max(0, (c.factories.dock || 0) - dockLines.length);
        let h = '<div class="sec"><div class="secTitle">军用生产线 <span class="muted">（军工 ' + c.factories.mil + '，已分配 ' + used + '，空闲 ' + free + '）</span></div>';
        for (const l of c.production) {
            if (l.dock)
                continue;
            const eq = PSE.EQUIPMENT[l.equipId];
            const out = (l.output || 0).toFixed(1);
            const stock = Math.floor(c.stockpile[l.equipId] || 0);
            h += '<div class="row wrap prodRow">' +
                '<span class="eqName">' + (eq ? eq.name : l.equipId) + '</span>' +
                '<button class="mini" data-prod-dec="' + l.id + '">−</button>' +
                '<span class="num">' + l.factories + '</span>' +
                '<button class="mini" data-prod-inc="' + l.id + '">+</button>' +
                '<span class="muted">效率 ' + Math.round(l.eff * 100) + '%' + (l.switchDays > 0 ? '（换型冷却 ' + l.switchDays + '天）' : '') + '</span>' +
                '<span class="muted">日产 ' + out + '</span>' +
                '<span class="muted">库存 ' + stock + '</span>' +
                '<select data-switch="' + l.id + '">' + equipOptions(l.equipId, 'mil') + '</select>' +
                '<button class="mini danger" data-prod-del="' + l.id + '">×</button>' +
                '</div>';
        }
        h += '<div class="row wrap"><select id="newProd">' + newProdOptions(newProdPick) + '</select>' +
            '<button data-add-prod="1">新增产线</button>' +
            '<span class="muted small">空闲军工 ' + free + ' 座 · 空闲船坞 ' + freeDock + ' 座（选舰船则开船坞产线）· 该装备已有产线时，新增会把空闲军工并入该线</span></div>';
        // 空闲为 0 时说清「怎么才会有空闲」：建设中/未完工的军工厂不算空闲，避免误以为有空的军工厂
        if (free <= 0) {
            h += '<div class="row small warnish">空闲军工为 0：点产线上的 − 可回收军工，或在下方「建设队列」建「军用工厂」（建成后才会变成空闲军工）' +
                (c.construction.some((it) => it.kind === 'mil') ? '｜当前有军用工厂在建，等它完工' : '') + '</div>';
        }
        if (freeDock <= 0 && dockLines.length) {
            h += '<div class="row small warnish">空闲船坞为 0：可在船坞产线点 × 拆线，或建「海军船坞」</div>';
        }
        h += '</div>';
        // 船坞（每条产线占 1 座；可换舰型、可拆）
        if (c.factories.dock || dockLines.length) {
            h += '<div class="sec"><div class="secTitle">海军船坞 <span class="muted">（' + (c.factories.dock || 0) + ' 座，已用 ' + dockLines.length + '，空闲 ' + freeDock + '）</span></div>';
            for (const l of dockLines) {
                const eq = PSE.EQUIPMENT[l.equipId];
                h += '<div class="row wrap prodRow">' +
                    '<span class="eqName">' + (eq ? eq.name : l.equipId) + '</span>' +
                    '<span class="muted">日产 ' + (l.output || 0).toFixed(1) + '</span>' +
                    '<span class="muted">库存 ' + Math.floor(c.stockpile[l.equipId] || 0) + '</span>' +
                    '<select data-switch="' + l.id + '">' + equipOptions(l.equipId, 'dock') + '</select>' +
                    '<button class="mini danger" data-prod-del="' + l.id + '">×</button>' +
                    '</div>';
            }
            h += '</div>';
        }
        // 建设
        h += '<div class="sec"><div class="secTitle">建设队列 <span class="muted">（民用工厂 ' + c.factories.civ + '，贸易占用 ' + (c.tradeCivs || 0) + '）</span></div>';
        for (const it of c.construction) {
            const def = PSE.BUILDINGS[it.kind];
            const p = w.provinces[it.prov];
            const pct = Math.round(100 * it.prog / it.cost);
            h += '<div class="row"><span class="eqName">' + def.name + '</span><span class="muted">' + (p ? p.name : '') + '</span>' +
                '<div class="bar"><i style="width:' + pct + '%"></i></div><span class="num">' + pct + '%</span></div>';
        }
        h += '<div class="row wrap">' +
            '<button data-build="civ">民用工厂</button><button data-build="mil">军用工厂</button>' +
            '<button data-build="dock">海军船坞</button><button data-build="infra">基础设施</button>' +
            '<button data-build="rail">铁路</button><button data-build="fort">要塞</button>' +
            '<button data-build="airbase">机场</button></div></div>';
        // 顾问与法案
        h += '<div class="sec"><div class="secTitle">内阁顾问 <span class="muted">（' + c.advisors.length + '/3）</span></div>';
        for (const a of (PSE.ADVISORS || [])) {
            const has = c.advisors.some((x) => x.id === a.id);
            h += '<div class="row"><span class="eqName">' + a.name + '</span><span class="muted">' + a.desc + '</span>' +
                '<span class="num">' + a.cost + 'pp</span>' +
                (has ? '<span class="ok">已任命</span>' : '<button data-advisor="' + a.id + '"' + (c.pp < a.cost ? ' disabled' : '') + '>任命</button>') +
                '</div>';
        }
        h += '</div>';
        h += '<div class="sec"><div class="secTitle">法案</div>';
        const laws = [['conscription', 0, 4, '征召法'], ['economy', 0, 5, '经济法'], ['trade', 0, 5, '贸易法'], ['training', 0, 3, '训练法']];
        for (const [k, lo, hi, name] of laws) {
            h += '<div class="row"><span class="eqName">' + name + '</span>' +
                '<span class="muted">' + PSE.Sim.lawValueName(k, c.laws[k]) + '</span>' +
                '<button class="mini" data-law="' + k + '" data-val="' + (c.laws[k] - 1) + '"' + (c.laws[k] <= lo ? ' disabled' : '') + '>−</button>' +
                '<button class="mini" data-law="' + k + '" data-val="' + (c.laws[k] + 1) + '"' + (c.laws[k] >= hi ? ' disabled' : '') + '>+</button>' +
                '<span class="muted">花费 ' + (100 + (c.laws[k] + 1) * 60) + 'pp</span></div>';
        }
        h += '</div>';
        return h;
    }
    function panelResearch(w, c) {
        const slots = PSE.World.researchSlotsOf(w, c);
        let h = '<div class="sec"><div class="secTitle">科研槽 ' + c.research.length + '/' + slots + '</div>';
        for (let i = 0; i < slots; i++) {
            const r = c.research[i];
            if (!r) {
                h += '<div class="row"><span class="eqName">槽位 ' + (i + 1) + '</span><span class="muted">空闲</span></div>';
                continue;
            }
            const t = PSE.TECHS[r.techId];
            const pct = Math.round(100 * r.prog / r.cost);
            h += '<div class="row"><span class="eqName">' + t.name + '</span>' +
                '<span class="muted">' + areaName(t.area) + '</span>' +
                '<div class="bar"><i style="width:' + pct + '%"></i></div><span class="num">' + pct + '%</span>' +
                '<select data-research="' + i + '">' + techOptions(c, r.techId) + '</select></div>';
        }
        h += '<div class="muted small">已研究 ' + c.researched.length + ' / ' + Object.keys(PSE.TECHS).length + ' 项；学说一旦选定不可更改</div></div>';
        h += '<div class="sec"><div class="secTitle">已完成科技</div><div class="techList">';
        const done = c.researched.slice().sort();
        h += done.map((id) => '<span class="chip">' + (PSE.TECHS[id] ? PSE.TECHS[id].name : id) + '</span>').join('');
        h += '</div></div>';
        return h;
    }
    function areaName(a) {
        return { industry: '工业', army: '陆军', air: '空军', navy: '海军', doctrine: '学说', nuclear: '核物理', rocket: '火箭' }[a] || a;
    }
    function techOptions(c, sel) {
        let h = '';
        for (const id in PSE.TECHS) {
            const done = c.researched.indexOf(id) >= 0;
            const busy = c.research.some((r) => r && r.techId === id);
            const ok = PSE.Sim.techAvailable(c, id) || id === sel;
            const tag = done ? '（已研究）' : busy ? '（研究中）' : ok ? '' : '（前置未满足）';
            h += '<option value="' + id + '"' + (id === sel ? ' selected' : '') + (ok ? '' : ' disabled') + '>' +
                PSE.TECHS[id].name + '（' + areaName(PSE.TECHS[id].area) + '）' + tag + '</option>';
        }
        return h;
    }
    // ============================================================
    // 国策树：树状图（节点连线 + 互斥分支 + 进度）
    // ============================================================
    function panelFocus(w, c) {
        const tree = PSE.FOCUS_TREES[c.focusTree] || PSE.FOCUS_TREES.generic;
        const nodes = tree.nodes;
        // 布局：按 x 列、y 行（国策数据自带坐标），无坐标则按拓扑层级排布
        const levels = {};
        const depth = (id, seen) => {
            seen = seen || {};
            if (seen[id] !== undefined)
                return seen[id];
            seen[id] = 0;
            const n = nodes.find((x) => x.id === id);
            if (!n || !n.prereq || !n.prereq.length)
                return 0;
            let d = 0;
            for (const p of n.prereq)
                d = Math.max(d, depth(p, seen) + 1);
            seen[id] = d;
            return d;
        };
        let maxX = 0, maxY = 0;
        const pos = {};
        nodes.forEach((n, i) => {
            const x = n.x !== undefined ? n.x : depth(n.id);
            const y = n.y !== undefined ? n.y : (i % 6);
            pos[n.id] = { x, y };
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        });
        const COL = 150, ROW = 76, PADX = 14, PADY = 14, NW = 124, NH = 56;
        // 防重叠：同坐标格顺延到下方空行（数据意外撞格时兜底）
        const usedCells = {};
        nodes.forEach((n) => {
            const p = pos[n.id];
            while (usedCells[p.x + ',' + p.y])
                p.y++;
            usedCells[p.x + ',' + p.y] = true;
            maxY = Math.max(maxY, p.y);
        });
        const width = (maxX + 1) * COL + PADX * 2;
        const height = (maxY + 1) * ROW + PADY * 2;
        let h = '<div class="sec"><div class="secTitle">国策树：' + (c.focusTree === 'generic' ? '通用路线' : c.name) +
            ' <span class="muted">（' + c.focusDone.length + '/' + nodes.length + ' 已完成）</span></div>';
        if (c.focus.current) {
            const node = nodes.find((n) => n.id === c.focus.current.id);
            if (node) {
                const pct = Math.round(100 * c.focus.progress / node.days);
                h += '<div class="curFocus"><b>进行中：' + node.name + '</b>' +
                    '<div class="bar big"><i style="width:' + pct + '%"></i></div>' +
                    '<span class="muted">' + c.focus.progress + ' / ' + node.days + ' 天</span></div>';
            }
        }
        else
            h += '<div class="muted">尚未选择国策（AI 会自动推进，你也可以点击下方节点指定路线）</div>';
        h += '</div>';
        // SVG 连线 + 绝对定位节点（盒子几何与 .focusNode 的 124×56 对齐）
        const nL = (p) => PADX + p.x * COL, nT = (p) => PADY + p.y * ROW;
        const svg = [];
        for (const n of nodes) {
            const p = pos[n.id];
            for (const pre of (n.prereq || [])) {
                const q = pos[pre];
                if (!q)
                    continue;
                const done = c.focusDone.indexOf(pre) >= 0;
                const stroke = done ? '#4cd964' : '#3d4b5c', sw = done ? 2 : 1.4;
                if (q.y === p.y) {
                    // 同一行：右缘 → 左缘水平短线
                    svg.push('<line x1="' + (nL(q) + NW) + '" y1="' + (nT(q) + NH / 2) +
                        '" x2="' + nL(p) + '" y2="' + (nT(p) + NH / 2) +
                        '" stroke="' + stroke + '" stroke-width="' + sw + '" />');
                }
                else {
                    // 跨行：底边中点 → 顶边中点
                    svg.push('<line x1="' + (nL(q) + NW / 2) + '" y1="' + (nT(q) + NH) +
                        '" x2="' + (nL(p) + NW / 2) + '" y2="' + nT(p) +
                        '" stroke="' + stroke + '" stroke-width="' + sw + '" />');
                }
            }
            // 互斥分支：虚线相连（中心→中心，盒体不透明会盖住端点）
            for (const ex of (n.excl || [])) {
                const q = pos[ex];
                if (!q || q.x < p.x || (q.x === p.x && q.y <= p.y))
                    continue;
                svg.push('<line x1="' + (nL(p) + NW / 2) + '" y1="' + (nT(p) + NH / 2) +
                    '" x2="' + (nL(q) + NW / 2) + '" y2="' + (nT(q) + NH / 2) +
                    '" stroke="#ff9f0a" stroke-width="1.4" stroke-dasharray="4 3" />');
            }
        }
        // 面板全屏时国策树跟着长高，一屏看完整棵树（绝不比非全屏时更小）
        const viewH = (typeof window !== 'undefined' && window.innerHeight) || 800;
        const normH = Math.min(520, height + 10);
        const wrapH = panelFs ? Math.max(normH, viewH - 250) : normH;
        h += '<div class="focusWrap" style="height:' + wrapH + 'px;width:100%">' +
            '<svg width="' + width + '" height="' + height + '" style="position:absolute;left:0;top:0;pointer-events:none">' +
            svg.join('') + '</svg>';
        for (const n of nodes) {
            const p = pos[n.id];
            const done = c.focusDone.indexOf(n.id) >= 0;
            const cur = c.focus.current && c.focus.current.id === n.id;
            const avail = PSE.Sim.focusAvailable(w, c, n);
            const cls = done ? 'done' : cur ? 'active' : avail ? 'avail' : 'locked';
            const eff = n.effects.map(describeEffect).filter(Boolean).join('・');
            const state = done ? '已完成' : cur ? '进行中' : avail ? '点击启动' : '未解锁';
            h += '<div class="focusNode ' + cls + '" style="left:' + nL(p) + 'px;top:' + nT(p) + 'px"' +
                (avail ? ' data-focus="' + n.id + '"' : '') + ' title="' + eff.replace(/"/g, '') + '">' +
                '<b>' + n.name + '</b>' +
                '<span class="muted">' + n.days + '天 · ' + eff + '</span>' +
                '<span class="' + (done || cur ? 'ok' : 'muted') + '">' + state + '</span>' +
                '</div>';
        }
        h += '</div>';
        h += '<div class="small muted" style="margin-top:4px">橙色虚线 = 互斥分支（选定其一后另一条永久锁定）</div>';
        // 决议
        h += '<div class="sec" style="margin-top:10px"><div class="secTitle">决议</div>';
        for (const d of PSE.DECISIONS) {
            const st = (c.decisions || {})[d.id];
            const running = st && !st.done;
            const ok = PSE.Decisions.available(w, c, d);
            h += '<div class="row"><span class="eqName">' + d.name + '</span>' +
                '<span class="small muted">' + d.desc + '（' + d.cost + 'pp · ' + d.days + '天）</span>' +
                (running ? '<span class="ok">进行中 ' + Math.round(100 * st.progress / st.days) + '%</span>' :
                    '<button class="mini" data-decision="' + d.id + '"' + (ok ? '' : ' disabled') + '>启动</button>') +
                '</div>';
        }
        h += '</div>';
        // 民族精神
        h += '<div class="sec"><div class="secTitle">民族精神</div>';
        if (!(c.spirits || []).length)
            h += '<div class="muted">暂无（可通过事件/决议获得）</div>';
        for (const s of (c.spirits || [])) {
            const def = PSE.SPIRITS[s.id];
            h += '<div class="row"><span class="eqName">' + (def ? def.name : s.id) + '</span>' +
                '<span class="small muted">' + (def ? def.desc : '') + '</span></div>';
        }
        h += '</div>';
        // 学说（精通度解锁）
        h += '<div class="sec"><div class="secTitle">军事学说 <span class="muted">（陆军经验 ' +
            Math.round(c.armyXp || 0) + '，精通：机' + Math.round((c.mastery || {}).mobile || 0) +
            ' 火' + Math.round((c.mastery || {}).firepower || 0) + ' 人' + Math.round((c.mastery || {}).mass || 0) + '）</span></div>';
        for (const tk in PSE.DOCTRINE_TREES) {
            for (const bk in PSE.DOCTRINE_TREES[tk]) {
                const br = PSE.DOCTRINE_TREES[tk][bk];
                const locked = tk === 'grand' && c.grandDoctrine && c.grandDoctrine !== bk;
                h += '<div class="row wrap"><span class="eqName">' + (tk === 'grand' ? '大战略' : '特种') + '·' + br.name + '</span>' +
                    (locked ? '<span class="alert">已锁定（互斥）</span>' : '');
                for (const node of br.nodes) {
                    const has = (c.doctrineNodes || []).indexOf(node.id) >= 0;
                    const can = !has && !locked && PSE.Doctrine.available(c, node) && (c.armyXp || 0) >= node.cost;
                    h += '<button class="mini' + (has ? ' on' : '') + '" data-doctrine="' + node.id + '"' + (can || has ? '' : ' disabled') + '>' +
                        node.name + (has ? '✓' : ' (' + node.cost + ')') + '</button>';
                }
                h += '</div>';
            }
        }
        h += '</div>';
        return h;
    }
    function describeEffect(e) {
        switch (e.op) {
            case 'factory': return (e.kind === 'civ' ? '民用' : e.kind === 'mil' ? '军用' : '船坞') + '工厂 +' + e.n;
            case 'pp': return '政治点 ' + (e.v > 0 ? '+' : '') + e.v;
            case 'stab': return '稳定度 ' + Math.round(e.v * 100) + '%';
            case 'ws': return '战争支持 ' + Math.round(e.v * 100) + '%';
            case 'tech': return '科技：' + (PSE.TECHS[e.id] ? PSE.TECHS[e.id].name : e.id);
            case 'equip': return '装备：' + PSE.EQUIP_NAME(e.id) + ' ×' + e.n;
            case 'troops': return '新编 ' + e.n + ' 个师';
            case 'mod': return modName(e.key) + ' ' + (e.v > 0 ? '+' : '') + Math.round(e.v * 100) + '%';
            case 'wargoal': return '对 ' + (PSE.COUNTRY_NAME[e.tag] || e.tag) + ' 的战争借口';
            case 'tension': return '紧张度 ' + (e.v > 0 ? '+' : '') + e.v;
            case 'template': return '解锁模板：' + (PSE.TEMPLATES[e.id] ? PSE.TEMPLATES[e.id].name : e.id);
            case 'fort': return '要塞 +' + e.v;
            case 'manpower': return '人力 +' + e.v + 'k';
            case 'slot': return '科研槽 +' + e.v;
            case 'guarantee': return '保护 ' + (PSE.COUNTRY_NAME[e.tag] || e.tag);
            case 'faction':
            case 'faction_with': return '组建阵营';
            case 'faction_join': return '加入阵营';
            case 'relation': return '关系 ' + (PSE.COUNTRY_NAME[e.tag] || e.tag) + ' ' + (e.v > 0 ? '+' : '') + e.v;
            case 'event': return '触发事件';
            case 'annex': return '吞并 ' + (PSE.COUNTRY_NAME[e.tag] || e.tag);
            case 'annex_state': return '割取 ' + (PSE.COUNTRY_NAME[e.tag] || e.tag) + ' 领土';
            case 'claim': return '宣称 ' + (PSE.COUNTRY_NAME[e.tag] || e.tag);
            case 'res': return PSE.Sim.resourceName(e.key) + ' +' + e.v;
            default: return '';
        }
    }
    function modName(k) {
        return {
            softMul: '软攻', hardMul: '硬攻', defMul: '防御', brkMul: '突破', orgMul: '组织度',
            civOutput: '民用产出', milOutput: '军用产出', buildSpeed: '建造速度', researchSpeed: '科研速度',
            speedMul: '行军速度', consumerGoods: '消费品', resourceFactor: '资源效率', supplyRange: '补给范围',
            casBonus: '近距支援', airAtk: '空军攻击', navalAtk: '海军攻击', widthMul: '编制宽度', manpowerLoss: '人力损耗',
        }[k] || k;
    }
    PSE.describeEffect = describeEffect;
    function panelArmy(w, c) {
        if (PSE.Army) {
            PSE.Army.ensure(w, c);
            PSE.Army.assign(w, c);
        }
        const sel = new Set(selectedDivs);
        let h = '<div class="sec"><div class="secTitle">集团军与将领 <span class="muted">（陆军经验 ' + Math.round(c.armyXp || 0) + '）</span>' +
            '<button class="mini" data-army-add="1">新建集团军</button>' +
            '<button class="mini" data-army-auto="1">自动补齐</button></div>';
        if (!(c.armies || []).length) {
            h += '<div class="muted small">当前没有集团军——点「新建集团军」创建，数量与编成都可以自定义。</div>';
        }
        for (const a of (c.armies || [])) {
            const g = (c.generals || []).find((x) => x.id === a.generalId);
            const list = a.divisions.map((id) => w.divisions.find((d) => d.id === id)).filter(Boolean);
            h += '<div class="row wrap">' +
                '<input id="armyName' + a.id + '" type="text" value="' + a.name + '" style="width:112px">' +
                '<button class="mini" data-army-rename="' + a.id + '">改名</button>' +
                '<span class="muted">' + list.length + ' 个师</span>' +
                (list.length ? '<span class="muted small">' + list.slice(0, 3).map((d) => d.name).join('、') + (list.length > 3 ? ' 等' : '') + '</span>' : '') +
                '</div>';
            h += '<div class="row wrap"><span class="muted small" style="margin-left:4px">将领</span>' +
                '<select data-army-general="' + a.id + '"><option value="0">无将领</option>' +
                (c.generals || []).map((x) => '<option value="' + x.id + '"' + (x.id === a.generalId ? ' selected' : '') + '>' +
                    x.name + '（Lv' + x.level + ' 攻' + x.attack + ' 防' + x.defense + '）</option>').join('') +
                '</select>' +
                (g ? '<span class="muted small">' + g.traits.map((t) => (PSE.TRAITS[t] ? PSE.TRAITS[t].name : t)).join('、') +
                    '（经验 ' + Math.round(g.xp) + '/100）</span>' : '<span class="alert small">未指派将领：无加成</span>') +
                '</div>';
            h += '<div class="row wrap"><span class="muted small" style="margin-left:4px">命令</span>' +
                ['hold', 'advance', 'blitz'].map((o) => '<button class="mini' + (a.order === o ? ' on' : '') + '" data-order="' + a.id + ':' + o + '">' +
                    { hold: '防守', advance: '推进', blitz: '强攻' }[o] + '</button>').join('') +
                '<button class="mini" data-army-set="' + a.id + '">编入选中师</button>' +
                '<button class="mini" data-army-pull="' + a.id + '">调出选中师</button>' +
                '<button class="mini" data-army-select="' + a.id + '">选中该军</button>' +
                '<button class="mini" data-army-del="' + a.id + '">解散</button></div>';
        }
        h += '<div class="small muted">推进：自动向相邻敌控省进攻（需 1.4:1 兵力优势）；强攻：1:1 即进攻。<br>' +
            '编成：先在下方「部队」区点选若干师，再点某军的「编入选中师」；「调出选中师」把它们移出集团军（待编）。手动编成后不会再被每日自动编组改动，点「自动补齐」可恢复系统编组。</div></div>';
        h += '<div class="sec"><div class="secTitle">征兵 <span class="muted">（人力 ' + Math.round(c.manpower) + 'k，装备 ' + Math.floor(c.stockpile.infantry_equipment_1 || 0) + '）</span></div>';
        for (const tplId of c.templates) {
            const st = PSE.computeTemplate(tplId, c.modifiers);
            if (!st)
                continue;
            const need = PSE.World.equipNeed(tplId);
            const ok = canAfford(c, need);
            h += '<div class="row"><span class="eqName">' + (PSE.TEMPLATES[tplId] ? PSE.TEMPLATES[tplId].name : tplId) + '</span>' +
                '<span class="muted">宽' + st.width + ' 软' + Math.round(st.soft) + ' 硬' + Math.round(st.hard) +
                ' 防' + Math.round(st.def) + ' 突' + Math.round(st.brk) + ' org' + Math.round(st.org) + ' hp' + Math.round(st.hp) + '</span>' +
                '<span class="muted">人力 ' + need.manpower + 'k</span>' +
                '<button data-recruit="' + tplId + '"' + (ok ? '' : ' disabled') + '>征兵</button></div>';
        }
        h += '</div>';
        h += '<div class="sec"><div class="secTitle">部队 <span class="muted">（选中 ' + selectedDivs.length + '）</span>' +
            '<button class="mini" data-selall="1">全选</button><button class="mini" data-selnone="1">取消</button></div>';
        // 按名字组合：输入名字片段（逗号/空格分隔）批量选中；也可把当前选择存成编组随时一键召回
        h += '<div class="row wrap">' +
            '<input id="divNameInput" type="text" placeholder="按名字组合：如 第3装甲师, 第5" style="flex:1;min-width:130px">' +
            '<button class="mini" data-divbyname="replace">按名字选中</button>' +
            '<button class="mini" data-divbyname="add">加入选择</button></div>';
        h += '<div class="row wrap">' +
            '<input id="groupNameInput" type="text" placeholder="编组名（如 北线突击群）" style="flex:1;min-width:130px">' +
            '<button class="mini" data-groupsave="1">存为编组</button></div>';
        if ((c.groups || []).length) {
            h += '<div class="row wrap"><span class="muted small">编组</span>' +
                c.groups.map((gr, gi) => '<button class="mini" data-groupsel="' + gi + '">' + gr.name + '（' + gr.divs.length + '）</button>' +
                    '<button class="mini" data-groupdel="' + gi + '" title="删除编组">×</button>').join('') + '</div>';
        }
        const byLoc = {};
        for (const id of c.divisions) {
            const d = w.divisions.find((x) => x.id === id);
            if (!d)
                continue;
            (byLoc[d.loc] = byLoc[d.loc] || []).push(d);
        }
        const keys = Object.keys(byLoc).sort((a, b) => byLoc[b].length - byLoc[a].length);
        for (const pid of keys.slice(0, 40)) {
            const list = byLoc[pid];
            const p = w.provinces[pid];
            h += '<div class="row wrap"><span class="eqName">' + p.name + '</span>' +
                '<span class="muted">' + list.length + ' 个师</span>' +
                '<span class="muted">均org ' + Math.round(list.reduce((s, d) => s + d.org / d.orgMax, 0) / list.length * 100) + '%</span>' +
                '<button class="mini" data-selprov="' + pid + '">该省全选</button>' +
                '<button class="mini" data-unselprov="' + pid + '">该省清空</button>' +
                (list.some((d) => d.battleId != null) ? '<span class="alert">交战中</span>' : '') +
                '</div>';
            // 逐个师：点名字即选中/取消 —— 这样就能把聚在一地的师分成几份，分别调动
            h += '<div class="row wrap" style="margin-left:70px">' + list.map((d) => {
                const on = sel.has(d.id);
                const mark = d.battleId != null ? ' ⚔' : (d.status === 'moving' ? ' →' : '');
                return '<button class="mini' + (on ? ' on' : '') + '" data-seldiv="' + d.id + '" title="' +
                    (on ? '取消选择' : '选中该师') + '">' + d.name + ' · ' + Math.round(d.org / d.orgMax * 100) + '%' + mark + '</button>';
            }).join('') + '</div>';
        }
        h += '<div class="small muted">点单个师的名字可拆开选择；地图上右键下达行军/进攻时，只有选中的师会行动。</div></div>';
        return h;
    }
    function canAfford(c, need) {
        if (c.manpower < need.manpower)
            return false;
        for (const e in need.equip)
            if ((c.stockpile[e] || 0) < need.equip[e])
                return false;
        return true;
    }
    function panelDiplomacy(w, c) {
        let h = '<div class="sec"><div class="secTitle">世界紧张度 ' + Math.round(w.tension) + '%</div>';
        h += '<div class="bar big"><i style="width:' + Math.min(100, w.tension) + '%;background:#e0a03a"></i></div>';
        h += '<div class="small muted">紧张度越高，中立国越容易被卷入；发动战争与吞并会增加紧张度。</div></div>';
        h += '<div class="sec"><div class="secTitle">战争</div>';
        const wars = PSE.World.warsOf(w, c.tag);
        if (!wars.length)
            h += '<div class="muted">当前无战争</div>';
        for (const war of wars) {
            const foes = PSE.World.warEnemies(war, c.tag);
            const allies = war.attackers.indexOf(c.tag) >= 0 ? war.attackers : war.defenders;
            h += '<div class="row wrap"><span class="eqName">我方：' + allies.map((t) => PSE.COUNTRY_NAME[t]).join('、') + '</span>' +
                '<span class="muted">敌方：' + foes.map((t) => PSE.COUNTRY_NAME[t] + (w.countries[t].capitulated ? '(降)' : '')).join('、') + '</span>' +
                '<span class="muted">战争分 ' + (war.warScore || 0).toFixed(0) + '</span></div>';
        }
        h += '</div>';
        h += '<div class="sec"><div class="secTitle">国家</div>';
        const tags = Object.keys(w.countries).filter((t) => t !== c.tag).sort((a, b) => {
            const ra = c.relations[a] || 0, rb = c.relations[b] || 0;
            return rb - ra;
        });
        for (const t of tags) {
            const o = w.countries[t];
            const rel = Math.round(c.relations[t] || 0);
            const atWar = PSE.World.areAtWar(w, c.tag, t);
            const allied = PSE.World.isAllied(w, c.tag, t);
            const hasGoal = !!(c.wargoals && c.wargoals[t]);
            const isPact = PSE.World.isPact(w, c.tag, t);
            const isPuppet = o.puppetOf === c.tag;
            h += '<div class="row wrap"><span class="eqName">' + (o.name || PSE.COUNTRY_NAME[t] || t) + (o.capitulated ? '(已投降)' : '') + '</span>' +
                '<span class="muted">' + PSE.IDEOLOGY_NAME[o.ideology] + '｜关系 ' + rel + '｜师 ' + o.divisions.length + '</span>' +
                (allied ? '<span class="ok">同盟</span>' : atWar ? '<span class="alert">交战</span>' : o.capitulated ? '' :
                    '<button class="mini" data-improve="' + t + '">改善关系</button>' +
                        (isPact ? '<span class="ok">互不侵犯</span>' : '<button class="mini" data-pact="' + t + '">互不侵犯</button>') +
                        '<button class="mini" data-guarantee="' + t + '">保证独立</button>' +
                        '<button class="mini" data-invite="' + t + '">邀请入盟</button>' +
                        '<button class="mini" data-justify="' + t + '"' + (c.justifying || hasGoal ? ' disabled' : '') + '>制造借口</button>' +
                        (hasGoal && !atWar ? '<button class="mini danger" data-declare="' + t + '">宣战</button>' : '')) +
                (isPuppet ? '<span class="ok">你的' + (PSE.AUTONOMY[o.puppetType] ? PSE.AUTONOMY[o.puppetType].name : '傀儡') + '</span>' +
                    '<button class="mini" data-autonomy="' + t + ':puppet">傀儡</button>' +
                    '<button class="mini" data-autonomy="' + t + ':protectorate">保护国</button>' +
                    '<button class="mini" data-autonomy="' + t + ':dominion">自治领</button>' : '') +
                '</div>';
        }
        h += '</div>';
        if (c.justifying) {
            h += '<div class="sec"><div class="secTitle">借口制造中</div><div class="row"><span class="eqName">' +
                PSE.COUNTRY_NAME[c.justifying.target] + '</span><span class="muted">剩余 ' + c.justifying.days + ' 天</span></div></div>';
        }
        return h;
    }
    function panelLogistics(w, c) {
        const res = c.dailyHave || {}, need = c.dailyNeed || {}, avail = c.resourceAvail || {};
        let h = '<div class="sec"><div class="secTitle">资源平衡 <span class="muted">（供给系数 ' + Math.round((c.resourceFactor || 1) * 100) + '%）</span></div>';
        for (const k of ['steel', 'oil', 'rubber', 'aluminum', 'tungsten', 'chromium']) {
            const a = Math.round(avail[k] || 0), n = Math.round(need[k] || 0);
            const pct = n > 0 ? Math.min(100, Math.round(100 * a / n)) : 100;
            h += '<div class="row"><span class="eqName">' + PSE.Sim.resourceName(k) + '</span>' +
                '<div class="bar"><i style="width:' + pct + '%;background:' + (pct < 100 ? '#c07a2a' : '#3f7d3f') + '"></i></div>' +
                '<span class="num">' + a + ' / ' + n + '</span></div>';
        }
        h += '</div>';
        h += '<div class="sec"><div class="secTitle">贸易路线</div>';
        if (!(c.trades || []).length)
            h += '<div class="muted">无贸易路线（自动贸易会在缺口出现时签订）</div>';
        for (const tr of c.trades || []) {
            h += '<div class="row"><span class="eqName">' + PSE.Sim.resourceName(tr.res) + ' ×' + tr.amount + '</span>' +
                '<span class="muted">来自 ' + (PSE.COUNTRY_NAME[tr.partner] || tr.partner) + '（占用 1 民工）</span></div>';
        }
        h += '<div class="row"><label class="muted"><input type="checkbox" id="autoTrade"' + (c.autoTrade === false ? '' : ' checked') + '> 自动贸易</label></div></div>';
        // 补给状态统计
        let full = 0, pen = 0, star = 0, cut = 0;
        const mine = w.provinces.filter((p) => p.controller === c.tag);
        for (const p of mine) {
            const t = PSE.Sim.supplyTier(p.supply);
            if (t === 'full')
                full++;
            else if (t === 'penalty')
                pen++;
            else if (t === 'starving')
                star++;
            else
                cut++;
        }
        h += '<div class="sec"><div class="secTitle">补给网络</div>' +
            '<div class="row wrap"><span class="muted">充足 ' + full + '</span><span class="muted">受限 ' + pen + '</span>' +
            '<span class="muted">匮乏 ' + star + '</span><span class="alert">断供 ' + cut + '</span></div>' +
            '<div class="small muted">补给从首都、港口与大城市（含 2 座以上工厂）向外扩散；距源头越远越弱，被切断的省份完全断供。</div>' +
            '<div class="row"><button data-layer2="supply">查看补给图层</button></div></div>';
        h += '<div class="sec"><div class="secTitle">占领与抵抗</div>';
        let occ = 0, highRes = 0;
        for (const p of mine) {
            if (p.controller === p.owner)
                continue;
            occ++;
            if (p.resistance > 50)
                highRes++;
        }
        h += '<div class="row wrap"><span class="muted">占领省 ' + occ + '</span><span class="alert">高抵抗 ' + highRes + '</span></div>';
        h += '<div class="row"><span class="eqName">占领政策</span>';
        for (const pol of ['harsh', 'gentle', 'collaborative']) {
            h += '<button class="mini' + (c.resistPolicy === pol ? ' on' : '') + '" data-policy="' + pol + '">' +
                { harsh: '高压', gentle: '怀柔', collaborative: '合作' }[pol] + '</button>';
        }
        h += '</div></div>';
        h += '<div class="sec"><div class="secTitle">存档</div><div class="row wrap">' +
            '<button data-save="1">保存</button><button data-load="1">读取</button>' +
            '<button data-export="1">导出存档</button><button data-import="1">导入存档</button><button data-ironman="1">' + (w.ironman ? '铁人：开' : '铁人：关') + '</button>' +
            '</div><div class="small muted">铁人模式：每月自动存档、禁用一切调试命令。</div></div>';
        return h;
    }
    // ============================================================
    // 省份详情
    // ============================================================
    /** 悬停提示的 HTML（纯函数，便于回归测试）。
     *  p 必须是**世界省份**（运行时对象，见 `PSE.World.provinceAt`）：静态地图对象只有 `vp`/`supplyAt`，
     *  直接拿来读 `supply`/`cityVp`/`buildings` 会算出「补给 NaN%」并且丢掉胜利点/军工厂两行。 */
    function provinceTooltipHtml(w, p, divCount) {
        const c = w.countries[p.controller];
        const sup = (typeof p.supply === 'number' && isFinite(p.supply)) ? Math.round(p.supply * 100) + '%' : '—';
        const vp = Math.round(p.cityVp || 0);
        const mil = (p.buildings && p.buildings.mil) || 0;
        return '<b>' + p.name + '</b>（' + (PSE.Render.TERRAIN_NAME[p.terrain] || p.terrain || '') + '）<br>' +
            '控制：' + (c ? c.name : '无') + '｜补给 ' + sup +
            (divCount ? '<br>驻军 ' + divCount + ' 个师' : '') +
            (vp ? '<br>胜利点 ' + vp : '') +
            (p.isPort ? '｜港口' : '') + (mil ? '｜军工厂 ' + mil : '');
    }
    UI.provinceTooltipHtml = provinceTooltipHtml;
    UI.renderProvince = function (g, pid) {
        const w = g.world, c = player(w), p = w.provinces[pid];
        const el = $('provinceInfo');
        if (!p) {
            el.innerHTML = '<div class="muted">点击地图查看省份</div>';
            return;
        }
        const owner = w.countries[p.owner], ctrl = w.countries[p.controller];
        const divs = w.divisions.filter((d) => d.loc === p.id);
        let h = '<div class="provTitle">' + p.name + ' <span class="muted">#' + p.id + '</span></div>';
        h += '<div class="kv"><span>地形</span><b>' + (PSE.Render.TERRAIN_NAME[p.terrain] || p.terrain) + '</b>' +
            '<span>天气</span><b>' + (PSE.Sim.WEATHER_NAME[p.weather || 0]) + '</b></div>';
        h += '<div class="kv"><span>所有者</span><b style="color:' + (owner ? owner.color : '#999') + '">' + (owner ? owner.name : '无') + '</b>' +
            '<span>控制者</span><b style="color:' + (ctrl ? ctrl.color : '#999') + '">' + (ctrl ? ctrl.name : '无') + '</b></div>';
        h += '<div class="kv"><span>胜利点</span><b>' + p.cityVp + '</b><span>人口</span><b>' + (p.pop || 0).toFixed(1) + 'M</b></div>';
        h += '<div class="kv"><span>基建</span><b>' + p.infra + '</b><span>要塞</span><b>' + p.fort + '</b>' +
            '<span>港口</span><b>' + (p.isPort ? '是' : '否') + '</b></div>';
        h += '<div class="kv"><span>补给</span><b>' + Math.round(p.supply * 100) + '%（' + tierName(PSE.Sim.supplyTier(p.supply)) + '）</b></div>';
        if (p.controller !== p.owner) {
            h += '<div class="kv"><span>抵抗度</span><b>' + Math.round(p.resistance) + '</b><span>合作度</span><b>' + Math.round(p.compliance) + '</b></div>';
        }
        const resTxt = Object.keys(p.resource).filter((k) => p.resource[k] > 0)
            .map((k) => PSE.Sim.resourceName(k) + ' ' + p.resource[k]).join('、');
        if (resTxt)
            h += '<div class="small">资源：' + resTxt + '</div>';
        if (p.buildings && (p.buildings.civ || p.buildings.mil || p.buildings.dock)) {
            h += '<div class="small">工厂：民用 ' + (p.buildings.civ || 0) + '｜军用 ' + (p.buildings.mil || 0) + '｜船坞 ' + (p.buildings.dock || 0) + '</div>';
        }
        if (divs.length) {
            h += '<div class="small">驻军：' + divs.length + ' 个师';
            const own = divs.filter((d) => d.tag === c.tag);
            if (own.length)
                h += '（我方 ' + own.length + '）';
            h += '</div>';
            // 逐个师点名：点名字即选中/取消 —— 一地的师可以拆成几份分别调动
            h += '<div class="row wrap">' + divs.slice(0, 14).map((d) => {
                const mine = d.tag === c.tag;
                const on = selectedDivs.indexOf(d.id) >= 0;
                return '<button class="mini' + (on ? ' on' : '') + '"' + (mine ? ' data-seldiv="' + d.id + '"' : ' disabled') +
                    ' title="' + (mine ? (on ? '取消选择' : '选中该师') : '他国部队') + '">' + d.name + ' · ' +
                    Math.round(d.org / d.orgMax * 100) + '%</button>';
            }).join('') + (own.length && own.length < divs.length ? '<span class="muted small">他国师不可选</span>' : '') + '</div>';
        }
        // 命令
        h += '<div class="row wrap">';
        if (selectedDivs.length) {
            h += '<button data-order-move="' + p.id + '">移动到此处</button>';
            const hostile = PSE.World.areAtWar(w, c.tag, p.controller) || (p.controller !== c.tag && divs.some((d) => d.tag !== c.tag));
            if (hostile)
                h += '<button class="danger" data-order-attack="' + p.id + '">进攻此处</button>';
        }
        h += '<button data-build-prov="' + p.id + '">在此建设</button>';
        h += '</div>';
        el.innerHTML = h;
    };
    function tierName(t) { return { full: '充足', penalty: '受限', starving: '匮乏', cut: '断供' }[t] || t; }
    // ============================================================
    // 事件弹窗 / 日志 / 提示
    // ============================================================
    /** 内容签名：同一事件/会议在每 350ms 的 UI tick 里**不要重建含按钮的 DOM**。
     *  重建会销毁玩家正按下的按钮（mousedown 与 mouseup 跨过一次重建 → 浏览器不派发 click），
     *  玩家表现为「点了没反应，要再点一次」。（与生产面板防闪白同一套做法。） */
    let evtSig = '', peaceSig = '', logSig = '';
    UI.renderEvent = function (g) {
        const w = g.world;
        const cur = w.events.current;
        const modal = $('eventModal');
        if (!modal)
            return;
        if (!cur || cur.tag !== w.playerTag) {
            evtSig = '';
            modal.classList.add('hidden');
            return;
        }
        const ev = PSE.EVENTS[cur.id];
        if (!ev) {
            evtSig = '';
            w.events.current = null;
            modal.classList.add('hidden');
            return;
        }
        modal.classList.remove('hidden');
        setText('eventTitle', ev.title);
        setText('eventDesc', ev.desc || '');
        const sig = cur.tag + '|' + cur.id + '|' + ev.options.length;
        const optEl = $('eventOptions');
        if (optEl && sig !== evtSig) {
            evtSig = sig;
            optEl.innerHTML = ev.options.map((o, i) => '<div class="eventOpt"><button data-event-opt="' + i + '">' + o.name + '</button>' +
                '<div class="small muted">' + (o.effects || []).map(describeEffect).filter(Boolean).join('・') + '</div></div>').join('');
        }
        w.speed = 0; // 事件强制暂停
    };
    UI.renderLog = function (g) {
        const w = g.world;
        const items = (w.log || []).slice(-40).reverse();
        const top = items[0];
        const sig = items.length + '|' + (top ? top.h + '#' + top.text : '');
        if (sig === logSig)
            return; // 没有新日志就不动 DOM（避免丢掉玩家的文本选择）
        logSig = sig;
        setHtml('log', items.map((it) => '<div class="logLine ' + it.kind + '"><span class="muted">' + PSE.Time.format(it.h).slice(5, 16) + '</span> ' + it.text + '</div>').join(''));
    };
    UI.toast = function (text, kind) {
        const el = document.createElement('div');
        el.className = 'toast ' + (kind || '');
        el.textContent = text;
        const box = $('toasts');
        if (box)
            box.appendChild(el);
        setTimeout(() => el.remove(), 4200);
    };
    // ============================================================
    // 事件绑定
    // ============================================================
    UI.bindPanel = function (g) {
        const w = g.world, el = $('panelBody');
        // 只绑一次：面板内按住鼠标时禁止定时重绘（否则 mousedown 与 mouseup 之间节点被换掉，点击丢失）
        if (el && el.addEventListener && !UI.bindPanel._pressed) {
            UI.bindPanel._pressed = true;
            el.addEventListener('pointerdown', () => { panelPressed = true; }, true);
            if (document.addEventListener) {
                document.addEventListener('pointerup', () => { panelPressed = false; }, true);
                document.addEventListener('pointercancel', () => { panelPressed = false; }, true);
            }
        }
        const np = $('newProd');
        if (np)
            np.onchange = () => { newProdPick = np.value; };
        el.querySelectorAll('[data-prod-inc]').forEach((b) => b.onclick = () => {
            const l = player(w).production.find((x) => x.id === +b.dataset.prodInc);
            if (l) {
                const want = l.factories + 1;
                PSE.Cmd.setProdFactories(w, l.id, want);
                // 加不上去时说清原因（旧版静默夹住额度，玩家会以为「明明有空工厂却加不了」）
                if (l.factories < want) {
                    UI.toast('没有空闲军工可分配（军工 ' + player(w).factories.mil + '，已分配 ' + PSE.Cmd.prodUsedMil(player(w)) + '）', 'warn');
                }
            }
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-prod-dec]').forEach((b) => b.onclick = () => {
            const l = player(w).production.find((x) => x.id === +b.dataset.prodDec);
            if (l)
                PSE.Cmd.setProdFactories(w, l.id, Math.max(0, l.factories - 1));
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-prod-del]').forEach((b) => b.onclick = () => {
            PSE.Cmd.removeProduction(w, +b.dataset.prodDel);
            UI.renderPanel(g);
        });
        const addBtn = el.querySelector('[data-add-prod]');
        if (addBtn)
            addBtn.onclick = () => {
                const sel = $('newProd');
                if (!sel)
                    return;
                newProdPick = sel.value;
                // 用 addProductionEx 取回真实原因：面板口径与命令口径一致，不再把「已有产线」误报成「没有空闲」
                const r = PSE.Cmd.addProductionEx(w, sel.value);
                if (r.ok) {
                    UI.renderPanel(g);
                    UI.toast(r.msg);
                }
                else
                    UI.toast(r.msg || '无法新增产线', 'warn');
            };
        el.querySelectorAll('[data-build]').forEach((b) => b.onclick = () => {
            const pid = (PSE.Render.selectedProv != null) ? PSE.Render.selectedProv : player(w).capital;
            const r = PSE.Cmd.queueBuildEx(w, b.dataset.build, pid);
            if (r.ok)
                UI.toast(r.msg);
            else
                UI.toast(r.msg || '无法在该省建设', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-advisor]').forEach((b) => b.onclick = () => {
            if (!PSE.Cmd.buyAdvisor(w, b.dataset.advisor))
                UI.toast('政治点不足', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-law]').forEach((b) => b.onclick = () => {
            if (!PSE.Cmd.changeLaw(w, b.dataset.law, +b.dataset.val))
                UI.toast('政治点不足', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-research]').forEach((s) => s.onchange = () => {
            const r = PSE.Cmd.setResearchEx(w, +s.dataset.research, s.value);
            if (r.ok)
                UI.toast(r.msg);
            else
                UI.toast(r.msg || '无法开始研究', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-focus]').forEach((b) => b.onclick = () => {
            if (!PSE.Cmd.startFocus(w, b.dataset.focus))
                UI.toast('无法启动该国的国策', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-recruit]').forEach((b) => b.onclick = () => {
            if (!PSE.Cmd.recruit(w, b.dataset.recruit, 1))
                UI.toast('人力或装备不足', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-selprov]').forEach((b) => b.onclick = () => {
            const pid = +b.dataset.selprov;
            selectedDivs = w.divisions.filter((d) => d.tag === w.playerTag && d.loc === pid).map((d) => d.id);
            UI.renderPanel(g);
            UI.renderProvince(g, pid);
        });
        // —— 逐个师选择（拆分同省堆叠）/ 该省清空 / 按名字组合 / 编组 ——
        el.querySelectorAll('[data-seldiv]').forEach((b) => b.onclick = () => {
            UI.toggleDiv(+b.dataset.seldiv);
            UI.renderPanel(g);
            UI.renderProvince(g, PSE.Render.selectedProv);
        });
        el.querySelectorAll('[data-unselprov]').forEach((b) => b.onclick = () => {
            const pid = +b.dataset.unselprov;
            const drop = new Set(w.divisions.filter((d) => d.tag === w.playerTag && d.loc === pid).map((d) => d.id));
            UI.selectDivs(selectedDivs.filter((id) => !drop.has(id)));
            UI.renderPanel(g);
            UI.renderProvince(g, pid);
        });
        el.querySelectorAll('[data-divbyname]').forEach((b) => b.onclick = () => {
            const inp = $('divNameInput');
            const n = UI.selectByName(w, inp ? inp.value : '', b.dataset.divbyname).length;
            UI.toast(n ? '按名字选中 ' + n + ' 个师' : '没有匹配的师', n ? '' : 'warn');
            UI.renderPanel(g);
            UI.renderProvince(g, PSE.Render.selectedProv);
        });
        el.querySelectorAll('[data-groupsave]').forEach((b) => b.onclick = () => {
            const inp = $('groupNameInput');
            const nm = inp && inp.value ? String(inp.value).trim() : '';
            if (!nm) {
                UI.toast('先在右侧填编组名', 'warn');
                return;
            }
            if (!selectedDivs.length) {
                UI.toast('先选中若干师', 'warn');
                return;
            }
            UI.saveGroup(w, nm);
            UI.toast('编组「' + nm + '」已保存（' + selectedDivs.length + ' 个师）');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-groupsel]').forEach((b) => b.onclick = () => {
            const gr = (player(w).groups || [])[+b.dataset.groupsel];
            const n = gr ? UI.selectGroup(w, gr.name).length : 0;
            UI.toast(n ? '已选中编组「' + gr.name + '」：' + n + ' 个师' : '该编组已无可用师', n ? '' : 'warn');
            UI.renderPanel(g);
            UI.renderProvince(g, PSE.Render.selectedProv);
        });
        el.querySelectorAll('[data-groupdel]').forEach((b) => b.onclick = () => {
            const gr = (player(w).groups || [])[+b.dataset.groupdel];
            if (gr) {
                UI.deleteGroup(w, gr.name);
                UI.toast('已删除编组「' + gr.name + '」');
            }
            UI.renderPanel(g);
        });
        const sa = el.querySelector('[data-selall]');
        if (sa)
            sa.onclick = () => { selectedDivs = player(w).divisions.slice(); UI.renderPanel(g); };
        const sn = el.querySelector('[data-selnone]');
        if (sn)
            sn.onclick = () => { selectedDivs = []; UI.renderPanel(g); };
        el.querySelectorAll('[data-justify]').forEach((b) => b.onclick = () => {
            if (!PSE.Cmd.justifyWarGoal(w, b.dataset.justify))
                UI.toast('政治点不足或已有借口', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-declare]').forEach((b) => b.onclick = () => {
            PSE.Cmd.declareWar(w, b.dataset.declare);
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-policy]').forEach((b) => b.onclick = () => {
            PSE.Cmd.setResistPolicy(w, b.dataset.policy);
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-layer2]').forEach((b) => b.onclick = () => UI.setLayer(b.dataset.layer2, g));
        const at = $('autoTrade');
        if (at)
            at.onchange = () => { player(w).autoTrade = at.checked; };
        el.querySelectorAll('[data-save]').forEach((b) => b.onclick = () => UI.save(g));
        el.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => UI.load(g));
        el.querySelectorAll('[data-export]').forEach((b) => b.onclick = () => UI.exportSave(g));
        el.querySelectorAll('[data-import]').forEach((b) => b.onclick = () => UI.importSave(g));
        el.querySelectorAll('[data-ironman]').forEach((b) => b.onclick = () => {
            w.ironman = !w.ironman;
            UI.toast(w.ironman ? '铁人模式开启：每月自动存档' : '铁人模式关闭');
            UI.renderPanel(g);
        });
        // —— 决议 / 学说 / 集团军命令 ——
        el.querySelectorAll('[data-decision]').forEach((b) => b.onclick = () => {
            const c = player(w);
            if (!PSE.Decisions.start(w, c, b.dataset.decision))
                UI.toast('政治点不足或冷却中', 'warn');
            else
                UI.toast('决议已启动');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-doctrine]').forEach((b) => b.onclick = () => {
            const c = player(w);
            if (!PSE.Doctrine.buy(w, c, b.dataset.doctrine))
                UI.toast('陆军经验不足或前置未满足', 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-order]').forEach((b) => b.onclick = () => {
            const [aid, order] = b.dataset.order.split(':');
            const c = player(w);
            const a = (c.armies || []).find((x) => x.id === +aid);
            if (a) {
                a.order = order;
                UI.toast(a.name + ' 命令：' + { hold: '防守', advance: '推进', blitz: '强攻' }[order]);
            }
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-army-select]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const a = (c.armies || []).find((x) => x.id === +b.dataset.armySelect);
            if (a)
                selectedDivs = a.divisions.filter((id) => w.divisions.some((d) => d.id === id && d.tag === c.tag));
            UI.renderPanel(g);
        });
        // —— 集团军自定义：新建 / 解散 / 编成 / 改名 / 换将 ——
        el.querySelectorAll('[data-army-add]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const a = PSE.Army.add(w, c);
            const ng = (c.generals || []).find((x) => x.id === a.generalId);
            UI.toast('已新建 ' + a.name + (ng ? '（将领 ' + ng.name + '）' : ''));
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-army-del]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const a = (c.armies || []).find((x) => x.id === +b.dataset.armyDel);
            if (a && PSE.Army.remove(w, c, a.id))
                UI.toast(a.name + ' 已解散（原部队变为待编）');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-army-set]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const a = (c.armies || []).find((x) => x.id === +b.dataset.armySet);
            if (!a)
                return;
            if (!selectedDivs.length) {
                UI.toast('先在「部队」区点选若干师', 'warn');
                return;
            }
            const n = PSE.Army.setDivisions(w, c, a.id, selectedDivs);
            UI.toast('已把 ' + n + ' 个师编入 ' + a.name);
            UI.renderPanel(g);
            UI.renderProvince(g, PSE.Render.selectedProv);
        });
        el.querySelectorAll('[data-army-pull]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const a = (c.armies || []).find((x) => x.id === +b.dataset.armyPull);
            if (!selectedDivs.length) {
                UI.toast('先在「部队」区点选若干师', 'warn');
                return;
            }
            const n = PSE.Army.releaseDivisions(w, c, selectedDivs);
            UI.toast('已从' + (a ? a.name + '等' : '') + '调出 ' + n + ' 个师（待编）');
            UI.renderPanel(g);
            UI.renderProvince(g, PSE.Render.selectedProv);
        });
        el.querySelectorAll('[data-army-rename]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const inp = $('armyName' + b.dataset.armyRename);
            if (!inp || !inp.value) {
                UI.toast('先在左侧输入框填新名字', 'warn');
                return;
            }
            const a = (c.armies || []).find((x) => x.id === +b.dataset.armyRename);
            if (PSE.Army.rename(w, c, +b.dataset.armyRename, inp.value))
                UI.toast(a ? '已改名：' + inp.value : '');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-army-general]').forEach((s) => s.onchange = () => {
            const c = player(w);
            if (PSE.Army.setGeneral(w, c, +s.dataset.armyGeneral, +s.value))
                UI.toast('将领已调整');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-army-auto]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const total = PSE.Army.autoFill(w, c);
            UI.toast('已按系统自动编组（在编 ' + total + ' 个师）');
            UI.renderPanel(g);
        });
        // —— 产线换型 ——
        el.querySelectorAll('[data-switch]').forEach((s) => s.onchange = () => {
            if (!PSE.Cmd.switchLine(w, +s.dataset.switch, s.value))
                UI.toast('无法换型', 'warn');
            else
                UI.toast('换型开始：效率归零后重新爬坡');
            UI.renderPanel(g);
        });
        // —— 装备设计器 / 军贸 ——
        el.querySelectorAll('[data-design]').forEach((sel) => {
            const handler = () => {
                const [k, v] = sel.dataset.design.split(':');
                UI.setDesign(k, v);
                UI.renderPanel(g);
            };
            if (sel.tagName === 'SELECT')
                sel.onchange = handler;
            else
                sel.onclick = handler;
        });
        const saveDesign = el.querySelector('[data-design-save]');
        if (saveDesign)
            saveDesign.onclick = () => {
                const c = player(w);
                const def = PSE.Cmd.designEquipment(w, c, UI.getDesign());
                if (def)
                    UI.toast('已定型：' + def.name);
                UI.renderPanel(g);
            };
        el.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const ok = PSE.EquipTrade.buy(w, c, +b.dataset.buy, 500);
            UI.toast(ok ? '采购成功' : '信用点不足或库存不足', ok ? '' : 'warn');
            UI.renderPanel(g);
        });
        const sellBtn = el.querySelector('[data-sell]');
        if (sellBtn)
            sellBtn.onclick = () => {
                const c = player(w);
                const eqId = document.getElementById('sellEquip').value;
                PSE.EquipTrade.list(w, c, eqId, 2000, 1.5);
                UI.toast('已挂牌出售 2000 件' + PSE.EQUIP_NAME(eqId));
                UI.renderPanel(g);
            };
        el.querySelectorAll('[data-lend]').forEach((b) => b.onclick = () => {
            const c = player(w);
            const target = w.countries[b.dataset.lend];
            PSE.EquipTrade.lendLease(w, c, target, 'infantry_equipment_1', 60);
            UI.toast('已向 ' + target.name + ' 提供租借');
            UI.renderPanel(g);
        });
        // —— 海军 / 空军 / 谍报 ——
        const invBtn = el.querySelector('[data-invasion]');
        if (invBtn)
            invBtn.onclick = () => {
                const target = PSE.Render.selectedProv;
                if (target == null) {
                    UI.toast('请先在地图上点选目标省', 'warn');
                    return;
                }
                const r = PSE.Cmd.navalInvasion(w, selectedDivs, target);
                UI.toast(r.msg, r.ok ? '' : 'warn');
            };
        el.querySelectorAll('[data-wing]').forEach((s) => s.onchange = () => {
            const c = player(w);
            const wing = c.airWings.find((x) => String(x.id) === s.dataset.wing);
            if (wing)
                wing.mission = s.value;
            UI.toast('联队任务：' + (PSE.AIR_MISSION_NAME[s.value] || s.value));
        });
        const agBtn = el.querySelector('[data-agency]');
        if (agBtn)
            agBtn.onclick = () => {
                const r = PSE.Spy.buildEx(w, player(w));
                UI.toast(r.msg, r.ok ? '' : 'warn');
                UI.renderPanel(g);
            };
        const recBtn = el.querySelector('[data-recruit-spy]');
        if (recBtn)
            recBtn.onclick = () => {
                const r = PSE.Spy.recruitEx(w, player(w));
                UI.toast(r.msg, r.ok ? '' : 'warn');
                UI.renderPanel(g);
            };
        el.querySelectorAll('[data-spy-go]').forEach((b) => b.onclick = () => {
            const mission = b.dataset.spyGo;
            const selEl = el.querySelector('[data-spy-opt="' + mission + '"]');
            const target = selEl ? selEl.value : null;
            const r = PSE.Spy.send(w, player(w), target, mission);
            UI.toast(r.msg, r.ok ? '' : 'warn');
            UI.renderPanel(g);
        });
        // —— 外交行动 ——
        el.querySelectorAll('[data-improve]').forEach((b) => b.onclick = () => {
            const r = PSE.Cmd.improveRelations(w, b.dataset.improve);
            UI.toast(r.msg, r.ok ? '' : 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-invite]').forEach((b) => b.onclick = () => {
            const r = PSE.Cmd.inviteToFaction(w, b.dataset.invite);
            UI.toast(r.msg, r.ok ? '' : 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-pact]').forEach((b) => b.onclick = () => {
            const r = PSE.Cmd.nonAggression(w, b.dataset.pact);
            UI.toast(r.msg, r.ok ? '' : 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-guarantee]').forEach((b) => b.onclick = () => {
            const r = PSE.Cmd.guarantee(w, b.dataset.guarantee);
            UI.toast(r.msg, r.ok ? '' : 'warn');
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-autonomy]').forEach((b) => b.onclick = () => {
            const [tag, lvl] = b.dataset.autonomy.split(':');
            PSE.Cmd.setAutonomy(w, tag, lvl);
            UI.renderPanel(g);
        });
    };
    // 设计器状态（供 UI 与 bindPanel 共享）
    UI.getDesign = function () { return Object.assign({}, design); };
    UI.setDesign = function (k, v) {
        if (!design)
            design = {};
        if (k === 'role')
            design.role = v;
        else if (k.indexOf(':') >= 0) {
            const [kk, vv] = k.split(':');
            design[kk] = vv;
        }
        else
            design[k] = v;
    };
    // ============================================================
    // 和平会议弹窗
    // ============================================================
    UI.renderPeace = function (g) {
        const w = g.world;
        const modal = $('peaceModal');
        if (!modal)
            return;
        const pc = w.peaceConference;
        if (!pc || pc.main !== w.playerTag) {
            peaceSig = '';
            modal.classList.add('hidden');
            return;
        }
        modal.classList.remove('hidden');
        const d = w.countries[pc.defeated];
        setText('peaceTitle', '和平会议：' + (d ? d.name : pc.defeated) + ' 的命运');
        // 内容签名：同一场会议不重复重建选项（每 tick 重建会吞掉正在按下的点击）——见 renderEvent 说明
        const sig = pc.defeated + '|' + pc.main + '|' + w.playerTag;
        const opts = $('peaceOptions');
        if (opts && sig !== peaceSig) {
            peaceSig = sig;
            setHtml('peaceDesc', '你在这场战争中的贡献最高，拥有处置权。选择对该国的处置方式：');
            setHtml('peaceOptions', '<div class="eventOpt"><button data-peace="annex">吞并（领土与工厂全部并入）</button></div>' +
                '<div class="eventOpt"><button data-peace="puppet">扶植傀儡政权（保留政府，征收工厂与人力）</button></div>' +
                '<div class="eventOpt"><button data-peace="liberate">恢复独立（大幅改善关系）</button></div>');
            opts.querySelectorAll('[data-peace]').forEach((b) => b.onclick = () => {
                PSE.Peace.apply(w, b.dataset.peace);
                modal.classList.add('hidden');
                w.speed = g.lastSpeed || 2;
                UI.renderAll(g);
                UI.toast('和平会议结束');
            });
        }
        w.speed = 0;
    };
    UI.bindProvince = function (g) {
        const el = $('provinceInfo'), w = g.world;
        el.querySelectorAll('[data-seldiv]').forEach((b) => b.onclick = () => {
            UI.toggleDiv(+b.dataset.seldiv);
            UI.renderProvince(g, PSE.Render.selectedProv);
            UI.renderPanel(g);
        });
        el.querySelectorAll('[data-order-move]').forEach((b) => b.onclick = () => {
            const n = PSE.Cmd.orderMove(w, selectedDivs, +b.dataset.orderMove);
            UI.toast(n ? n + ' 个师开始行军' : '无法抵达该省');
        });
        el.querySelectorAll('[data-order-attack]').forEach((b) => b.onclick = () => {
            const n = PSE.Cmd.orderMove(w, selectedDivs, +b.dataset.orderAttack);
            UI.toast(n ? n + ' 个师发起进攻' : '无法抵达该省');
        });
        el.querySelectorAll('[data-build-prov]').forEach((b) => b.onclick = () => {
            PSE.Cmd.queueBuild(w, 'infra', +b.dataset.buildProv);
            UI.toast('已加入建设队列');
        });
    };
    UI.bindEvent = function (g) {
        const el = $('eventOptions');
        el.querySelectorAll('[data-event-opt]').forEach((b) => b.onclick = () => {
            PSE.Events.resolve(g.world, +b.dataset.eventOpt, false);
            $('eventModal').classList.add('hidden');
            g.world.speed = g.lastSpeed || 2;
            UI.renderAll(g);
        });
    };
    UI.save = function (g) {
        const r = PSE.Save.save(g.world, g.world.ironman ? 'ironman' : 'slot1', {});
        UI.toast(r.ok ? '已保存（' + Math.round(r.bytes / 1024) + ' KB，校验 ' + r.hash + '）' : '保存失败：' + r.error, r.ok ? '' : 'warn');
    };
    UI.load = function (g) {
        const slot = g.world.ironman ? 'ironman' : 'slot1';
        const w = PSE.Save.load(slot);
        if (!w) {
            UI.toast('没有找到存档', 'warn');
            return;
        }
        g.world = w;
        PSE.Sim.rebuildDivIndex(w);
        PSE.Render.game = g;
        selectedDivs = [];
        UI.toast('已读取存档：' + PSE.Time.formatShort(w.hour));
        UI.renderAll(g);
    };
    UI.exportSave = function (g) {
        const text = PSE.Save.exportText(g.world);
        const name = 'pse-save-' + g.world.playerTag + '-' + Math.floor(g.world.hour / 24) + 'd.json';
        // 桌面壳（Tauri/Electron）走原生保存对话框，浏览器走下载
        const ok = PSE.Platform ? PSE.Platform.download(name, text) : false;
        if (!ok) {
            const blob = new Blob([text], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
        }
        UI.toast('存档已导出' + (PSE.Platform && PSE.Platform.isDesktop() ? '（原生对话框）' : ''));
    };
    /** 导入存档文件：桌面壳/浏览器统一入口 */
    UI.importSave = function (g) {
        if (!PSE.Platform) {
            UI.toast('导入不可用', 'warn');
            return;
        }
        PSE.Platform.pickText().then((text) => {
            if (!text)
                return;
            const w = PSE.Save.importText(text);
            if (!w) {
                UI.toast('存档文件读取失败', 'warn');
                return;
            }
            g.world = w;
            PSE.Sim.rebuildDivIndex(w);
            PSE.Render.game = g;
            selectedDivs = [];
            UI.toast('已导入存档：' + PSE.Time.formatShort(w.hour));
            UI.renderAll(g);
        });
    };
    UI.setLayer = function (layer, g) {
        PSE.Render.setLayer(layer);
        document.querySelectorAll('[data-layer]').forEach((b) => b.classList.toggle('on', b.dataset.layer === layer));
        if (g)
            UI.toast('图层：' + PSE.Render.LAYER_NAME[layer]);
    };
    UI.renderAll = function (g) {
        UI.renderTop(g);
        renderPanelHeader();
        UI.renderPanel(g);
        UI.renderProvince(g, PSE.Render.selectedProv);
        UI.renderLog(g);
        UI.renderEvent(g);
        UI.renderPeace(g);
    };
    UI.setTab = function (t, g) {
        tab = t;
        document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
        renderPanelHeader(true);
        UI.renderPanel(g);
        UI.bindProvince(g);
    };
    UI.selectedDivs = () => selectedDivs;
    // ============================================================
    // 师团选择 / 编组：同省堆叠可逐个师拆开选择，也可按名字组合
    // ============================================================
    /** 替换当前选择 */
    UI.selectDivs = function (ids) {
        selectedDivs = (ids || []).slice();
        return selectedDivs.slice();
    };
    /** 逐个师开关（拆分同省堆叠的核心：把某几个师移出/移入选择） */
    UI.toggleDiv = function (id) {
        const i = selectedDivs.indexOf(id);
        if (i >= 0)
            selectedDivs.splice(i, 1);
        else
            selectedDivs.push(id);
        return selectedDivs.slice();
    };
    /** 该国现役师（去掉已解散/阵亡的 id） */
    function liveDivs(w, c) {
        const out = [];
        for (const id of (c.divisions || [])) {
            const d = w.divisions.find((x) => x.id === id);
            if (d)
                out.push(d);
        }
        return out;
    }
    UI.liveDivs = function (g) { return liveDivs(g.world, player(g.world)); };
    /** 按名字组合：逗号/空格分隔的若干子串，命中任意一个即选中（默认替换选择） */
    UI.selectByName = function (w, text, mode) {
        const toks = String(text == null ? '' : text).split(/[,，、;；\s]+/).filter(Boolean);
        if (!toks.length)
            return selectedDivs.slice();
        const c = player(w);
        const hits = liveDivs(w, c).filter((d) => toks.some((t) => String(d.name || '').indexOf(t) >= 0));
        const ids = hits.map((d) => d.id);
        if (mode === 'add') {
            for (const id of ids)
                if (selectedDivs.indexOf(id) < 0)
                    selectedDivs.push(id);
        }
        else {
            selectedDivs = ids.slice();
        }
        return selectedDivs.slice();
    };
    /** 把当前选择存成命名编组（同名覆盖），随国家状态一起存档 */
    UI.saveGroup = function (w, name) {
        const nm = String(name == null ? '' : name).trim();
        const c = player(w);
        c.groups = c.groups || [];
        if (!nm)
            return null;
        const divs = selectedDivs.slice();
        const old = c.groups.find((x) => x.name === nm);
        if (old)
            old.divs = divs;
        else
            c.groups.push({ name: nm, divs: divs });
        return { name: nm, divs: divs };
    };
    /** 一键选中某编组（自动剔除已不存在的师） */
    UI.selectGroup = function (w, name) {
        const c = player(w);
        const gr = (c.groups || []).find((x) => x.name === name);
        if (!gr)
            return [];
        const alive = gr.divs.filter((id) => w.divisions.some((d) => d.id === id && d.tag === c.tag));
        gr.divs = alive;
        selectedDivs = alive.slice();
        return selectedDivs.slice();
    };
    UI.deleteGroup = function (w, name) {
        const c = player(w);
        c.groups = (c.groups || []).filter((x) => x.name !== name);
    };
    UI.groupsOf = function (w) { return player(w).groups || []; };
})(typeof window !== 'undefined' ? window : globalThis);
