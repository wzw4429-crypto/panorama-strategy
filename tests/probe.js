/* PSE · 单场景探针：诊断移动/宣战/战斗链路 */
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['core.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'save.js']) require(path.join(SRC, f));
const PSE = globalThis.PSE;

const w = PSE.World.create({ playerTag: 'GER', seed: 19360101 });
const gerProv = w.provinces.find((p) => p.owner === 'GER' && p.neighbors.some((n) => w.provinces[n].owner === 'POL'));
console.log('德方起省:', gerProv.name, gerProv.id, '邻居:', gerProv.neighbors.map((n) => w.provinces[n].name + '(' + w.provinces[n].owner + ')').join(', '));
const polProvId = gerProv.neighbors.find((n) => w.provinces[n].owner === 'POL');
console.log('目标省:', w.provinces[polProvId].name, polProvId, 'controller=', w.provinces[polProvId].controller);

// 清空他国
for (const d of w.divisions.slice()) if (d.tag !== 'GER' && d.tag !== 'POL') PSE.World.removeDivision(w, d);
for (const t of Object.keys(w.countries)) if (t !== 'GER' && t !== 'POL') { w.countries[t].divisions = []; w.countries[t].capitulated = true; }
for (const d of w.divisions) { d.loc = d.tag === 'GER' ? gerProv.id : polProvId; d.org = d.orgMax; d.hp = d.hpMax; d.str = 1; d.supply = 1; }

const war = PSE.Diplo.declareWar(w, 'GER', 'POL', { silent: true });
console.log('宣战返回:', war ? ('war#' + war.id + ' atk=' + war.attackers + ' def=' + war.defenders) : 'null');
console.log('areAtWar(GER,POL) =', PSE.World.areAtWar(w, 'GER', 'POL'));
console.log('passable(目标省, GER) =', PSE.Sim.passable(w, w.provinces[polProvId], 'GER'));

const gerDivs = w.divisions.filter((d) => d.tag === 'GER');
console.log('德军师数:', gerDivs.length, '首师 loc=', gerDivs[0].loc, 'tpl=', gerDivs[0].tplId, 'speed=', gerDivs[0].template.speed);
const p0 = PSE.Sim.findPath(w, gerDivs[0], polProvId);
console.log('findPath 结果:', p0 === null ? 'null' : JSON.stringify(p0));
const n = PSE.Sim.orderMove(w, gerDivs, polProvId);
console.log('orderMove 下达:', n, '首师 path=', JSON.stringify(gerDivs[0].path), 'status=', gerDivs[0].status);

// 跑 60 天（带诊断）
let firstBattle = -1, ended = -1;
for (let i = 0; i < 24 * 90; i++) {
  PSE.Sim.tickHour(w);
  if (firstBattle < 0 && w.battles.length) {
    firstBattle = w.hour;
    const b = w.battles[0];
    console.log('战斗爆发 h=' + w.hour + ' 攻方=' + b.atk.length + ' 守方=' + b.def.length + ' 省=' + w.provinces[b.prov].name);
  }
  if (w.hour % 24 === 0 && i < 24 * 14) {
    const b = w.battles[0];
    const in179 = w.divisions.filter((d) => d.loc === polProvId);
    const in178 = w.divisions.filter((d) => d.loc === gerProv.id);
    console.log('  d' + Math.floor(w.hour / 24) +
      ' battles=' + w.battles.length +
      (b ? ' [atk=' + b.atk.length + ' def=' + b.def.length + ' dmg→def ' + (b.lastAtkDmg || 0).toFixed(2) + ' dmg→atk ' + (b.lastDefDmg || 0).toFixed(2) + ']' : '') +
      ' 省179内=' + in179.length + '(org ' + (in179.length ? in179.reduce((s, d) => s + d.org, 0) / in179.length : 0).toFixed(1) + ')' +
      ' 省178内=' + in178.length + '(org ' + (in178.length ? in178.reduce((s, d) => s + d.org, 0) / in178.length : 0).toFixed(1) + ')' +
      ' 移动中=' + w.divisions.filter((d) => d.status === 'moving').length);
  }
  if (firstBattle > 0 && !w.battles.length) {
    ended = w.hour;
    console.log('战斗结束 h=' + w.hour + ' 历时=' + (w.hour - firstBattle) + 'h 控制方=' + w.provinces[polProvId].controller);
    break;
  }
}
const gd = w.divisions.filter((d) => d.tag === 'GER');
const pd = w.divisions.filter((d) => d.tag === 'POL');
console.log('残存：德军 ' + gd.length + ' 师（均org ' + (gd.length ? (gd.reduce((s, d) => s + d.org, 0) / gd.length).toFixed(1) : '-') + '），波军 ' + pd.length + ' 师');
console.log('已用时: ' + PSE.Time.format(w.hour));
