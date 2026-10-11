/* 诊断：同包围盒省是否为完全重叠（Voronoi 裁剪失败） */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'core.js'));
require(path.join(__dirname, '..', 'data', 'map-generated.js'));
const G = globalThis.PSE.MAP_GEO;

function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
function key(p) { return p.poly.map((v) => v[0].toFixed(2) + ',' + v[1].toFixed(2)).join(';'); }

// 按包围盒分组
const groups = new Map();
for (const p of G.provinces) {
  let minx = 1e9, maxx = -1e9;
  for (const v of p.poly) { minx = Math.min(minx, v[0]); maxx = Math.max(maxx, v[0]); }
  const k = p.owner + '|' + minx.toFixed(1) + '|' + maxx.toFixed(1);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}
let dupGroups = 0, dupProvs = 0;
for (const [k, list] of groups) {
  if (list.length < 2) continue;
  const keys = new Set(list.map(key));
  if (keys.size < list.length) {
    dupGroups++;
    dupProvs += list.length;
    if (dupGroups <= 6) {
      console.log('重复组 ' + k + '：' + list.length + ' 省，唯一多边形 ' + keys.size + ' 个 → ' + list.map((p) => p.name + '(a=' + area(p.poly).toFixed(1) + ',n=' + p.poly.length + ')').join(' / '));
    }
  }
}
console.log('完全重叠组数: ' + dupGroups + '，涉及省数: ' + dupProvs + ' / ' + G.provinces.length);

// 全局面积分布
const areas = G.provinces.map((p) => area(p.poly)).sort((a, b) => a - b);
console.log('省面积分位: min=' + areas[0].toFixed(2) + ' p25=' + areas[Math.floor(areas.length * 0.25)].toFixed(2) + ' 中位=' + areas[Math.floor(areas.length / 2)].toFixed(2) + ' p75=' + areas[Math.floor(areas.length * 0.75)].toFixed(2) + ' max=' + areas[areas.length - 1].toFixed(2));

// 抽查：美国21 vs 22 顶点对比
const a21 = G.provinces.find((p) => p.name === '美国第21区');
const a22 = G.provinces.find((p) => p.name === '美国第22区');
if (a21 && a22) {
  console.log('21区前5顶点: ' + JSON.stringify(a21.poly.slice(0, 5)));
  console.log('22区前5顶点: ' + JSON.stringify(a22.poly.slice(0, 5)));
  console.log('21==22 同多边形? ' + (key(a21) === key(a22)));
}
