/* PSE · 地图数据层 (data-map.js)
 * 消费 data/map-generated.js（由 tools/build-map.js 从 Natural Earth 110m 生成的真实地理多边形），
 * 产出与仿真层对接的省份数组。保留旧版导出面，新增多边形/投影/点选支持。
 * 加载顺序：core → data-rules → data/map-generated → data-map → world
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});
  const U = PSE.U;

  const G = PSE.MAP_GEO;
  if (!G) throw new Error('缺少 PSE.MAP_GEO：请确认已加载 data/map-generated.js');

  const W = G.gridW, H = G.gridH;
  const BBOX = G.bbox;

  // ============================================================
  // 1. 省份
  // ============================================================
  const CODE_TO_TAG = {
    NOR: 'NOR', SWE: 'SWE', FIN: 'FIN', SOV: 'SOV', BAL: 'BAL', DEN: 'DEN', ENG: 'ENG',
    LOW: 'LOW', GER: 'GER', POL: 'POL', CZE: 'CZE', AUS: 'AUS', SWI: 'SWI', FRA: 'FRA',
    HUN: 'HUN', ROM: 'ROM', YUG: 'YUG', ITA: 'ITA', BUL: 'BUL', GRE: 'GRE', TUR: 'TUR',
    SPA: 'SPA', POR: 'POR',
  };
  const COLONIAL_TAGS = { FRA: true, ITA: true, ENG: true }; // 仅作占位（真正判断看 province.colonial）

  const provinces = G.provinces.map((s) => ({
    id: s.id,
    x: s.x, y: s.y,
    cx: s.cx, cy: s.cy,
    poly: s.poly,
    code: s.owner,
    owner: s.owner,
    controller: s.owner,
    terrain: s.terrain,
    name: s.name,
    vp: s.vp || 0,
    isPort: !!s.isPort,
    hasAirbase: !!s.hasAirbase,
    airbase: s.hasAirbase ? 2 : (s.coastal ? 1 : 0),
    infra: 3,
    rail: s.isPort ? 2 : 1,
    fort: 0,
    population: s.pop || 0,          // 单位：百万人（world.js 直接使用）
    resource: Object.assign({ oil: 0, rubber: 0, steel: 0, aluminum: 0, tungsten: 0, chromium: 0 }, s.resource),
    neighbors: (s.neighbors || []).slice(),
    borderEdges: (s.borderEdges || []).slice(),   // 国界边（顶点索引对，渲染描粗用）
    seaNeighbors: [],                // 跨海通道伙伴（海峡两岸/岛屿），供 world.js 生成 seaLinks
    seaZones: (s.seaZones || []).slice(),
    coastal: !!s.coastal,
    colonial: !!s.colonial,
    isCity: (s.vp || 0) > 0,
    resistance: 0,
    compliance: 1,
    supplyAt: 1,
    buildings: { civ: 0, mil: 0, dock: 0 },
  }));

  const provincesById = {};
  for (const p of provinces) provincesById[p.id] = p;

  // 跨海通道 → seaNeighbors
  const straits = (G.straits || []).slice();
  for (const [a, b] of straits) {
    if (!provincesById[a] || !provincesById[b]) continue;
    if (provincesById[a].seaNeighbors.indexOf(b) < 0) provincesById[a].seaNeighbors.push(b);
    if (provincesById[b].seaNeighbors.indexOf(a) < 0) provincesById[b].seaNeighbors.push(a);
  }

  // ============================================================
  // 2. 投影（等距圆柱 plate carrée）
  //   x 线性于经度、y 线性于纬度：无墨卡托高纬拉伸，
  //   点选/拖拽/缩放全部为线性换算，最适合游戏地图。
  // ============================================================
  function project(lon, lat) {
    const x = (lon - BBOX.lonMin) / (BBOX.lonMax - BBOX.lonMin);
    const y = (BBOX.latMax - lat) / (BBOX.latMax - BBOX.latMin);
    return [x, y];
  }
  function unproject(nx, ny) {
    const lon = BBOX.lonMin + nx * (BBOX.lonMax - BBOX.lonMin);
    const lat = BBOX.latMax - ny * (BBOX.latMax - BBOX.latMin);
    return [lon, lat];
  }

  // ============================================================
  // 3. 点选（1° 空间桶 + 射线法）
  // ============================================================
  const buckets = {};
  const landCover = {};    // 桶是否被陆地覆盖（用于快速判断海面）
  for (const p of provinces) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const v of p.poly) {
      if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0];
      if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1];
    }
    p._bb = [x0, y0, x1, y1];
    for (let lon = Math.floor(x0); lon <= Math.floor(x1); lon++) {
      for (let lat = Math.floor(y0); lat <= Math.floor(y1); lat++) {
        const k = lon + ',' + lat;
        (buckets[k] = buckets[k] || []).push(p);
        landCover[k] = true;
      }
    }
  }
  function pointInPoly(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function pickProvince(lon, lat) {
    const list = buckets[Math.floor(lon) + ',' + Math.floor(lat)];
    if (!list) return null;
    for (const p of list) {
      if (lon < p._bb[0] || lon > p._bb[2] || lat < p._bb[1] || lat > p._bb[3]) continue;
      if (pointInPoly(lon, lat, p.poly)) return p;
    }
    return null;
  }
  function isLand(lon, lat) { return !!pickProvince(lon, lat); }

  // ============================================================
  // 4. 兼容旧接口
  // ============================================================
  const gridIndex = {};
  for (const p of provinces) gridIndex[p.y * W + p.x] = p;
  function at(x, y) { return gridIndex[y * W + x] || null; }
  function idx(x, y) { return y * W + x; }
  function nearestProvinceOfTag(lon, lat, tag) {
    let best = null, bestD = 1e9;
    for (const p of provinces) {
      if (tag && p.owner !== tag) continue;
      const d = Math.hypot(p.cx - lon, p.cy - lat);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
  function nearestLand(lon, lat) { return nearestProvinceOfTag(lon, lat, null); }

  const POP_BY_TAG = {};
  for (const p of provinces) POP_BY_TAG[p.owner] = (POP_BY_TAG[p.owner] || 0) + (p.colonial ? 0 : p.population);

  /** 供无头测试做几何自检的粗略 ASCII 图（60×30 桶，按国家代码首字母着色） */
  function dumpASCII(cols, rows) {
    cols = cols || 60; rows = rows || 30;
    const lines = [];
    for (let r = 0; r < rows; r++) {
      let s = '';
      for (let c = 0; c < cols; c++) {
        const lon = BBOX.lonMin + (c + 0.5) / cols * (BBOX.lonMax - BBOX.lonMin);
        const lat = BBOX.latMax - (r + 0.5) / rows * (BBOX.latMax - BBOX.latMin);
        const p = pickProvince(lon, lat);
        s += p ? p.owner[0] : '.';
      }
      lines.push(String(r).padStart(2, ' ') + ' ' + s);
    }
    return lines.join('\n');
  }

  // 所有陆地环（渲染底图用）
  const landRings = provinces.map((p) => p.poly);

  PSE.MapData = {
    W, H, BBOX, bbox: BBOX,
    provinces, provincesById,
    seaZones: G.seaZones || [],
    straits,
    landRings,
    at, idx, nearestProvinceOfTag, nearestLand,
    pickProvince, isLand, project, unproject, pointInPoly,
    dumpASCII, CODE_TO_TAG, COLONIAL_TAGS, POP_BY_TAG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
