/* PSE · 组织度恢复探针：验证 idle 师团在低补给下是否会恢复组织度 */
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['core.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'save.js']) require(path.join(SRC, f));
const PSE = globalThis.PSE;

const w = PSE.World.create({ playerTag: 'NONE', seed: 19360101 });
// 找一个内陆且无邻国敌意的德国师
const d = w.divisions.find((x) => x.tag === 'GER' && w.provinces[x.loc].owner === 'GER');
console.log('样本师 #' + d.id + ' 位于 ' + w.provinces[d.loc].name + '（' + d.tplId + '）');
console.log('初始: org=' + d.org.toFixed(2) + '/' + d.orgMax + ' str=' + d.str + ' supply=' + d.supply + ' tier=' + PSE.Sim.supplyTier(d.supply) + ' status=' + d.status);
// 手工制造"低组织度 + 中等补给 + 空闲"场景
d.status = 'idle'; d.battleId = null; d.path = []; d.moveTo = null; d.org = 2;
for (let i = 0; i < 24; i++) PSE.Sim.tickHour(w);
console.log('24h 后: org=' + d.org.toFixed(2) + ' supply=' + d.supply + ' tier=' + PSE.Sim.supplyTier(d.supply) + ' status=' + d.status + ' battle=' + d.battleId + ' loc=' + w.provinces[d.loc].name);
for (let i = 0; i < 24 * 7; i++) PSE.Sim.tickHour(w);
console.log('8 天后: org=' + d.org.toFixed(2) + '/' + (d.orgMax * d.str).toFixed(2) + ' supply=' + d.supply + ' status=' + d.status + ' battle=' + d.battleId);
console.log('（若 org 仍接近 2，说明恢复逻辑或补给档位判定有问题）');

// ---- 长跑观察：全 AI 托管下，德国师团的组织度轨迹 ----
console.log('\n=== 全 AI 托管：跟踪德国前 3 个师的组织度轨迹（每 10 天）===');
const w2 = PSE.World.create({ playerTag: 'NONE', seed: 19360101 });
const track = w2.divisions.filter((x) => x.tag === 'GER').slice(0, 3).map((x) => x.id);
for (let day = 1; day <= 120; day++) {
  for (let h = 0; h < 24; h++) PSE.Sim.tickHour(w2);
  if (day % 10 === 0) {
    const parts = track.map((id) => {
      const d = w2.divisions.find((x) => x.id === id);
      if (!d) return '#' + id + '(已损)';
      const p = w2.provinces[d.loc];
      return '#' + id + ' org=' + d.org.toFixed(1) + '/' + d.orgMax.toFixed(0) +
        ' sup=' + (d.supply === undefined ? 'undef' : d.supply.toFixed(2)) +
        ' ' + d.status + (d.battleId != null ? '(战)' : '') + ' @' + p.name;
    });
    console.log('  d' + day + ': ' + parts.join(' | '));
  }
}
console.log('共 ' + (w2.stats.battles || 0) + ' 场战斗，战争数 ' + w2.wars.length +
  '，德军 ' + w2.divisions.filter((d) => d.tag === 'GER').length + ' 师');
