/* PSE · 组织度死锁定点排查：找到低组织度的空闲师，逐小时观察其状态变化 */
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['core.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'save.js']) require(path.join(SRC, f));
const PSE = globalThis.PSE;

const w = PSE.World.create({ playerTag: 'NONE', seed: 19360101 });
const months = parseInt(process.argv[2] || '10', 10);
for (let m = 0; m < months; m++) for (let h = 0; h < 24 * 30; h++) PSE.Sim.tickHour(w);

function dp(d) {
  const p = w.provinces[d.loc];
  return '#' + d.id + ' ' + p.name + ' org=' + d.org.toFixed(2) + '/' + (d.orgMax * d.str).toFixed(2) +
    ' str=' + d.str.toFixed(3) + ' hp=' + d.hp.toFixed(1) + '/' + d.hpMax.toFixed(0) +
    ' supply=' + (d.supply === undefined ? 'undefined' : d.supply.toFixed(3)) +
    ' tier=' + PSE.Sim.supplyTier(d.supply) + ' status=' + d.status + ' battle=' + d.battleId +
    ' entrench=' + d.entrench.toFixed(1) + ' path=' + JSON.stringify(d.path) + ' moveTo=' + d.moveTo;
}

const low = w.divisions.filter((d) => d.org < d.orgMax * d.str * 0.5).sort((a, b) => a.org - b.org);
console.log('低组织度师团数 = ' + low.length + ' / 总 ' + w.divisions.length);
if (!low.length) { console.log('（没有低组织度师团，说明恢复正常）'); process.exit(0); }
const target = low[0];
console.log('取样: ' + dp(target));
console.log('该省: owner=' + w.provinces[target.loc].owner + ' controller=' + w.provinces[target.loc].controller +
  ' 抵抗=' + w.provinces[target.loc].resistance.toFixed(0) + ' 省 supply=' + w.provinces[target.loc].supply.toFixed(3));

console.log('\n逐小时观察（若 status 恒为 moving/idle 但 org 不涨，即为 bug）:');
for (let h = 1; h <= 48; h++) {
  PSE.Sim.tickHour(w);
  if (h <= 6 || h % 12 === 0) console.log('  +' + h + 'h: ' + dp(target));
}
const sample = w.divisions.filter((d) => d.tag === target.tag).slice(0, 5);
console.log('\n同国抽样:');
for (const d of sample) console.log('  ' + dp(d));

// 直接统计：全部师团按 status 分布
const dist = {};
for (const d of w.divisions) {
  const k = d.status + (d.battleId != null ? '+battle' : '');
  dist[k] = (dist[k] || 0) + 1;
}
console.log('\n全球师团状态分布: ' + JSON.stringify(dist));
const tierDist = {};
for (const d of w.divisions) {
  const t = PSE.Sim.supplyTier(d.supply);
  tierDist[t] = (tierDist[t] || 0) + 1;
}
console.log('全球师团补给档位分布: ' + JSON.stringify(tierDist));
const supUndef = w.divisions.filter((d) => d.supply === undefined).length;
console.log('supply 为 undefined 的师团数 = ' + supUndef);
