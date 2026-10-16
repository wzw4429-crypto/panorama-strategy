/* PSE · 浏览器层冒烟测试（最小 DOM 桩）
 * 目的：在没有真浏览器的情况下，跑通 render.js / ui.js / main.js 的初始化、绘制、
 *       面板渲染与全部按钮回调路径，捕捉拼写/空引用类错误。
 * 用法：node tests/dom-smoke.js
 */
'use strict';
const path = require('path');

// ---------- 最小 DOM 桩 ----------
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 20 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    if (k === 'canvas') return { width: 1080, height: 792 };
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});

const domReady = [];
function makeEl(id) {
  const el = {
    id, children: [], dataset: {}, style: {}, value: '', checked: false,
    textContent: '', innerHTML: '', tagName: 'DIV',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
    },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1080, height: 792 }; },
    click() {}, getContext() { return ctxStub; }, focus() {},
  };
  return el;
}
const els = {};
global.document = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  querySelectorAll: () => [],
  querySelector: () => makeEl('q'),
  createElement: (t) => makeEl(t),
  addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') domReady.push(fn); },
  body: makeEl('body'),
};
global.window = global;
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 1;
global.addEventListener = (t, fn) => { if (t === 'DOMContentLoaded') domReady.push(fn); };
global.Blob = function () {};
global.URL = { createObjectURL: () => 'blob:x' };

let failures = 0, checks = 0;
function ok(cond, msg, extra) {
  checks++;
  if (cond) console.log('  \x1b[32m✓\x1b[0m ' + msg);
  else { failures++; console.log('  \x1b[31m✗ ' + msg + (extra !== undefined ? ' → ' + extra : '') + '\x1b[0m'); }
}
function step(name, fn) {
  try { fn(); ok(true, name); }
  catch (e) { failures++; checks++; console.log('  \x1b[31m✗ ' + name + ' → ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) + '\x1b[0m'); }
}

// ---------- 加载浏览器脚本 ----------
const SRC = path.join(__dirname, '..', 'src');
require(path.join(__dirname, '..', 'data', 'map-generated.js'));
for (const f of ['core.js', 'platform.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'systems.js', 'systems2.js', 'save.js', 'render.js', 'ui.js', 'main.js']) {
  require(path.join(SRC, f));
}
const PSE = globalThis.PSE;

console.log('\n\x1b[36m== DOM 冒烟测试 ==\x1b[0m');
step('DOMContentLoaded 初始化（国家列表 + 输入绑定）', () => {
  for (const fn of domReady) fn();
  const sel = document.getElementById('pickCountry');
  if (!sel.innerHTML || sel.innerHTML.indexOf('德国') < 0) throw new Error('国家列表未填充');
});

step('选择法国开局并启动', () => {
  document.getElementById('pickCountry').value = 'FRA';
  PSE.Game.start('FRA', {});
  if (!PSE.Game.world) throw new Error('world 未创建');
  if (PSE.Game.world.playerTag !== 'FRA') throw new Error('玩家国错误');
});

step('渲染地图（含 hover/选中/战斗标记）', () => {
  const w = PSE.Game.world;
  PSE.Render.hover = 100;
  PSE.Render.selectedProv = 100;
  // 人为制造一场战斗标记
  PSE.Render.draw(16);
});

step('遍历全部图层渲染', () => {
  for (const l of PSE.Render.LAYERS) { PSE.UI.setLayer(l, PSE.Game); PSE.Render.draw(16); }
  PSE.UI.setLayer('political', PSE.Game);
});

step('遍历全部面板标签渲染', () => {
  for (const t of ['production', 'equipment', 'research', 'focus', 'army', 'navy', 'air', 'spy', 'diplomacy', 'logistics']) {
    PSE.UI.setTab(t, PSE.Game);
    const html = document.getElementById('panelBody').innerHTML;
    if (!html || html.length < 20) throw new Error('面板 ' + t + ' 输出为空');
  }
});

step('摄像机：投影/平移/缩放/点选往返一致', () => {
  const R = PSE.Render;
  R.cam = { x: 0.5, y: 0.34, zoom: 4 };
  const s1 = R.lonLatToScreen(13.4, 52.52);
  const ll = R.screenToLonLat(s1[0], s1[1]);
  if (Math.abs(ll[0] - 13.4) > 0.6 || Math.abs(ll[1] - 52.52) > 0.6) throw new Error('投影往返误差过大: ' + ll);
  R.pan(40, 25);
  R.zoomAt(400, 300, 1.4);
  R.draw(16);
});

step('世界规模下遍历全部 7 个图层渲染', () => {
  for (const l of PSE.Render.LAYERS) { PSE.UI.setLayer(l, PSE.Game); PSE.Render.draw(16); }
  PSE.UI.setLayer('political', PSE.Game);
});

step('装备设计器交互（改配置 → 定型）', () => {
  const g = PSE.Game;
  PSE.UI.setDesign('role', 'tank');
  PSE.UI.setDesign('chassis:heavy');
  PSE.UI.setDesign('gun:heavy');
  const before = Object.keys(PSE.Game.world.customEquipment || {}).length;
  const def = PSE.Cmd.designEquipment(g.world, g.world.countries[g.world.playerTag], PSE.UI.getDesign());
  if (!def) throw new Error('定型失败');
  if (Object.keys(g.world.customEquipment).length <= before) throw new Error('自定义装备未写入世界');
});

step('和平会议弹窗渲染与处置', () => {
  const w = PSE.Game.world;
  const war = PSE.Diplo.declareWar(w, w.playerTag, 'POL', {});
  w.playerTag = w.playerTag;
  PSE.Peace.open(w, war, 'POL');
  if (w.peaceConference) {
    PSE.UI.renderPeace(PSE.Game);
    const html = document.getElementById('peaceOptions').innerHTML;
    if (!html) throw new Error('和平会议选项为空');
    PSE.Peace.apply(w, 'liberate');
  }
  PSE.UI.renderAll(PSE.Game);
});

step('控制台输入管线', () => {
  const w = PSE.Game.world;
  const r1 = PSE.Console.run(w, 'pp 300');
  if (!r1.ok) throw new Error('pp 指令失败');
  const r2 = PSE.Console.run(w, 'instant');
  if (!r2.ok) throw new Error('instant 指令失败');
  const r3 = PSE.Console.run(w, 'nonexistent_cmd');
  if (r3.ok) throw new Error('未知命令应失败');
});

step('省份详情渲染（本国/敌国/海洋坐标）', () => {
  const w = PSE.Game.world;
  for (const p of [w.provinces[0], w.provinces[50], w.provinces[w.provinces.length - 1]]) {
    PSE.UI.renderProvince(PSE.Game, p.id);
    if (!document.getElementById('provinceInfo').innerHTML) throw new Error('省份面板为空');
  }
});

step('悬停提示读运行时字段：不再「补给 NaN%」，且有胜利点/军工厂', () => {
  const w = PSE.Game.world;
  let p = null;
  for (const q of w.provinces) {
    if ((q.cityVp || 0) > 0 && q.buildings && q.buildings.mil > 0 && typeof q.supply === 'number') { p = q; break; }
  }
  if (!p) throw new Error('找不到同时有胜利点与军工厂的省份');
  const html = PSE.UI.provinceTooltipHtml(w, p, 3);
  if (html.indexOf('NaN') >= 0) throw new Error('悬停提示出现 NaN：' + html);
  if (!/补给 \d+%/.test(html)) throw new Error('悬停提示缺少补给百分比：' + html);
  if (html.indexOf('胜利点 ' + p.cityVp) < 0) throw new Error('悬停提示缺少胜利点：' + html);
  if (html.indexOf('军工厂 ' + p.buildings.mil) < 0) throw new Error('悬停提示缺少军工厂：' + html);
  if (html.indexOf('驻军 3 个师') < 0) throw new Error('悬停提示缺少驻军行：' + html);
  // 静默降级：万一又有人把静态地图对象塞进来，应显示占位符而不是 NaN
  const mp = PSE.MapData.pickProvince(p.cx, p.cy);
  if (PSE.UI.provinceTooltipHtml(w, mp, 0).indexOf('补给 —') < 0) throw new Error('静态地图对象未按占位符降级');
});

step('推进 60 天（玩家国 + AI 全开）', () => {
  const w = PSE.Game.world;
  for (let i = 0; i < 24 * 60; i++) PSE.Sim.tickHour(w);
  PSE.Render.draw(16);
  PSE.UI.renderAll(PSE.Game);
});

step('玩家命令路径：国策/征兵/建设/法案/科研/顾问', () => {
  const w = PSE.Game.world;
  const c = w.countries.FRA;
  c.pp = 1000;
  const tree = PSE.FOCUS_TREES[c.focusTree];
  let started = false;
  for (const n of tree.nodes) if (PSE.Cmd.startFocus(w, n.id)) { started = true; break; }
  if (!started) throw new Error('无法启动任何国策');
  PSE.Cmd.recruit(w, c.templates[0], 1);
  if (!PSE.Cmd.queueBuild(w, 'civ', c.capital)) throw new Error('建设命令失败');
  PSE.Cmd.changeLaw(w, 'conscription', 2);
  const avail = Object.keys(PSE.TECHS).find((t) => PSE.Sim.techAvailable(c, t));
  if (avail && c.research.length) PSE.Cmd.setResearch(w, 0, avail);
  PSE.Cmd.buyAdvisor(w, PSE.ADVISORS[0].id);
  PSE.Cmd.setResistPolicy(w, 'gentle');
});

step('玩家命令路径：借口 → 宣战 → 进攻', () => {
  const w = PSE.Game.world;
  const c = w.countries.FRA;
  c.pp = 1000;
  if (!PSE.Cmd.justifyWarGoal(w, 'GER')) throw new Error('制造借口失败');
  c.wargoals.GER = true;
  PSE.Cmd.declareWar(w, 'GER');
  if (!PSE.World.areAtWar(w, 'FRA', 'GER')) throw new Error('宣战未生效');
  const divs = w.divisions.filter((d) => d.tag === 'FRA').map((d) => d.id);
  const border = w.provinces.find((p) => p.controller === 'GER' && p.neighbors.some((n) => w.provinces[n].controller === 'FRA'));
  if (border) {
    const n = PSE.Cmd.orderMove(w, divs, border.id);
    if (n <= 0) throw new Error('进攻命令未生效');
  }
  for (let i = 0; i < 24 * 20; i++) PSE.Sim.tickHour(w);
  PSE.UI.renderAll(PSE.Game);
});

step('事件弹窗渲染与抉择', () => {
  const w = PSE.Game.world;
  w.events.current = { id: 'EVT_battle_of_britain', tag: w.playerTag };
  PSE.UI.renderEvent(PSE.Game);
  const opts = document.getElementById('eventOptions');
  if (!opts.innerHTML) throw new Error('事件选项为空');
  PSE.Events.resolve(w, 0, false);
  if (w.events.current) throw new Error('事件未清除');
});

step('事件弹窗：定时刷新不重建按钮（「点了没反应」回归）', () => {
  const w = PSE.Game.world, g = PSE.Game;
  const evId = Object.keys(PSE.EVENTS).find((k) => (PSE.EVENTS[k].options || []).length > 0);
  if (!evId) throw new Error('没有可用事件');
  const optEl = document.getElementById('eventOptions');
  let writes = 0, html = '';
  Object.defineProperty(optEl, 'innerHTML', {
    get: () => html,
    set: (v) => { writes++; html = String(v); },
    configurable: true,
  });
  w.events.current = { id: evId, tag: w.playerTag };
  PSE.UI.renderEvent(g);
  if (html.indexOf('data-event-opt') < 0) throw new Error('事件选项未渲染');
  const base = writes;
  for (let i = 0; i < 8; i++) PSE.UI.renderEvent(g);      // 主循环约每 350ms 一次
  if (writes !== base) throw new Error('同一事件重复刷新重建了 ' + (writes - base) + ' 次选项 DOM（会吞掉玩家点击）');
  // 关掉再开（或换成另一个事件）必须重建，否则会显示上一个事件的选项
  w.events.current = null; PSE.UI.renderEvent(g);
  w.events.current = { id: evId, tag: w.playerTag }; PSE.UI.renderEvent(g);
  if (writes !== base + 1) throw new Error('弹窗重新打开时未重建选项');
  w.events.current = null; PSE.UI.renderEvent(g);
  if (!document.getElementById('eventModal').classList.contains('hidden')) throw new Error('事件结束后弹窗未隐藏');
  delete optEl.innerHTML;
  // 和平会议同一套保护（直接构造会议状态，避免依赖战争流程）
  w.peaceConference = { main: w.playerTag, defeated: 'POL' };
  const peaceEl = document.getElementById('peaceOptions');
  let pw = 0, pHtml = '';
  Object.defineProperty(peaceEl, 'innerHTML', {
    get: () => pHtml,
    set: (v) => { pw++; pHtml = String(v); },
    configurable: true,
  });
  PSE.UI.renderPeace(g);
  if (pHtml.indexOf('data-peace') < 0) throw new Error('和平会议选项未渲染');
  const pbase = pw;
  for (let i = 0; i < 8; i++) PSE.UI.renderPeace(g);
  if (pw !== pbase) throw new Error('和平会议选项被重复重建 ' + (pw - pbase) + ' 次');
  delete peaceEl.innerHTML;
  w.peaceConference = null;
  PSE.UI.renderPeace(g);
});

step('存档 UI：保存 → 读取 → 继续跑', () => {
  const w = PSE.Game.world;
  const r = PSE.Save.save(w, 'slot1', {});
  if (!r.ok) throw new Error('保存失败 ' + r.error);
  PSE.UI.load(PSE.Game);
  if (!PSE.Game.world) throw new Error('读取失败');
  for (let i = 0; i < 24 * 10; i++) PSE.Sim.tickHour(PSE.Game.world);
  PSE.UI.renderAll(PSE.Game);
});

step('渲染日志与 toast', () => {
  PSE.UI.renderLog(PSE.Game);
  PSE.UI.toast('测试提示', 'warn');
  const logHtml = document.getElementById('log').innerHTML;
  if (!logHtml) throw new Error('日志为空');
});

step('长时间运行（1 年）无异常且状态有限', () => {
  const w = PSE.Game.world;
  for (let i = 0; i < 24 * 365; i++) PSE.Sim.tickHour(w);
  PSE.Render.draw(16);
  PSE.UI.renderAll(PSE.Game);
  const bad = [];
  (function scan(o, p, d) {
    if (bad.length > 5 || d > 5) return;
    if (typeof o === 'number') { if (!isFinite(o)) bad.push(p); return; }
    if (!o || typeof o !== 'object') return;
    for (const k in o) scan(o[k], p + '.' + k, d + 1);
  })(w, 'w', 0);
  if (bad.length) throw new Error('出现非有限数值: ' + bad.join(', '));
});

step('画布 resize：尺寸未变不重置，尺寸变化后立即同步重绘（P0 空白帧回归）', () => {
  const R = PSE.Render;
  let wSets = 0, hSets = 0, draws = 0;
  const stub = {
    _w: 0, _h: 0, clientWidth: 800, clientHeight: 600,
    get width() { return this._w; },
    set width(v) { wSets++; this._w = v; },
    get height() { return this._h; },
    set height(v) { hSets++; this._h = v; },
    getContext() { return ctxStub; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
  };
  const prevCanvas = R.canvas, prevCtx = R.ctx;
  try {
    R.init(stub, PSE.Game);
    if (wSets !== 1 || hSets !== 1) throw new Error('首次 resize 未设置画布尺寸：' + wSets + '/' + hSets);
    R.resize();
    if (wSets !== 1) throw new Error('尺寸未变却重新赋值（会清空画布）：width 赋值 ' + wSets + ' 次');
    const orig = R.draw;
    R.draw = function (dt) { draws++; return orig.call(R, dt); };
    try {
      stub.clientWidth = 900;
      R.resize();
    } finally { R.draw = orig; }
    if (wSets !== 2) throw new Error('尺寸变化后未重新分配画布：' + wSets);
    if (draws !== 1) throw new Error('尺寸变化后未同步重绘（会留下空白帧）：draws=' + draws);
  } finally { R.canvas = prevCanvas; R.ctx = prevCtx; }
});

step('P1 回归：窄屏折叠提示文字的 CSS 选择器不会被 ID 规则覆盖', () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = html.match(/[^{}]*\{[^{}]*\}/g) || [];
  let hideRules = 0;
  for (const r of rules) {
    const i = r.indexOf('{');
    const sel = r.slice(0, i), body = r.slice(i);
    if (!/\.hintText/.test(sel) || !/display\s*:\s*none/.test(body)) continue;
    hideRules++;
    // 裸 .hintText（0,1,0）会被 #toolbar .group{display:flex}（1,1,0）覆盖 → 折叠失效（P1 根因）
    if (!/#toolbar/.test(sel)) throw new Error('裸选择器「' + sel.trim() + '」优先级不足，窄屏折叠会被覆盖');
  }
  if (hideRules < 3) throw new Error('折叠规则不全：期望 ≥3 条（矮屏横屏 / 触屏横屏 / 竖屏），实际 ' + hideRules);
});

step('师团点名/编组：同省堆叠可逐个拆开、按名字组合（新功能回归）', () => {
  const UI = PSE.UI, w = PSE.Game.world, c = w.countries[w.playerTag];
  const mine = c.divisions.map((id) => w.divisions.find((d) => d.id === id)).filter(Boolean);
  if (mine.length < 3) throw new Error('玩家师团太少，无法验证：' + mine.length);
  const byLoc = {};
  for (const d of mine) (byLoc[d.loc] = byLoc[d.loc] || []).push(d);
  const stacked = Object.keys(byLoc).map((k) => byLoc[k]).sort((a, b) => b.length - a.length)[0];
  if (stacked.length < 2) throw new Error('找不到同省堆叠（≥2 个师）');
  const a = stacked[0], b = stacked[1];
  // 整省全选 → 逐个取消（拆分）
  UI.selectDivs(stacked.map((d) => d.id));
  if (UI.selectedDivs().length !== stacked.length) throw new Error('整省选择失败');
  UI.toggleDiv(b.id);
  if (UI.selectedDivs().length !== stacked.length - 1) throw new Error('逐个取消失败');
  if (UI.selectedDivs().indexOf(b.id) >= 0) throw new Error('已取消的师仍在选择中');
  UI.toggleDiv(b.id);
  if (UI.selectedDivs().indexOf(b.id) < 0) throw new Error('再次点选未生效');
  // 按名字组合
  UI.selectByName(w, b.name);
  if (UI.selectedDivs().length !== 1 || UI.selectedDivs()[0] !== b.id) throw new Error('按名字选中失败');
  UI.selectByName(w, a.name, 'add');
  if (UI.selectedDivs().length !== 2) throw new Error('「加入选择」失败');
  // 军队面板确实生成了「逐个点选 / 按名字组合 / 编组」控件（防 UI 回落成只能整省选择）
  UI.setTab('army', PSE.Game);
  const armHtml = document.getElementById('panelBody').innerHTML;
  for (const need of ['data-seldiv=', 'data-divbyname=', 'data-groupsave=', 'data-selprov=', '该省清空']) {
    if (armHtml.indexOf(need) < 0) throw new Error('军队面板缺少控件：' + need);
  }
  UI.setTab('production', PSE.Game);

  // 编组：存 → 清空 → 召回 → 存档往返后仍在 → 删除
  UI.saveGroup(w, '单元测试编组');
  const ids = UI.selectedDivs().slice();
  UI.selectDivs([]);
  if (UI.selectGroup(w, '单元测试编组').join(',') !== ids.join(',')) throw new Error('编组召回失败');
  const r = PSE.Save.save(w, 'slotGrp', {});
  if (!r.ok) throw new Error('保存失败：' + r.error);
  // 直接按 slot 读回（PSE.UI.load 固定读 slot1/ironman，这里要验证的是编组随存档序列化）
  const w2 = PSE.Save.load('slotGrp');
  if (!w2) throw new Error('读档失败');
  if (!(w2.countries[w2.playerTag].groups || []).some((x) => x.name === '单元测试编组')) throw new Error('编组未随存档持久化');
  UI.selectGroup(w2, '单元测试编组');
  UI.deleteGroup(w2, '单元测试编组');
  if ((w2.countries[w2.playerTag].groups || []).length) throw new Error('删除编组失败');
  PSE.Save.remove('slotGrp');
});

step('集团军自定义：数量/名称/将领/编成（新功能回归）', () => {
  const UI = PSE.UI, w = PSE.Game.world, c = w.countries[w.playerTag];
  PSE.Army.ensure(w, c); PSE.Army.assign(w, c);
  const before = c.armies.length;
  const na = PSE.Army.add(w, c, '单元测试军');
  if (!na || c.armies.length !== before + 1) throw new Error('新建集团军失败');
  const d1 = w.divisions.find((d) => d.tag === w.playerTag && d.id === c.divisions[0]);
  if (!d1) throw new Error('找不到玩家师');
  if (PSE.Army.setDivisions(w, c, na.id, [d1.id]) !== 1 || d1.army !== na.id) throw new Error('编入失败');
  if (PSE.Army.releaseDivisions(w, c, [d1.id]) !== 1 || d1.army != null) throw new Error('调出失败');
  const g2 = c.generals.find((x) => x.id !== na.generalId);
  if (g2 && (!PSE.Army.setGeneral(w, c, na.id, g2.id) || na.generalId !== g2.id)) throw new Error('换将失败');
  if (!PSE.Army.rename(w, c, na.id, '单元测试军·改') || na.name !== '单元测试军·改') throw new Error('改名失败');
  // 手动编成不被每日自动编组覆盖
  PSE.Army.setDivisions(w, c, na.id, [d1.id]);
  for (let i = 0; i < 30; i++) PSE.Sim.tickHour(w);
  if (d1.army !== na.id) throw new Error('手动编成被每日自动编组覆盖');
  if (!PSE.Army.remove(w, c, na.id) || d1.army != null) throw new Error('解散失败');
  // 面板控件齐全
  UI.setTab('army', PSE.Game);
  const armHtml = document.getElementById('panelBody').innerHTML;
  for (const need of ['data-army-add=', 'data-army-del=', 'data-army-set=', 'data-army-pull=', 'data-army-rename=', 'data-army-general=', 'data-army-auto=', 'data-army-select=']) {
    if (armHtml.indexOf(need) < 0) throw new Error('集团军面板缺少控件：' + need);
  }
  UI.setTab('production', PSE.Game);
});

step('生产面板：定时刷新不重建 DOM，下拉/按钮不再被吞（闪白回归）', () => {
  const UI = PSE.UI, w = PSE.Game.world, c = w.countries[w.playerTag];
  UI.setTab('production', PSE.Game);
  const body = document.getElementById('panelBody');
  let writes = 0, html = '';
  Object.defineProperty(body, 'innerHTML', {
    get: () => html,
    set: (v) => { writes++; html = String(v); },
    configurable: true,
  });
  UI.renderPanel(PSE.Game);                                  // 显式重绘一次
  if (html.indexOf('data-add-prod') < 0) throw new Error('生产面板缺少「新增产线」按钮');
  const base = writes;
  // 主循环每 350ms 的定时刷新：内容没变就一个 DOM 节点都不能动（否则下拉闪一下变白）
  for (let i = 0; i < 8; i++) UI.tickPanel(PSE.Game);
  if (writes !== base) throw new Error('内容未变仍重建了 ' + (writes - base) + ' 次面板 DOM');
  // 玩家正操作下拉（焦点在 select 上）：即使内容变了也先不重建，避免吞掉点击
  Object.defineProperty(document, 'activeElement', { value: { tagName: 'SELECT' }, configurable: true });
  body.contains = () => true;
  c.factories.mil = (c.factories.mil || 0) + 3;              // 真实状态变化 → HTML 会变
  UI.tickPanel(PSE.Game);
  if (writes !== base) throw new Error('下拉聚焦时仍被重建（会闪白/丢选项）');
  // 焦点离开后由下一次 tick 补齐
  Object.defineProperty(document, 'activeElement', { value: { tagName: 'BODY' }, configurable: true });
  UI.tickPanel(PSE.Game);
  if (writes !== base + 1) throw new Error('焦点离开后未补上最新内容');
  delete document.activeElement;
  c.factories.mil -= 3;
  // 面板展示与命令口径一致：面板上的「空闲」= 命令允许新增的额度
  UI.renderPanel(PSE.Game);
  const free = PSE.Cmd.prodFreeMil(c);
  if (html.indexOf('空闲军工 ' + free + ' 座') < 0) throw new Error('面板空闲军工与命令口径不一致（应为 ' + free + '）');
  // 空闲为 0 时必须告诉玩家「怎么才会有空闲」（用户曾把建设中/未完工的军工厂当成空闲）
  const keepMil = c.factories.mil;
  c.factories.mil = PSE.Cmd.prodUsedMil(c);
  UI.renderPanel(PSE.Game);
  if (document.getElementById('panelBody').innerHTML.indexOf('空闲军工为 0') < 0) throw new Error('空闲为 0 时缺少指引文案');
  c.factories.mil = keepMil;
  UI.setTab('production', PSE.Game);
});

step('面板全屏：国策/科研可放大观看使用（新功能回归）', () => {
  const UI = PSE.UI, side = document.getElementById('side');
  const oldH = globalThis.innerHeight;
  globalThis.innerHeight = 900;
  if (UI.panelFullscreen()) UI.setPanelFullscreen(false);
  if (!UI.setPanelFullscreen(true)) throw new Error('开启面板全屏失败');
  if (!side.classList.contains('panelFs')) throw new Error('#side 没有加上 panelFs 类（CSS 不会生效）');
  const tabsHtml = document.getElementById('tabs').innerHTML;
  if (tabsHtml.indexOf('退出全屏') < 0) throw new Error('全屏后按钮未变成「退出全屏」');
  for (const k of ['focus', 'research', 'production']) {
    if (tabsHtml.indexOf('data-panelfstab="' + k + '"') < 0) throw new Error('全屏顶部条缺少面板切换按钮：' + k);
  }
  UI.setTab('focus', PSE.Game);
  const m1 = document.getElementById('panelBody').innerHTML.match(/focusWrap" style="height:(\d+)px/);
  if (!m1) throw new Error('国策面板没有渲染出 focusWrap 容器');
  const fsH = +m1[1];
  UI.setPanelFullscreen(false);
  UI.setTab('focus', PSE.Game);
  const m2 = document.getElementById('panelBody').innerHTML.match(/focusWrap" style="height:(\d+)px/);
  const normH = m2 ? +m2[1] : 0;
  if (!(fsH > normH && fsH > 520)) throw new Error('全屏后国策树没有变大：' + fsH + ' vs ' + normH);
  if (side.classList.contains('panelFs')) throw new Error('退出全屏未去掉 panelFs 类');
  if (document.getElementById('tabs').innerHTML.indexOf('data-panelfstab') >= 0) throw new Error('退出全屏后仍显示全部标签按钮');
  globalThis.innerHeight = oldH;
  UI.setTab('production', PSE.Game);
});

step('平台适配层：浏览器退回原行为，壳契约可注入（桌面壳接入点）', () => {
  const fs = require('fs');
  const P = PSE.Platform, UI = PSE.UI;
  if (!P) throw new Error('PSE.Platform 未加载（index.html 需在 save.js 之前加载 platform.js）');
  if (P.kind() !== 'web') throw new Error('无宿主时应识别为 web，实际 ' + P.kind());
  if (P.isDesktop()) throw new Error('无头环境不应识别为桌面');
  // 脚本顺序：platform.js 必须在 save.js / ui.js 之前（save 走 Platform.store）
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ip = html.indexOf('src/platform.js'), is = html.indexOf('src/save.js'), iu = html.indexOf('src/ui.js');
  if (ip < 0) throw new Error('index.html 未加载 platform.js');
  if (!(ip < is && ip < iu)) throw new Error('platform.js 应在 save.js / ui.js 之前加载');
  // 存档面板：导出 + 导入都在（导入为这轮新增，桌面壳下会换成原生对话框）
  if (typeof UI.exportSave !== 'function' || typeof UI.importSave !== 'function') throw new Error('UI.exportSave / UI.importSave 缺失');
  let found = false;
  for (const tab of ['production', 'research', 'focus', 'army', 'diplomacy', 'logistics', 'equipment', 'navy', 'air', 'spy']) {
    UI.setTab(tab, PSE.Game);
    if (document.getElementById('panelBody').innerHTML.indexOf('data-import') >= 0) { found = true; break; }
  }
  if (!found) throw new Error('没有任何面板渲染出「导入存档」按钮');
  UI.setTab('production', PSE.Game);
  // 新壳（Go + WebView2）：kind 只是标签，桌面判定看有没有宿主
  try {
    globalThis.PSE_HOST = { kind: 'webview2' };
    if (!PSE.Platform.isDesktop()) throw new Error('未知 kind 的宿主应判定为桌面');
    globalThis.PSE_HOST = { kind: 'webview2', desktop: false };
    if (PSE.Platform.isDesktop()) throw new Error('desktop:false 的宿主不应判定为桌面');
  } finally { delete globalThis.PSE_HOST; }
});

console.log('\n运行结果：' + PSE.Time.format(PSE.Game.world.hour) +
  '｜战斗 ' + (PSE.Game.world.stats.battles || 0) + ' 次｜战争 ' + PSE.Game.world.wars.length + ' 场');
console.log('\n' + (failures === 0 ? '\x1b[32m冒烟测试全部通过\x1b[0m' : '\x1b[31m失败 ' + failures + ' 项\x1b[0m') + '（检查 ' + checks + ' 项）');
process.exit(failures === 0 ? 0 : 1);
