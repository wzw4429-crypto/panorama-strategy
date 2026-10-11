/* PSE · 世界地图集成探针：验证 1234 省 / 57 国的世界规模下仿真是否正常 */
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const DATA = path.join(__dirname, '..', 'data');
require(path.join(SRC, 'core.js'));
require(path.join(SRC, 'data-rules.js'));
require(path.join(DATA, 'map-generated.js'));
for (const f of ['data-map.js', 'world.js', 'sim.js', 'ai.js', 'save.js']) require(path.join(SRC, f));
const PSE = globalThis.PSE;

const MD = PSE.MapData;
console.log('省份数=' + MD.provinces.length + '  国家数=' + Object.keys(PSE.COUNTRIES).length +
  '  海区=' + MD.seaZones.length + '  跨海通道=' + MD.straits.length);
console.log('投影自检: 伦敦=' + MD.project(-0.13, 51.5).map((v) => v.toFixed(3)).join(',') +
  '  莫斯科=' + MD.project(37.6, 55.75).map((v) => v.toFixed(3)).join(',') +
  '  东京=' + MD.project(139.69, 35.69).map((v) => v.toFixed(3)).join(','));
// 点选自检
for (const [name, lon, lat] of [['柏林', 13.4, 52.52], ['巴黎', 2.35, 48.86], ['莫斯科', 37.6, 55.75],
  ['华盛顿', -77.04, 38.91], ['东京', 139.69, 35.69], ['北京', 116.41, 39.9], ['开罗', 31.24, 30.04],
  ['大西洋中部', -30, 45], ['太平洋中部', -150, 20]]) {
  const p = MD.pickProvince(lon, lat);
  console.log('  点选 ' + name + ' → ' + (p ? (p.name + '(' + p.owner + ')') : '海面'));
}

const t0 = Date.now();
const w = PSE.World.create({ playerTag: 'GER', seed: 19360101 });
console.log('世界构建 ' + (Date.now() - t0) + 'ms；师团=' + w.divisions.length + '；省=' + w.provinces.length);
let noDiv = [];
for (const t in w.countries) {
  if (!w.countries[t].divisions.length) noDiv.push(t);
}
console.log('无初始部队的国家: ' + (noDiv.length ? noDiv.join(',') : '无'));
// 陆军规模前 10
const top = Object.keys(w.countries).map((t) => ({ t, n: w.countries[t].divisions.length, c: w.countries[t].factories.civ }))
  .sort((a, b) => b.n - a.n).slice(0, 10);
console.log('师团数前 10: ' + top.map((x) => x.t + ':' + x.n).join(' '));

const t1 = Date.now();
for (let i = 0; i < 24 * 180; i++) PSE.Sim.tickHour(w);
const ms = Date.now() - t1;
console.log('180 天耗时 ' + ms + 'ms → ' + Math.round(24 * 180 / (ms / 1000)) + ' 游戏小时/秒');
console.log('时间=' + PSE.Time.format(w.hour) + ' 战斗=' + (w.stats.battles || 0) + ' 战争=' + w.wars.length +
  ' 事件待决=' + (w.events.current ? w.events.current.id : '无'));
const nan = [];
(function scan(o, p, d) {
  if (nan.length > 5 || d > 5) return;
  if (typeof o === 'number') { if (!isFinite(o)) nan.push(p); return; }
  if (!o || typeof o !== 'object') return;
  for (const k in o) scan(o[k], p + '.' + k, d + 1);
})(w, 'w', 0);
console.log('非有限数值: ' + (nan.length ? nan.join(',') : '无'));
const sample = ['GER', 'SOV', 'USA', 'JAP', 'CHI', 'ENG', 'FRA', 'ITA'];
for (const t of sample) {
  const c = w.countries[t];
  if (!c) continue;
  const eq = Object.keys(c.stockpile).reduce((s, k) => s + (c.stockpile[k] || 0), 0);
  console.log('  [' + t + '] 省=' + MD.provinces.filter((p) => p.owner === t).length +
    ' 民工=' + c.factories.civ + ' 军工=' + c.factories.mil + ' 师=' + c.divisions.length +
    ' 装备=' + Math.round(eq) + ' pp=' + Math.round(c.pp) + ' 科技=' + c.researched.length +
    ' 国策=' + c.focusDone.length + ' 人力=' + Math.round(c.manpower) + 'k 稳定=' + c.stability.toFixed(2));
}
