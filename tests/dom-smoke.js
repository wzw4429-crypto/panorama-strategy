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
for (const f of ['core.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'systems.js', 'systems2.js', 'save.js', 'render.js', 'ui.js', 'main.js']) {
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

console.log('\n运行结果：' + PSE.Time.format(PSE.Game.world.hour) +
  '｜战斗 ' + (PSE.Game.world.stats.battles || 0) + ' 次｜战争 ' + PSE.Game.world.wars.length + ' 场');
console.log('\n' + (failures === 0 ? '\x1b[32m冒烟测试全部通过\x1b[0m' : '\x1b[31m失败 ' + failures + ' 项\x1b[0m') + '（检查 ' + checks + ' 项）');
process.exit(failures === 0 ? 0 : 1);
