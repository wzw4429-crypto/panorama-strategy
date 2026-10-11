/* 诊断：找"横跨整行"的错位省（经度跨度异常 / 反经线 / 环拼接） */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'core.js'));
require(path.join(__dirname, '..', 'data', 'map-generated.js'));
const G = globalThis.PSE.MAP_GEO;

const wide = [];
for (const p of G.provinces) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  let hasE = false, hasW = false;
  for (const v of p.poly) {
    if (v[0] < minx) minx = v[0];
    if (v[0] > maxx) maxx = v[0];
    if (v[1] < miny) miny = v[1];
    if (v[1] > maxy) maxy = v[1];
    if (v[0] > 175) hasE = true;
    if (v[0] < -175) hasW = true;
  }
  const w = maxx - minx, h = maxy - miny;
  if (w > 20 || hasE && hasW) wide.push({ name: p.name, owner: p.owner, w: +w.toFixed(1), h: +h.toFixed(1), minx: +minx.toFixed(1), maxx: +maxx.toFixed(1), miny: +miny.toFixed(1), maxy: +maxy.toFixed(1), n: p.poly.length, wrap: hasE && hasW });
}
wide.sort((a, b) => b.w - a.w);
console.log('经度跨度 >20° 或 同时含 ±175° 顶点的省：共 ' + wide.length);
for (const p of wide.slice(0, 25)) {
  console.log('  ' + p.name + '(' + p.owner + ') 宽' + p.w + '° 高' + p.h + '° lon[' + p.minx + ',' + p.maxx + '] lat[' + p.miny + ',' + p.maxy + '] n=' + p.n + (p.wrap ? ' **跨反经线**' : ''));
}

// 水平细带：宽 > 10° 且 高 < 1° 的省（"一整行"特征）
let bands = 0;
for (const p of G.provinces) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const v of p.poly) { minx = Math.min(minx, v[0]); maxx = Math.max(maxx, v[0]); miny = Math.min(miny, v[1]); maxy = Math.max(maxy, v[1]); }
  if (maxx - minx > 10 && maxy - miny < 1) { if (bands < 10) console.log('  水平细带: ' + p.name + '(' + p.owner + ') lon[' + minx.toFixed(1) + ',' + maxx.toFixed(1) + '] lat[' + miny.toFixed(1) + ',' + maxy.toFixed(1) + ']'); bands++; }
}
console.log('水平细带省总数: ' + bands);
