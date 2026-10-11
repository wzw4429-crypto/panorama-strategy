/* 诊断：找出口渲染中那些跨越海洋/超长的"国界线"来源 */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'core.js'));
require(path.join(__dirname, '..', 'data', 'map-generated.js'));
const G = globalThis.PSE.MAP_GEO;

const long = [];
for (const p of G.provinces) {
  for (const [i, j] of (p.borderEdges || [])) {
    const a = p.poly[i], b = p.poly[j];
    if (!a || !b) continue;
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (len > 2) long.push({ name: p.name, owner: p.owner, a, b, len: +len.toFixed(2) });
  }
}
long.sort((x, y) => y.len - x.len);
console.log('超长国界边（>2°）共 ' + long.length + ' 条，前 15 条：');
for (const e of long.slice(0, 15)) {
  console.log('  ' + e.name + '(' + e.owner + ') ' + e.a + ' → ' + e.b + '  长 ' + e.len + '°');
}

// 大西洋中部（lon -40..-15, lat 10..35）是否出现省顶点
let atl = 0;
for (const p of G.provinces) {
  for (const v of p.poly) {
    if (v[0] > -40 && v[0] < -15 && v[1] > 10 && v[1] < 35) {
      if (atl < 12) console.log('  大西洋顶点: ' + p.name + '(' + p.owner + ') ' + v);
      atl++;
    }
  }
}
console.log('大西洋区顶点总数: ' + atl);

// 找出超长多边形边（形状异常细长）
let slivers = 0;
for (const p of G.provinces) {
  let maxEdge = 0;
  for (let i = 0; i < p.poly.length; i++) {
    const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length];
    maxEdge = Math.max(maxEdge, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  if (maxEdge > 3) { if (slivers < 12) console.log('  细长省: ' + p.name + '(' + p.owner + ') 最长边 ' + maxEdge.toFixed(2) + '° 顶点数 ' + p.poly.length); slivers++; }
}
console.log('细长省总数: ' + slivers);
