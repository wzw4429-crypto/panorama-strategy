/* PSE · 主程序 (main.js)
 * 启动、主循环（真实时间 → 游戏小时）、摄像机输入（拖动平移/滚轮缩放）、面板与快捷键、自动存档。
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});

  const HOUR_MS = { 0: Infinity, 1: 400, 2: 160, 3: 60, 4: 20, 5: 6 };

  const Game = (PSE.Game = {
    world: null, lastSpeed: 2, acc: 0, lastFrame: 0, lastUi: 0, lastAuto: 0, running: false,
  }) as any;

  Game.start = function (playerTag, opts) {
    opts = opts || {};
    Game.world = PSE.World.create({ playerTag, speed: 2, seed: opts.seed || 19360101, ironman: !!opts.ironman });
    PSE.Sim.rebuildDivIndex(Game.world);
    Game.lastSpeed = 2;
    Game.acc = 0; Game.lastAuto = 0;
    const ov = (document.getElementById('startOverlay') as any);
    if (ov) ov.classList.add('hidden');
    PSE.UI.setLayer('political', Game);
    // 开局镜头对准首都
    const cap = Game.world.provinces[Game.world.countries[playerTag].capital];
    if (cap) PSE.Render.centerOn(cap.cx, cap.cy, 5.5);
    PSE.UI.renderAll(Game);
    Game.running = true;
    Game.lastFrame = (root.performance || Date).now();
    root.requestAnimationFrame(loop);
  };

  function loop(now) {
    const g = Game, w = g.world;
    const dt = Math.min(250, now - g.lastFrame);
    g.lastFrame = now;
    if (!w) { root.requestAnimationFrame(loop); return; }

    if (!w.gameOver) {
      const per = HOUR_MS[w.speed] || 0;
      if (w.speed > 0 && isFinite(per)) {
        g.acc += dt;
        let budget = 32;
        while (g.acc >= per && budget-- > 0) {
          g.acc -= per;
          PSE.Sim.tickHour(w);
          if (w.events.current && w.events.current.tag === w.playerTag) {
            g.lastSpeed = w.speed || 2;
            w.speed = 0; g.acc = 0;
            break;
          }
          if (w.gameOver) break;
        }
      }
      const day = Math.floor(w.hour / 24);
      if (w.ironman && day - g.lastAuto >= 30) {
        g.lastAuto = day;
        const r = PSE.Save.save(w, 'ironman', {});
        if (r.ok) PSE.UI.toast('铁人自动存档（' + PSE.Time.formatShort(w.hour) + '）');
      }
    }

    PSE.Render.draw(dt);
    if (now - g.lastUi > 350) {
      g.lastUi = now;
      PSE.UI.renderTop(g);
      PSE.UI.renderEvent(g);
      PSE.UI.renderPeace(g);
      PSE.UI.renderLog(g);
      const tab = PSE.UI.state.tab();
      if (tab === 'production' || tab === 'army' || tab === 'equipment' || tab === 'navy') PSE.UI.tickPanel(g);
      if (w.gameOver) showGameOver(w);
    }
    root.requestAnimationFrame(loop);
  }

  function showGameOver(w) {
    const el = (document.getElementById('gameOver') as any);
    if (!el || !el.classList.contains('hidden')) return;
    el.classList.remove('hidden');
    (document.getElementById('gameOverText') as any).innerHTML = w.gameOver.win
      ? '<b class="ok">胜利！</b><br>' + w.gameOver.reason + '<br>' + PSE.Time.formatShort(w.hour)
      : '<b class="alert">战败</b><br>' + w.gameOver.reason + '<br>' + PSE.Time.formatShort(w.hour);
  }

  // ============================================================
  // 输入：摄像机 + 选择 + 命令
  // ============================================================
  function bindInput() {
    const canvas = (document.getElementById('map') as any);
    const tip = (document.getElementById('tooltip') as any);
    let dragging = false, dragMoved = 0, lastX = 0, lastY = 0;

    function localPos(e) {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    function provAtEvent(e) {
      const [px, py] = localPos(e);
      const ll = PSE.Render.screenToLonLat(px, py);
      return PSE.MapData.pickProvince(ll[0], ll[1]);
    }

    canvas.addEventListener('mousedown', (e: any) => {
      if (e.button !== 0) return;
      if (touchActive > 0) return;      // 触屏进行中：忽略模拟鼠标事件，避免双重平移
      dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY;
    });
    root.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('mousemove', (e: any) => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          dragMoved += Math.abs(dx) + Math.abs(dy);
          PSE.Render.pan(dx, dy);
          lastX = e.clientX; lastY = e.clientY;
        }
        return;
      }
      const p = provAtEvent(e);
      PSE.Render.hover = p ? p.id : null;
      if (!tip) return;
      if (p) {
        const w = Game.world;
        const c = w.countries[p.controller];
        tip.classList.remove('hidden');
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
        const divs = w.divisions.filter((d) => d.loc === p.id);
        tip.innerHTML = '<b>' + p.name + '</b>（' + (PSE.Render.TERRAIN_NAME[p.terrain] || '') + '）<br>' +
          '控制：' + (c ? c.name : '无') + '｜补给 ' + Math.round(p.supply * 100) + '%' +
          (divs.length ? '<br>驻军 ' + divs.length + ' 个师' : '') +
          (p.cityVp ? '<br>胜利点 ' + p.cityVp : '') +
          (p.isPort ? '｜港口' : '') + (p.buildings && p.buildings.mil ? '｜军工厂 ' + p.buildings.mil : '');
      } else tip.classList.add('hidden');
    });
    canvas.addEventListener('mouseleave', () => {
      PSE.Render.hover = null;
      if (tip) tip.classList.add('hidden');
    });
    canvas.addEventListener('click', (e: any) => {
      if (dragMoved > 6) return;       // 拖动不触发点选
      const p = provAtEvent(e);
      if (!p) return;
      PSE.Render.selectedProv = p.id;
      PSE.UI.renderProvince(Game, p.id);
      PSE.UI.bindProvince(Game);
    });
    canvas.addEventListener('dblclick', (e: any) => {
      const p = provAtEvent(e);
      if (p) PSE.Render.centerOn(p.cx, p.cy, Math.max(6, PSE.Render.cam.zoom));
    });
    canvas.addEventListener('contextmenu', (e: any) => {
      e.preventDefault();
      const p = provAtEvent(e);
      if (!p) return;
      const sel = PSE.UI.selectedDivs();
      if (!sel.length) { PSE.UI.toast('先在「军队」面板选中部队', 'warn'); return; }
      const n = PSE.Cmd.orderMove(Game.world, sel, p.id);
      PSE.UI.toast(n ? n + ' 个师前往 ' + p.name : '无法抵达 ' + p.name, n ? '' : 'warn');
    });
    canvas.addEventListener('wheel', (e: any) => {
      e.preventDefault();
      const [px, py] = localPos(e);
      PSE.Render.zoomAt(px, py, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });

    // —— 触屏（手机/平板）：单指拖动=平移，双指捏合=缩放，轻点=选省，双击=居中放大 ——
    let touchActive = 0, pinchDist = 0, lastTap = 0, lastTapX = 0, lastTapY = 0;
    const tPos = (t) => { const r = canvas.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; };

    canvas.addEventListener('touchstart', (e: any) => {
      touchActive = e.touches.length;
      if (e.touches.length === 1) {
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; dragMoved = 0;
      } else if (e.touches.length === 2) {
        const [ax, ay] = tPos(e.touches[0]), [bx, by] = tPos(e.touches[1]);
        pinchDist = Math.hypot(bx - ax, by - ay) || 1;
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e: any) => {
      touchActive = e.touches.length;
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY;
        if (dx || dy) {
          dragMoved += Math.abs(dx) + Math.abs(dy);
          PSE.Render.pan(dx, dy);
          lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        }
        e.preventDefault();               // 阻止页面滚动/下拉刷新
      } else if (e.touches.length >= 2) {
        const [ax, ay] = tPos(e.touches[0]), [bx, by] = tPos(e.touches[1]);
        const d = Math.hypot(bx - ax, by - ay) || 1;
        if (pinchDist > 0) PSE.Render.zoomAt((ax + bx) / 2, (ay + by) / 2, d / pinchDist);
        pinchDist = d;
        e.preventDefault();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e: any) => {
      if (e.touches.length === 0) { touchActive = 0; pinchDist = 0; }
      if (e.changedTouches.length !== 1 || dragMoved >= 8) return;   // 拖动不触发点选
      const t = e.changedTouches[0];
      const [px, py] = tPos(t);
      const ll = PSE.Render.screenToLonLat(px, py);
      const p = PSE.MapData.pickProvince(ll[0], ll[1]);
      const now = Date.now();
      if (now - lastTap < 300 && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 30) {
        // 双击：居中并放大
        if (p) PSE.Render.centerOn(p.cx, p.cy, Math.max(6, PSE.Render.cam.zoom));
        lastTap = 0;
      } else {
        lastTap = now; lastTapX = t.clientX; lastTapY = t.clientY;
        if (p) {
          PSE.Render.selectedProv = p.id;
          PSE.UI.renderProvince(Game, p.id);
          PSE.UI.bindProvince(Game);
        }
      }
      e.preventDefault();                 // 阻止合成 click，避免与鼠标逻辑重复触发
    });

    // —— 事件弹窗：委托绑定（避免 innerHTML 重绘后按钮失效）——
    const modal = (document.getElementById('eventModal') as any);
    if (modal) {
      modal.addEventListener('click', (e: any) => {
        let el = e.target;
        while (el && el !== modal && !(el.dataset && el.dataset.eventOpt !== undefined)) el = el.parentNode;
        if (!el || el === modal) return;
        PSE.Events.resolve(Game.world, +el.dataset.eventOpt, false);
        modal.classList.add('hidden');
        Game.world.speed = Game.lastSpeed || 2;
        PSE.UI.renderAll(Game);
        PSE.UI.toast('事件已抉择');
      });
    }

    document.querySelectorAll('[data-speed]').forEach((b: any) => b.onclick = () => {
      const s = +b.dataset.speed;
      if (Game.world.speed === 0 && s === 0) Game.world.speed = Game.lastSpeed || 2;
      else { Game.world.speed = s; if (s > 0) Game.lastSpeed = s; }
      Game.acc = 0;
      syncSpeedButtons();
      PSE.UI.renderTop(Game);
    });
    document.querySelectorAll('[data-layer]').forEach((b: any) => b.onclick = () => PSE.UI.setLayer(b.dataset.layer, Game));
    document.querySelectorAll('[data-tab]').forEach((b: any) => b.onclick = () => PSE.UI.setTab(b.dataset.tab, Game));

    // —— 沉浸模式：全屏地图（手机横屏省空间）——
    const appEl = (document.getElementById('app') as any);
    function toggleFullscreen() {
      if (!appEl) return;
      appEl.classList.toggle('fs');
      // 布局变化不会触发 window resize，必须手动重算画布并重绘
      PSE.Render.resize();
      PSE.Render.draw(0);
    }
    const btnFs = (document.getElementById('btnFs') as any);
    if (btnFs) btnFs.onclick = toggleFullscreen;
    const fsExit = (document.getElementById('fsExit') as any);
    if (fsExit) fsExit.onclick = toggleFullscreen;

    document.addEventListener('keydown', (e: any) => {
      // Esc 优先：即使焦点在下拉/输入框里也要能退出面板全屏
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (PSE.UI.panelFullscreen && PSE.UI.panelFullscreen()) { PSE.UI.setPanelFullscreen(false); e.preventDefault(); }
        return;
      }
      // Shift+F：面板全屏（国策/科研放大观看）；F 仍是全屏地图
      if (e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        PSE.UI.setPanelFullscreen(!PSE.UI.panelFullscreen());
        e.preventDefault();
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      const w = Game.world;
      if (e.key === ' ') {
        e.preventDefault();
        w.speed = w.speed === 0 ? (Game.lastSpeed || 2) : 0;
        syncSpeedButtons();
        PSE.UI.renderTop(Game);
      } else if (e.key >= '1' && e.key <= '5') {
        w.speed = +e.key; Game.lastSpeed = +e.key; syncSpeedButtons(); PSE.UI.renderTop(Game);
      } else if (e.key === 'l' || e.key === 'L') {
        const layers = PSE.Render.LAYERS;
        const cur = layers.indexOf(PSE.Render.layer || 'political');
        PSE.UI.setLayer(layers[(cur + 1) % layers.length], Game);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 's' || e.key === 'S') {
        PSE.UI.save(Game);
      } else if (e.key === '+' || e.key === '=') {
        PSE.Render.zoomAt(PSE.Render.vw / 2, PSE.Render.vh / 2, 1.25);
      } else if (e.key === '-') {
        PSE.Render.zoomAt(PSE.Render.vw / 2, PSE.Render.vh / 2, 0.8);
      }
    });

    document.querySelectorAll('[data-start]').forEach((b: any) => b.onclick = () => {
      const tag = (document.getElementById('pickCountry') as any).value;
      const iron = (document.getElementById('pickIronman') as any).checked;
      const sc = (document.getElementById('pickScenario') as any);
      const df = (document.getElementById('pickDifficulty') as any);
      Game.start(tag, { ironman: iron, scenario: sc ? sc.value : 's1936', difficulty: df ? df.value : 'standard' });
    });

    // 控制台（~ 切换）
    const consoleEl = (document.getElementById('console') as any);
    const consoleIn = (document.getElementById('consoleIn') as any);
    const consoleOut = (document.getElementById('consoleOut') as any);
    if (consoleIn) {
      consoleIn.addEventListener('keydown', (e: any) => {
        if (e.key !== 'Enter') return;
        const r = PSE.Console.run(Game.world, consoleIn.value);
        consoleOut.textContent += '\n> ' + consoleIn.value + '\n' + (r.ok ? '✔ ' : '✘ ') + r.msg;
        consoleOut.scrollTop = consoleOut.scrollHeight;
        consoleIn.value = '';
        PSE.UI.renderAll(Game);
      });
    }
    document.addEventListener('keydown', (e: any) => {
      if (e.key === '~' || e.key === '`') {
        e.preventDefault();
        if (consoleEl) {
          consoleEl.classList.toggle('hidden');
          if (!consoleEl.classList.contains('hidden') && consoleIn) consoleIn.focus();
        }
      }
    });
  }

  function syncSpeedButtons() {
    document.querySelectorAll('[data-speed]').forEach((x: any) => x.classList.toggle('on', +x.dataset.speed === Game.world.speed));
  }

  root.addEventListener('DOMContentLoaded', () => {
    const canvas = (document.getElementById('map') as any);
    PSE.Render.init(canvas, Game);
    const sel = (document.getElementById('pickCountry') as any);
    const majors = ['GER', 'SOV', 'ENG', 'FRA', 'ITA', 'USA', 'JAP', 'CHI'];
    const rest = Object.keys(PSE.COUNTRIES).filter((t) => majors.indexOf(t) < 0 && t !== 'NEU');
    sel.innerHTML = majors.map((t) => '<option value="' + t + '">★ ' + PSE.COUNTRIES[t].name + '</option>').join('') +
      rest.map((t) => '<option value="' + t + '">' + PSE.COUNTRIES[t].name + '</option>').join('');
    sel.value = 'GER';
    // 剧本与难度
    const scSel = (document.getElementById('pickScenario') as any);
    if (scSel) scSel.innerHTML = Object.keys(PSE.SCENARIOS).map((k) =>
      '<option value="' + k + '"' + (k === 's1936' ? ' selected' : '') + '>' + PSE.SCENARIOS[k].name + '</option>').join('');
    const dfSel = (document.getElementById('pickDifficulty') as any);
    if (dfSel) dfSel.innerHTML = Object.keys(PSE.DIFFICULTY).map((k) =>
      '<option value="' + k + '"' + (k === 'standard' ? ' selected' : '') + '>' + PSE.DIFFICULTY[k].name + '</option>').join('');
    bindInput();
    const q = new URLSearchParams(root.location ? root.location.search : '');
    const auto = q.get('auto');
    if (auto && PSE.COUNTRIES[auto]) {
      Game.start(auto, {
        ironman: q.get('ironman') === '1',
        scenario: q.get('scenario') || 's1936',
        difficulty: q.get('difficulty') || 'standard',
      });
      if (q.get('speed')) { Game.world.speed = Math.max(0, Math.min(5, +q.get('speed'))); Game.lastSpeed = Game.world.speed; }
      const warm = parseInt(q.get('days') || '0', 10);
      if (warm > 0) {
        for (let i = 0; i < warm * 24; i++) PSE.Sim.tickHour(Game.world);
        PSE.UI.renderAll(Game);
      }
      const zoom = parseFloat(q.get('zoom'));
      if (zoom) PSE.Render.cam.zoom = zoom;
      const layer = q.get('layer');
      if (layer && PSE.Render.LAYERS.indexOf(layer) >= 0) PSE.UI.setLayer(layer, Game);
      const tab = q.get('tab');
      if (tab) PSE.UI.setTab(tab, Game);
      const focus = q.get('focus');
      if (focus && PSE.MapData.provincesById) {
        const caps = Game.world.provinces.filter((p) => p.name.indexOf(focus) >= 0);
        if (caps.length) PSE.Render.centerOn(caps[0].cx, caps[0].cy, zoom || 6);
      }
      if (q.get('fs')) {
        const appEl = (document.getElementById('app') as any);
        if (appEl) { appEl.classList.add('fs'); PSE.Render.resize(); }
      }
      // panelfs=1：直接以「面板全屏」开局（国策/科研放大看，截图与深链都用它）
      if (q.get('panelfs')) PSE.UI.setPanelFullscreen(true);
      PSE.UI.toast('自动开局：' + PSE.COUNTRIES[auto].name);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
