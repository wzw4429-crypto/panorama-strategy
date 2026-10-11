/* PSE · 战争节奏诊断：观察 AI 能否推进战线
 * 用法：node tests/probe2.js [月数]
 */
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['core.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'save.js']) require(path.join(SRC, f));
const PSE = globalThis.PSE;

const w = PSE.World.create({ playerTag: 'NONE', seed: 19360101 });
const months = parseInt(process.argv[2] || '60', 10);

function vpPct(c) { return Math.round(100 * (c.vpHeld / Math.max(1, c.vpTotal))); }
function frontCount(tag) {
  try { return PSE.AI.frontProvinces(w, w.countries[tag]).fronts.length; } catch (e) { return -1; }
}
function line() {
  const g = w.countries.GER, p = w.countries.POL, f = w.countries.FRA, s = w.countries.SOV;
  const wars = w.wars.map((x) => x.attackers.join('+') + '>' + x.defenders.join('+')).join(' ') || '-';
  console.log(PSE.Time.format(w.hour).slice(0, 10) +
    ' 战[' + w.wars.length + '] ' + wars +
    ' | GER师=' + g.divisions.length + ' 前省=' + frontCount('GER') + ' VP=' + vpPct(g) + '%' +
    ' | POL师=' + p.divisions.length + ' VP=' + vpPct(p) + '%' + (p.capitulated ? '(降)' : '') +
    ' | FRA师=' + f.divisions.length + ' VP=' + vpPct(f) + '%' + (f.capitulated ? '(降)' : '') +
    ' | SOV师=' + s.divisions.length +
    ' | 战斗=' + (w.stats.battles || 0) + ' 紧张=' + w.tension.toFixed(0));
}

for (let m = 0; m < months; m++) {
  for (let h = 0; h < 24 * 30; h++) PSE.Sim.tickHour(w);
  if (m % 3 === 0 || w.wars.length > 0) line();
}

console.log('\n--- 战争与战斗明细 ---');
for (const war of w.wars) {
  console.log('战争#' + war.id + ': ' + war.attackers.join('+') + ' vs ' + war.defenders.join('+') +
    ' 开始=' + PSE.Time.format(war.startH).slice(0, 10) + ' 战争分=' + (war.warScore || 0).toFixed(1));
}
console.log('累计战斗=' + (w.stats.battles || 0));
const gd = w.divisions.filter((d) => d.tag === 'GER');
console.log('德军: ' + gd.length + ' 师 | 交战中=' + gd.filter((d) => d.battleId != null).length +
  ' 移动中=' + gd.filter((d) => d.status === 'moving').length +
  ' 空闲=' + gd.filter((d) => d.status === 'idle' && d.battleId == null).length +
  ' 均org%=' + (gd.reduce((s, d) => s + d.org / d.orgMax, 0) / Math.max(1, gd.length) * 100).toFixed(0));
console.log('德军在波兰境内师数=' + w.divisions.filter((d) => d.tag === 'GER' && w.provinces[d.loc].owner === 'POL').length);
console.log('\n德军抽样（id 省份 补给 控制者 org/orgMax str supply 状态 堑壕 装备需求）:');
for (const d of gd.slice(0, 6)) {
  const p = w.provinces[d.loc];
  const need = PSE.World.equipNeed(d.tplId);
  const eqStr = Object.keys(need.equip).map((e) => e + '=' + Math.round(need.equip[e] * (1 - d.str)) + '(存' + Math.round(w.countries.GER.stockpile[e] || 0) + ')').join(' ');
  console.log('  #' + d.id + ' ' + p.name + ' 省补给=' + p.supply.toFixed(2) + ' 控制者=' + p.controller +
    ' org=' + d.org.toFixed(1) + '/' + d.orgMax.toFixed(1) + ' str=' + d.str.toFixed(2) +
    ' supply=' + (d.supply || 0).toFixed(2) + ' ' + d.status + ' 壕=' + d.entrench.toFixed(1) + ' | ' + eqStr);
}
console.log('\n德国国库： ' + Object.keys(w.countries.GER.stockpile).map((k) => k + '=' + Math.round(w.countries.GER.stockpile[k])).join(' '));
console.log('德国民工/军工=' + w.countries.GER.factories.civ + '/' + w.countries.GER.factories.mil +
  ' 人力=' + Math.round(w.countries.GER.manpower) + ' 建造队列=' + w.countries.GER.construction.length);
for (const b of w.battles) {
  const p = w.provinces[b.prov];
  console.log('进行中: ' + p.name + ' atk=' + b.atk.length + '/' + (b.engaged ? b.engaged.atk : '?') +
    ' def=' + b.def.length + '/' + (b.engaged ? b.engaged.def : '?') +
    ' 宽度=' + (b.engaged ? b.engaged.allowedA + '/' + b.engaged.allowedD : '?'));
}
