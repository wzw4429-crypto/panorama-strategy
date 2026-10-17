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
function findSelects(root) {
  const out = [];
  (function walk(n) {
    for (const c of (n.children || [])) {
      if (String(c.tagName || '').toUpperCase() === 'SELECT') out.push(c);
      walk(c);
    }
  })(root);
  return out;
}
function makeEl(id) {
  const el = {
    id, children: [], dataset: {}, style: {}, value: '', checked: false,
    textContent: '', innerHTML: '', tagName: String(id || 'div').toUpperCase(),
    parentNode: null, disabled: false, options: [], selectedIndex: -1,
    _attr: {}, _ev: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
    },
    appendChild(c) { if (c) c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      if (c) c.parentNode = this;
      const i = this.children.indexOf(ref);
      if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c);
      return c;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {},
    addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); },
    removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    dispatchEvent(ev) {
      if (!ev) return true;
      if (!ev.type) ev.type = 'event';
      if (!ev.target) ev.target = this;
      for (const fn of (this._ev[ev.type] || []).slice()) fn(ev);
      const on = this['on' + ev.type];
      if (typeof on === 'function') on(ev);
      return true;
    },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attr, k); },
    getAttribute(k) { return this.hasAttribute(k) ? this._attr[k] : null; },
    setAttribute(k, v) { this._attr[k] = String(v); },
    removeAttribute(k) { delete this._attr[k]; },
    querySelector() { return makeEl('q'); },
    querySelectorAll(s) {
      if (s === 'select') return findSelects(this);
      const key = String(s || '').trim();
      if (!/^\[[^\]]+\]$/.test(key)) return [];
      let html = '';
      try { html = this.innerHTML || ''; } catch (e) { html = ''; }
      if (!this._attrCache || this._attrSnap !== html) { this._attrCache = {}; this._attrSnap = html; }
      if (!this._attrCache[key]) this._attrCache[key] = parseAttrEls(html, key);
      return this._attrCache[key];
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1080, height: 792 }; },
    click() { this.dispatchEvent({ type: 'click', target: this }); },
    getContext() { return ctxStub; }, focus() {}, blur() {},
  };
  return el;
}
// 属性选择器（如 [data-cancelbuild] / [data-logfilter="mine"]）从 innerHTML 里解析出「真实」的元素对象，
// 这样面板按钮上挂的 onclick 能像浏览器里一样被 click() 点到，而不是拿到一个空数组。
function parseAttrEls(html, sel) {
  const m = /^\[([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]$/.exec(String(sel || '').trim());
  if (!m) return null;
  const attr = m[1];
  const want = m[2] !== undefined ? m[2] : m[3];
  const out = [];
  const tagRe = /<([a-zA-Z0-9]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let t;
  while ((t = tagRe.exec(String(html || '')))) {
    const raw = t[2] || '';
    const am = new RegExp('(?:^|\\s)' + attr + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))').exec(raw);
    if (!am) continue;
    const val = am[1] !== undefined ? am[1] : (am[2] !== undefined ? am[2] : am[3]);
    if (want !== undefined && val !== want) continue;
    const el = makeEl(t[1].toLowerCase());
    const dr = /(?:^|\s)(data-[a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let d;
    while ((d = dr.exec(raw))) {
      const key = d[1].slice(5).replace(/-([a-z])/g, (s, ch) => ch.toUpperCase());
      el.dataset[key] = d[2] !== undefined ? d[2] : (d[3] !== undefined ? d[3] : d[4]);
    }
    out.push(el);
  }
  return out;
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
// 最小 Event：主题化下拉选中后会派发 change，让现有 onchange / addEventListener('change') 都能跑到
global.Event = function (type, opts) {
  this.type = type; this.bubbles = !!(opts && opts.bubbles);
  this.defaultPrevented = false; this.target = null;
};
global.Event.prototype.preventDefault = function () { this.defaultPrevented = true; };
global.Event.prototype.stopPropagation = function () {};

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
for (const f of ['core.js', 'platform.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'systems.js', 'systems2.js', 'save.js', 'render.js', 'select.js', 'ui.js', 'main.js']) {
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

step('科研下拉标注「已研究/前置未满足」，且失败原因不再一律「前置未满足」', () => {
  const g = PSE.Game;
  const w = g.world;
  const c = w.countries[w.playerTag];
  const avail = Object.keys(PSE.TECHS).find((id) => PSE.Sim.techAvailable(c, id));
  c.research[0] = { techId: avail, prog: 0, cost: PSE.TECHS[avail].cost };
  const doneId = Object.keys(PSE.TECHS).filter((id) => id !== avail)[0];
  if (c.researched.indexOf(doneId) < 0) c.researched.push(doneId);
  PSE.UI.setTab('research', g);
  const html = document.getElementById('panelBody').innerHTML;
  if (html.indexOf('data-research') < 0) throw new Error('科研面板没有科技下拉');
  if (html.indexOf('（已研究）') < 0) throw new Error('下拉未标注「已研究」');
  if (html.indexOf('（前置未满足）') < 0) throw new Error('下拉未标注「前置未满足」');
  const r1 = PSE.Cmd.setResearchEx(w, 0, doneId);
  if (r1.ok || r1.msg.indexOf('已研究完成') < 0) throw new Error('已研究科技的提示不对：' + r1.msg);
  const free2 = Object.keys(PSE.TECHS).find((id) => PSE.Sim.techAvailable(c, id));
  const r2 = PSE.Cmd.setResearchEx(w, 0, free2);
  if (!r2.ok || !r2.msg) throw new Error('换科研没有成功文案：' + (r2 && r2.msg));
  // 建造与情报局的成功路径同样要有文案（UI handler 直接 toast 命令返回的 msg）
  const b = PSE.Cmd.queueBuildEx(w, 'civ', c.capital);
  if (!b.ok || !b.msg) throw new Error('建造排队没有提示文案');
  c.pp = 200;
  const a1 = PSE.Spy.buildEx(w, c);
  if (!a1.ok || !a1.msg) throw new Error('成立情报局没有提示文案');
  const a2 = PSE.Spy.buildEx(w, c);
  if (a2.ok || a2.msg.indexOf('已经成立') < 0) throw new Error('重复成立情报局的提示不对：' + a2.msg);
  const s1 = PSE.Spy.recruitEx(w, c);
  if (!s1.ok || !s1.msg) throw new Error('招募特工没有提示文案');
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

step('海岸线数据（缺陷 A）：内陆省详情不再写「港口 是」', () => {
  const w = PSE.Game.world;
  const find = (nm) => w.provinces.find((p) => p.name === nm);
  const berlin = find('柏林'), hamburg = find('汉堡');
  if (!berlin || !hamburg) throw new Error('找不到柏林/汉堡省份');
  if (berlin.coastal || berlin.isPort) throw new Error('柏林仍被判为沿海/港口：coastal=' + berlin.coastal + ' isPort=' + berlin.isPort);
  if (!hamburg.coastal || !hamburg.isPort) throw new Error('汉堡丢了港口/沿海标记');
  PSE.UI.renderProvince(PSE.Game, berlin.id);
  const bhtml = document.getElementById('provinceInfo').innerHTML;
  if (bhtml.indexOf('港口</span><b>是</b>') >= 0) throw new Error('柏林省份详情仍写「港口 是」');
  if (bhtml.indexOf('港口</span><b>否</b>') < 0) throw new Error('柏林省份详情未写「港口 否」');
  PSE.UI.renderProvince(PSE.Game, hamburg.id);
  const hhtml = document.getElementById('provinceInfo').innerHTML;
  if (hhtml.indexOf('港口</span><b>是</b>') < 0) throw new Error('汉堡省份详情未写「港口 是」');
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

step('建设队列可取消：点 ✕ 命中那一项、行消失、toast 正确（新功能回归）', () => {
  const w = PSE.Game.world;
  const UI = PSE.UI;
  const c = w.countries[w.playerTag];
  c.construction.length = 0;
  const cap = c.capital;
  const r1 = PSE.Cmd.queueBuildEx(w, 'civ', cap);
  const r2 = PSE.Cmd.queueBuildEx(w, 'mil', cap);
  if (!r1.ok || !r2.ok) throw new Error('排队失败：' + r1.msg + ' / ' + r2.msg);
  if (c.construction.length !== 2) throw new Error('队列不是 2 项：' + c.construction.length);
  if (!c.construction[0].id || c.construction[0].id === c.construction[1].id) {
    throw new Error('建设项缺少唯一 id：' + c.construction.map((x) => x.id).join(','));
  }
  UI.setTab('production', PSE.Game);
  const body = document.getElementById('panelBody');
  const rows = body.querySelectorAll('[data-cancelbuild]');
  if (rows.length !== 2) throw new Error('取消按钮数不对：' + rows.length);
  const cancelId = c.construction[0].id;
  const toasts = [];
  const origToast = UI.toast;
  UI.toast = (msg) => { toasts.push(String(msg)); };
  try {
    rows[0].click();
    if (c.construction.length !== 1) throw new Error('点 ✕ 后队列没有减 1：' + c.construction.length);
    if (String(c.construction[0].id) === String(cancelId)) throw new Error('取消命中的是错的项');
    if (!/^已取消建设：.+（.+，已完成 \d+%）$/.test(toasts[0] || '')) throw new Error('toast 文案不对：' + toasts[0]);
    UI.renderPanel(PSE.Game);
    const html = document.getElementById('panelBody').innerHTML;
    if (html.indexOf('data-cancelbuild="' + cancelId + '"') >= 0) throw new Error('被取消的项仍在面板里');
    if (document.getElementById('panelBody').querySelectorAll('[data-cancelbuild]').length !== 1) throw new Error('取消后按钮数不对');
    // 再推进两天：剩下一项继续涨，被取消的那项不复活
    const before = c.construction[0].prog;
    for (let i = 0; i < 48; i++) PSE.Sim.tickHour(w);
    if (c.construction.length !== 1) throw new Error('被取消的项复活了：' + c.construction.length);
    if (!(c.construction[0].prog > before)) throw new Error('剩余项进度没涨：' + before + ' → ' + c.construction[0].prog);
    // 老存档（项没有 id）也要能用下标兜底取消
    c.construction[0].id = undefined;
    UI.renderPanel(PSE.Game);
    const rows2 = document.getElementById('panelBody').querySelectorAll('[data-cancelbuild]');
    if (rows2.length !== 1) throw new Error('无 id 项按钮数不对：' + rows2.length);
    if (rows2[0].dataset.cancelbuild !== '') throw new Error('无 id 项按钮 dataset 不对：' + JSON.stringify(rows2[0].dataset));
    toasts.length = 0;
    rows2[0].click();
    if (c.construction.length !== 0) throw new Error('无 id 项用下标兜底取消失败：' + c.construction.length);
  } finally { UI.toast = origToast; }
});

step('日志「仅我方 / 全部世界」切换 + 玩家消息不被世界要闻挤掉（新功能回归）', () => {
  const w = PSE.Game.world;
  const UI = PSE.UI;
  const head = document.getElementById('logHead');
  head.innerHTML = '<span class="muted">日志</span><button class="mini on" data-logfilter="mine">仅我方</button><button class="mini" data-logfilter="world">全部世界</button>';
  let otherTag = null;
  for (const t of Object.keys(w.countries)) {
    if (t !== w.playerTag && t !== 'NEU' && !PSE.Sim.isPlayerLog(w, { tag: t })) { otherTag = t; break; }
  }
  if (!otherTag) throw new Error('找不到与玩家无关的国家');
  const mineText = '我方测试消息：完成科技 测试';
  const otherText = '别国测试消息：巴西宣战阿根廷';
  w.log = [];
  PSE.log(w, mineText, 'tech', w.playerTag);
  PSE.log(w, otherText, 'war', otherTag);
  UI.setLogFilter('mine', PSE.Game);
  let html = document.getElementById('log').innerHTML;
  if (html.indexOf('我方测试消息') < 0) throw new Error('仅我方模式下看不到自己的消息');
  if (html.indexOf('别国测试消息') >= 0) throw new Error('仅我方模式下不该出现别国消息');
  const btns = head.querySelectorAll('[data-logfilter]');
  if (btns.length !== 2) throw new Error('日志过滤按钮数不对：' + btns.length);
  btns[1].click();
  if (UI.getLogFilter() !== 'world') throw new Error('切「全部世界」失败：' + UI.getLogFilter());
  html = document.getElementById('log').innerHTML;
  if (html.indexOf('别国测试消息') < 0) throw new Error('全部世界模式下看不到别国消息');
  btns[0].click();
  if (UI.getLogFilter() !== 'mine') throw new Error('切回「仅我方」失败：' + UI.getLogFilter());
  // 2000 条无关要闻走真实 PSE.log 路径后，玩家的消息仍在（保底缓冲 + 优先淘汰无关要闻）
  for (let i = 0; i < 2000; i++) PSE.log(w, '别国要闻 ' + i, 'eco', otherTag);
  if (w.log.length > 1000) throw new Error('日志容量失控：' + w.log.length);
  if (!w.log.some((e) => e.text === mineText)) throw new Error('保底缓冲里玩家消息被淘汰了');
  UI.setLogFilter('mine', PSE.Game);
  if (document.getElementById('log').innerHTML.indexOf('我方测试消息') < 0) throw new Error('2000 条要闻后日志面板看不到玩家消息');
});

step('和平会议「吞并」真实点击生效（空操作回归）', () => {
  const g = PSE.Game;
  const w = g.world;
  const UI = PSE.UI;
  const swiss = w.provinces.filter((p) => p.owner === 'SWI');
  if (!swiss.length) throw new Error('没有瑞士的省份，前置不成立');
  const me = w.playerTag;
  w.countries.SWI.capitulated = true;
  w.countries.SWI.annexedBy = undefined;
  for (const p of swiss) { p.controller = me; p.occupiedBy = me; }
  w.peaceConference = { defeated: 'SWI', main: w.playerTag, options: [], h: w.hour, playerChoice: null };
  const notes = [];
  const origToast = UI.toast;
  UI.toast = (msg) => { notes.push(msg); };
  try {
    UI.renderPeace(g);
    const modal = document.getElementById('peaceModal');
    const btns = document.getElementById('peaceOptions').querySelectorAll('[data-peace]');
    if (btns.length !== 3) throw new Error('处置选项数不对：' + btns.length);
    if (modal.classList.contains('hidden')) throw new Error('会议弹窗应先显示');
    btns[0].click();                       // 真派发 click →「吞并」
    if (w.countries.SWI.annexedBy !== me) throw new Error('点吞并没有设置 annexedBy（空操作回归）');
    if (!swiss.every((p) => p.owner === me && p.controller === me)) throw new Error('省份 owner/controller 未全部转入玩家');
    if (!(w.log || []).some((e) => /吞并了 瑞士/.test(e.text))) throw new Error('日志缺少「吞并了 瑞士」');
    if (!notes.some((m) => /已吞并 瑞士/.test(m))) throw new Error('没有成功提示：' + notes.join(' / '));
    if (w.peaceConference !== null) throw new Error('成功后会议应关闭');
    if (!modal.classList.contains('hidden')) throw new Error('成功后弹窗应隐藏');
    if (w.speed === 0) throw new Error('成功后应恢复游戏速度');
  } finally { UI.toast = origToast; }
});

step('和平会议处置失败时不关窗（保留会议可重试）', () => {
  const g = PSE.Game;
  const w = g.world;
  const UI = PSE.UI;
  const pol = w.provinces.filter((p) => p.owner === 'POL');
  if (!pol.length) throw new Error('没有波兰的省份，前置不成立');
  for (const p of pol) p.controller = 'GER';
  w.countries.POL.capitulated = true;
  w.countries.POL.annexedBy = 'GER';       // 模拟「已被吞并过」→ 处置必定失败
  w.peaceConference = { defeated: 'POL', main: w.playerTag, options: [], h: w.hour, playerChoice: null };
  const notes = [];
  const origToast = UI.toast;
  UI.toast = (msg) => { notes.push(msg); };
  try {
    UI.renderPeace(g);
    const modal = document.getElementById('peaceModal');
    const btns = document.getElementById('peaceOptions').querySelectorAll('[data-peace]');
    btns[0].click();
    if (w.peaceConference === null) throw new Error('失败时不该清空会议');
    if (modal.classList.contains('hidden')) throw new Error('失败时弹窗不该关闭');
    if (!notes.some((m) => /失败/.test(m))) throw new Error('失败没有给出原因：' + notes.join(' / '));
    if (!pol.every((p) => p.owner === 'POL')) throw new Error('失败时不该改动省份归属');
  } finally {
    UI.toast = origToast;
    w.countries.POL.annexedBy = undefined;
    w.peaceConference = null;
    PSE.UI.renderPeace(g);
  }
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

step('主题化下拉：触发器 + 页面内弹层 + 选中派发 change（不再弹原生系统列表）', () => {
  const fs = require('fs');
  const SU = PSE.SelectUI;
  if (!SU) throw new Error('PSE.SelectUI 未加载（index.html 需在 ui.js 之前加载 select.js）');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const isel = html.indexOf('src/select.js'), iui = html.indexOf('src/ui.js');
  if (isel < 0) throw new Error('index.html 未加载 select.js');
  if (!(isel < iui)) throw new Error('select.js 应在 ui.js 之前加载');
  if (html.indexOf('.pselPop') < 0 || html.indexOf('.pselNative') < 0) throw new Error('index.html 缺少主题化下拉样式');

  const host = document.createElement('div');
  const sel = document.createElement('select');
  sel.options = [
    { textContent: '德国', value: 'GER' },
    { textContent: '捷克斯洛伐克', value: 'CZE' },
    { textContent: '意大利', value: 'ITA' },
  ];
  sel.selectedIndex = 0; sel.value = 'GER';
  host.appendChild(sel);
  const n = SU.enhance(host);
  ok(n === 1, '渲染后统一入口增强 1 个 select');
  const st = SU.state(sel);
  ok(st.enhanced && !!st.trigger && !!st.popup, '触发器与弹层都已创建');
  ok(sel.classList.contains('pselNative') && sel.getAttribute('data-psel') === '1',
    '原生 select 已视觉隐藏（不会再弹系统列表），value/change 语义保留');
  ok(st.label === '德国', '触发器显示当前选项');
  const minW = parseInt(st.trigger.style.minWidth || '0', 10);
  ok(minW >= 78, '触发器宽度按最长选项自适应（minWidth ' + minW + 'px，长国名不裁切）');
  st.trigger.dispatchEvent(new Event('click'));
  const st2 = SU.state(sel);
  ok(st2.open === true && st2.popup.classList.contains('open'), '点击触发器打开页面内自定义弹层（非原生 UI）');
  ok(st2.trigger.getAttribute('aria-expanded') === 'true' && st2.popup.getAttribute('role') === 'listbox',
    'aria-expanded / role=listbox 正确');
  ok(st2.popup.children.length === 3, '弹层展开时重读 options（3 项全在，不缓存死选项）');
  let changed = 0;
  sel.addEventListener('change', () => { changed++; });
  st2.popup.children[1].dispatchEvent(new Event('click'));
  ok(sel.value === 'CZE' && SU.state(sel).label === '捷克斯洛伐克', '选中项 → select.value 更新且触发器文字同步');
  ok(changed === 1, 'change 事件照旧派发（面板原有 onchange 逻辑不用改）');
  ok(SU.isOpen() === false && !st2.popup.classList.contains('open'), '选中后弹层关闭');
});

step('装备设计器 5 个下拉：设 value + 派发 change → 真的生效（[data-design] 丢值回归）', () => {
  const UI = PSE.UI;
  const parts = PSE.EQ_PARTS;
  const previewOf = () => PSE.deriveEquipment(Object.assign({}, UI.getDesign(), { name: '预览', id: 'custom_preview' }));
  const stateOf = () => JSON.stringify(previewOf());
  const selectFor = (k, v) => {
    const sel = document.createElement('select');
    sel.dataset.design = k;
    sel.value = v;
    sel.options = Object.keys(parts[k]).map((o) => ({ textContent: parts[k][o].name, value: o }));
    sel.selectedIndex = Object.keys(parts[k]).indexOf(v);
    return sel;
  };
  const checkKey = (k) => {
    const opts = Object.keys(parts[k]);
    const val = opts[opts.length - 1];
    const before = stateOf();
    const sel = selectFor(k, val);
    ok(UI.applyDesignChange(sel) === true && UI.getDesign()[k] === val,
      '下拉 ' + k + ' 选 ' + val + ' → 设计状态生效（旧版变 undefined）');
    UI.renderPanel(PSE.Game);
    const h = document.getElementById('panelBody').innerHTML;
    const i = h.indexOf('<select data-design="' + k + '">');
    const seg = i >= 0 ? h.slice(i, h.indexOf('</select>', i)) : '';
    ok(seg.indexOf('value="' + val + '" selected') >= 0, '重绘后 ' + k + ' 仍选中 ' + val + '（不再回退第一项）');
    ok(stateOf() !== before, '切换 ' + k + ' 后预览数值（成本/火力等）随之变化');
  };

  UI.setDesign('role', 'tank');
  UI.setDesign('chassis', 'medium'); UI.setDesign('gun', 'medium');
  UI.setDesign('armor', 'medium'); UI.setDesign('engine', 'petrol');
  UI.setTab('equipment', PSE.Game);
  const html0 = document.getElementById('panelBody').innerHTML;
  for (const k of ['chassis', 'gun', 'armor', 'engine']) {
    if (html0.indexOf('data-design="' + k + '"') < 0) throw new Error('坦克设计器缺少下拉 ' + k);
  }
  for (const k of ['chassis', 'gun', 'armor', 'engine']) checkKey(k);
  // 飞机形态走按钮路径（data-design="role:air"，值在冒号后）
  const btn = document.createElement('button');
  btn.dataset.design = 'role:air';
  ok(UI.applyDesignChange(btn) === true && UI.getDesign().role === 'air', '按钮 data-design="role:air" → 切到飞机形态');
  UI.renderPanel(PSE.Game);
  if (document.getElementById('panelBody').innerHTML.indexOf('data-design="airframe"') < 0) throw new Error('飞机设计器缺少 airframe 下拉');
  checkKey('airframe');
  UI.setDesign('role', 'tank');
  UI.setTab('equipment', PSE.Game);
});

console.log('\n运行结果：' + PSE.Time.format(PSE.Game.world.hour) +
  '｜战斗 ' + (PSE.Game.world.stats.battles || 0) + ' 次｜战争 ' + PSE.Game.world.wars.length + ' 场');
console.log('\n' + (failures === 0 ? '\x1b[32m冒烟测试全部通过\x1b[0m' : '\x1b[31m失败 ' + failures + ' 项\x1b[0m') + '（检查 ' + checks + ' 项）');
process.exit(failures === 0 ? 0 : 1);
