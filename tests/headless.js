/* PSE · 无头回归测试
 * 用法： node tests/headless.js [years]
 * 验证：地图连通性 / 世界构建一致性 / 长跑无 NaN / 确定性双跑 hash / 战斗与战争发生 / 性能
 */
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const FILES = ['core.js', 'data-rules.js', 'data-map.js', 'world.js', 'sim.js', 'ai.js', 'systems.js', 'systems2.js', 'save.js'];
require(path.join(__dirname, '..', 'data', 'map-generated.js'));
for (const f of FILES) require(path.join(SRC, f));
const PSE = globalThis.PSE;
const nCountries = Object.keys(PSE.COUNTRIES).length;

let failures = 0, checks = 0;
function ok(cond, msg, extra) {
  checks++;
  if (cond) { console.log('  \x1b[32m✓\x1b[0m ' + msg); }
  else { failures++; console.log('  \x1b[31m✗ ' + msg + (extra !== undefined ? '  → ' + extra : '') + '\x1b[0m'); }
}
function section(t) { console.log('\n\x1b[36m== ' + t + ' ==\x1b[0m'); }

// ============================================================
section('1. 世界地图（真实地理多边形）');
const MD = PSE.MapData;
console.log(MD.dumpASCII(70, 26));
ok(MD.provinces.length > 600, '省份数 > 600（实际 ' + MD.provinces.length + '）');
let noNeighbor = 0;
for (const p of MD.provinces) if (!(p.neighbors || []).length) noNeighbor++;
ok(noNeighbor <= 15, '孤立省份 ≤ 15（北极真岛/中立区等合法孤岛，实际 ' + noNeighbor + '）');
// 回归：生成器未拆反经线（±180）时，俄罗斯地块环会"绕远路"，苏联种子撒到大西洋/加拿大，
// 表现为北极一条红色横带 + 苏联同纬度缺口。判据：全球网格采样不应出现省份互相重叠。
let overlapPts = 0, overlapAt = '';
{
  const inPoly = (poly, x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  const bb = MD.provinces.map((p) => {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const v of p.poly) { if (v[0] < a) a = v[0]; if (v[0] > c) c = v[0]; if (v[1] < b) b = v[1]; if (v[1] > d) d = v[1]; }
    return [a, b, c, d];
  });
  for (let lat = -53; lat <= 77; lat += 3) {
    for (let lon = -178; lon <= 178; lon += 3) {
      let n = 0;
      for (let i = 0; i < MD.provinces.length; i++) {
        const q = bb[i];
        if (lon < q[0] || lon > q[2] || lat < q[1] || lat > q[3]) continue;
        if (inPoly(MD.provinces[i].poly, lon, lat)) n++;
      }
      if (n > 1) { overlapPts++; if (!overlapAt) overlapAt = lon + ',' + lat; }
    }
  }
}
ok(overlapPts === 0, '网格采样无重叠省份（反经线拆分回归，实际 ' + overlapPts + ' 点）', overlapAt);
let seamRing = 0;
for (const p of MD.provinces) {
  for (let i = 0; i < p.poly.length; i++) {
    const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length];
    if (Math.abs(a[0] - b[0]) > 180) { seamRing++; break; }
  }
}
ok(seamRing === 0, '省份环无 ±180 接缝边（实际 ' + seamRing + ' 个省）');
const tagCount = {};
for (const p of MD.provinces) tagCount[p.owner] = (tagCount[p.owner] || 0) + 1;
let missingCountry = null;
for (const t in PSE.COUNTRIES) {
  if (t === 'NEU') continue;            // 未定领地是占位国家，允许无省份
  if (!tagCount[t]) missingCountry = t;
}
ok(missingCountry === null, (nCountries - 1) + ' 个实体国家都有领土', missingCountry);
ok(MD.straits.length > 20, '跨海通道 > 20（实际 ' + MD.straits.length + '）');
ok(MD.seaZones.length >= 20, '海区 ≥ 20（实际 ' + MD.seaZones.length + '）');
const cities = MD.provinces.filter((p) => p.vp > 0);
ok(cities.length >= 100, '城市（胜利点）≥ 100（实际 ' + cities.length + '）');
const ports = MD.provinces.filter((p) => p.isPort).length;
ok(ports >= 50, '港口 ≥ 50（实际 ' + ports + '）');
ok(MD.provinces.filter((p) => Object.values(p.resource).some((v) => v > 0)).length >= 20, '资源点 ≥ 20');
// 真实投影与点选（关键：柏林/华盛顿/北京应落在正确国家）
const picks = [['柏林', 13.4, 52.52, 'GER'], ['巴黎', 2.35, 48.86, 'FRA'], ['莫斯科', 37.6, 55.75, 'SOV'],
  ['华盛顿', -77.04, 38.91, 'USA'], ['东京', 139.69, 35.69, 'JAP'], ['北京', 116.41, 39.9, 'CHI'],
  ['开罗', 31.24, 30.04, 'ENG'], ['悉尼', 151.21, -33.87, 'AUS'], ['里约热内卢', -43.17, -22.91, 'BRA'],
  ['伦敦', -0.13, 51.5, 'ENG']];
let pickBad = 0;
for (const [name, lon, lat, tag] of picks) {
  const p = MD.pickProvince(lon, lat);
  if (!p || p.owner !== tag) { pickBad++; console.log('     ✗ ' + name + ' → ' + (p ? p.name + '(' + p.owner + ')' : '海面') + '（期望 ' + tag + '）'); }
}
ok(pickBad === 0, '十个真实坐标点选全部命中正确国家', pickBad);
ok(!MD.pickProvince(-30, 45) && !MD.pickProvince(-150, 20), '大洋中心点选返回海面');

// ============================================================
section('2. 世界构建');
function mkWorld(playerTag) {
  return PSE.World.create({ playerTag: playerTag || 'GER', seed: 19360101 });
}
let w = mkWorld();
ok(Object.keys(w.countries).length === nCountries, '国家数 = ' + nCountries + '（实际 ' + Object.keys(w.countries).length + '）');
ok(w.divisions.length > 200, '初始师团 > 200（实际 ' + w.divisions.length + '）');
// 师团命名：名字里带兵种（便于「按名字组合」），且全局唯一（否则无法逐个点名拆分堆叠）
const divNames = w.divisions.map((d) => d.name);
ok(divNames.every((n) => n && /师$/.test(n)), '师团名字非空且以兵种结尾（如 德国·第3装甲师）',
  divNames.find((n) => !n || !/师$/.test(n)));
ok(new Set(divNames).size === divNames.length, '师团名字全局唯一（实际 ' + new Set(divNames).size + '/' + divNames.length + '）');
ok(w.divisions.some((d) => /装甲师$|摩托化师$|骑兵师$/.test(d.name)), '兵力构成里有非步兵师（命名区分兵种）', '');
let facMismatch = 0;
for (const t in w.countries) {
  const c = w.countries[t];
  const built = { civ: 0, mil: 0, dock: 0 };
  for (const p of w.provinces) if (p.owner === t) {
    built.civ += p.buildings.civ || 0; built.mil += p.buildings.mil || 0; built.dock += p.buildings.dock || 0;
  }
  if (built.civ !== c.factories.civ || built.mil !== c.factories.mil || built.dock !== c.factories.dock) {
    facMismatch++;
    if (facMismatch <= 3) console.log('    [' + t + '] 国=(' + c.factories.civ + ',' + c.factories.mil + ',' + c.factories.dock + ') 省=(' + built.civ + ',' + built.mil + ',' + built.dock + ')');
  }
}
ok(facMismatch === 0, '工厂数 = 省份建筑之和', facMismatch + ' 国不符');
const ger = w.countries.GER;
ok(ger.capital >= 0 && w.provinces.find((p) => p.id === ger.capital).isCapital, '德国首都有标记');
ok(ger.manpower > 300 && ger.manpower < 3000, '德国人力池合理（千人）：' + Math.round(ger.manpower));
ok(ger.population > 50 && ger.population < 90, '德国人口合理（百万）：' + ger.population);
ok(ger.factories.civ === 24 && ger.factories.mil === 8, '德国工厂数正确');
ok(ger.production.length >= 3, '德国生产线 ≥ 3（实际 ' + ger.production.length + '）');
ok(ger.research.length >= 3, '德国科研槽 ≥ 3（实际 ' + ger.research.length + '）');
const sov = w.countries.SOV;
ok(sov.divisions.length >= 50, '苏联初始师团 ≥ 50（实际 ' + sov.divisions.length + '）');

// 模板计算
const st = PSE.computeTemplate('inf_9_1');
ok(st.width > 15 && st.width < 30, '步兵师宽度合理：' + st.width);
ok(st.soft > 50 && st.def > 80, '步兵师软攻/防御合理：' + Math.round(st.soft) + '/' + Math.round(st.def));
const armor = PSE.computeTemplate('armor');
ok(armor.hard > st.hard * 3, '装甲师硬攻远高于步兵师：' + Math.round(armor.hard) + ' vs ' + Math.round(st.hard));

// ============================================================
section('3. 长跑（AI 全线托管）');
const years = parseFloat(process.argv[2] || '5');
const hours = Math.round(years * 365.25 * 24);
function runWorld(w, hours) {
  const t0 = Date.now();
  for (let i = 0; i < hours; i++) {
    PSE.Sim.tickHour(w);
    if (w.gameOver) break;
  }
  return Date.now() - t0;
}
let ms = runWorld(w, hours);
console.log('  运行 ' + hours + ' 小时（' + years + ' 年）耗时 ' + ms + 'ms  →  ' + (hours / (ms / 1000)).toFixed(0) + ' 游戏小时/秒');
ok(ms < 60000, '性能：' + years + ' 年 < 60 秒', ms + 'ms');

// NaN 检查
function scanNaN(o, pathStr, out, depth) {
  if (out.length > 8 || depth > 6) return;
  if (typeof o === 'number') { if (!isFinite(o)) out.push(pathStr + ' = ' + o); return; }
  if (!o || typeof o !== 'object') return;
  for (const k in o) scanNaN(o[k], pathStr + '.' + k, out, depth + 1);
}
const nan = [];
scanNaN(w, 'w', nan, 0);
ok(nan.length === 0, '无 NaN/Infinity', nan.join(', '));

const time = PSE.Time.decompose(w.hour);
console.log('  当前时间：' + PSE.Time.format(w.hour) + '　紧张度=' + w.tension.toFixed(1) + '　战争数=' + w.wars.length + '　累计战斗=' + (w.stats.battles || 0));
ok(w.stats.battles > 0, '发生过战斗（' + w.stats.battles + ' 次）');
ok(w.wars.length > 0 || w.stats.battles > 0, '发生过宣战或战斗（战争数 ' + w.wars.length + '）');
const alive = Object.keys(w.countries).filter((t) => !w.countries[t].capitulated);
console.log('  存活国家 ' + alive.length + '/' + nCountries + (alive.length < nCountries ? '（有国家被吞并/投降）' : ''));
const anyResearched = Object.keys(w.countries).filter((t) => w.countries[t].researched.length > 0);
ok(anyResearched.length === nCountries, '所有国家都在科研（' + anyResearched.length + '/' + nCountries + '）');
const focusDone = Object.keys(w.countries).reduce((s, t) => s + w.countries[t].focusDone.length, 0);
ok(focusDone > 50, '国策完成总数 > 50（实际 ' + focusDone + '）');
const supplySpread = w.provinces.filter((p) => p.supply > 0.9).length;
ok(supplySpread > 20, '有充足补给的省份 > 20（实际 ' + supplySpread + '）');

// 检查几个国家的经济运转
for (const tag of ['GER', 'SOV', 'ENG']) {
  const c = w.countries[tag];
  const eq = Object.keys(c.stockpile).reduce((s, k) => s + (c.stockpile[k] || 0), 0);
  console.log('  [' + tag + '] 民工=' + c.factories.civ + ' 军工=' + c.factories.mil + ' 师=' + c.divisions.length +
    ' 装备总库存=' + Math.round(eq) + ' 政治点=' + Math.round(c.pp) + ' 科技=' + c.researched.length +
    ' 国策=' + c.focusDone.length + ' 人力=' + Math.round(c.manpower) + ' 稳定=' + c.stability.toFixed(2));
  ok(isFinite(c.pp) && c.pp >= 0, tag + ' 政治点正常');
  ok(c.factories.civ >= PSE.COUNTRIES[tag].factories.civ, tag + ' 民工未减少（建设生效）');
  ok(eq > 0, tag + ' 装备库存在增长');
}
if (w.gameOver) console.log('  游戏结束：' + JSON.stringify(w.gameOver));

// ============================================================
section('4. 确定性（同种子双跑）');
const w2 = mkWorld();
const h2 = Math.min(hours, 24 * 400); // 400 天足够验证
const h1 = h2;
const wa = mkWorld(); runWorld(wa, h1);
const wb = mkWorld(); runWorld(wb, h1);
const ha = PSE.util2.stateHash(wa), hb = PSE.util2.stateHash(wb);
ok(ha === hb, '双跑 stateHash 一致 (' + ha + ' vs ' + hb + ')');
console.log('  stateHash@' + h1 + 'h = ' + ha);

// 存档往返
section('5. 存档往返');
const w3 = mkWorld();
runWorld(w3, 24 * 120);
const before = PSE.util2.stateHash(w3);
const text = PSE.Save.exportText(w3);
const wLoad = PSE.Save.importText(text);
ok(!!wLoad, '存档可导入');
if (wLoad) {
  PSE.Sim.rebuildDivIndex(wLoad);
  const after = PSE.util2.stateHash(wLoad);
  ok(before === after, '存档往返后 stateHash 一致 (' + before + ' vs ' + after + ')');
  const n0 = w3.divisions.length, n1 = wLoad.divisions.length;
  ok(n0 === n1, '师团数一致（' + n0 + ' vs ' + n1 + '）');
  // 继续跑 30 天，不应崩溃
  runWorld(wLoad, 24 * 30);
  ok(true, '读档后继续运行 30 天无异常');
}

// ============================================================
section('6. 战斗常量校准（单场战斗模拟）');
(function calibrate() {
  const cw = mkWorld();
  // 造一个隔离战场：把波兰一个省与德国一个省单独接战
  const ger = cw.countries.GER, pol = cw.countries.POL;
  for (const d of cw.divisions.slice()) {
    if (d.tag !== 'GER' && d.tag !== 'POL') { PSE.World.removeDivision(cw, d); }
  }
  for (const t of Object.keys(cw.countries)) {
    if (t !== 'GER' && t !== 'POL') { cw.countries[t].divisions = []; cw.countries[t].capitulated = true; }
  }
  // 双方各留 6 个步兵师，德军进攻
  const gerProv = cw.provinces.find((p) => p.owner === 'GER' && p.neighbors.some((n) => cw.provinces[n].owner === 'POL'));
  ok(!!gerProv, '找到德波边境省（' + (gerProv && gerProv.name) + '）');
  if (!gerProv) return;
  const polProvId = gerProv.neighbors.find((n) => cw.provinces[n].owner === 'POL');
  const polProv = cw.provinces[polProvId];
  console.log('  战场：' + gerProv.name + ' → ' + polProv.name + '（' + polProv.terrain + '）');
  // 只保留 3 个德国师（进攻方）与 1 个波兰师（防守方）——公平的平原遭遇战
  const keepGer = cw.divisions.filter((d) => d.tag === 'GER').slice(0, 3).map((d) => d.id);
  const keepPol = cw.divisions.filter((d) => d.tag === 'POL').slice(0, 1).map((d) => d.id);
  for (const d of cw.divisions.slice()) {
    if (d.tag === 'GER' && keepGer.indexOf(d.id) < 0) PSE.World.removeDivision(cw, d);
    if (d.tag === 'POL' && keepPol.indexOf(d.id) < 0) PSE.World.removeDivision(cw, d);
  }
  cw.countries.GER.divisions = keepGer;
  cw.countries.POL.divisions = keepPol;
  // 清理双方其它单位
  for (const d of cw.divisions.slice()) {
    if (d.tag === 'GER') d.loc = gerProv.id; else if (d.tag === 'POL') d.loc = polProv.id;
  }
  // 保证满员满组织
  for (const d of cw.divisions) { d.org = d.orgMax; d.hp = d.hpMax; d.str = 1; d.supply = 1; }
  cw.countries.GER.stockpile.infantry_equipment_1 = 1e6;
  cw.countries.POL.stockpile.infantry_equipment_1 = 1e6;
  PSE.Diplo.declareWar(cw, 'GER', 'POL', { silent: true });
  const gerDivs = cw.divisions.filter((d) => d.tag === 'GER');
  const polDivs = cw.divisions.filter((d) => d.tag === 'POL');
  console.log('  进攻方 ' + gerDivs.length + ' 个师（' + Math.round(gerDivs[0].orgMax) + ' org, ' +
    Math.round(gerDivs[0].template.soft) + ' 软攻） vs 防守方 ' + polDivs.length + ' 个师（' +
    Math.round(polDivs[0].template.def) + ' 防御）');
  const orderCount = PSE.Sim.orderMove(cw, gerDivs, polProvId);
  ok(orderCount > 0, '进攻命令下达（' + orderCount + ' 个师）');
  let battleStartH = -1, endH = -1, winner = null;
  for (let i = 0; i < 24 * 30; i++) {
    PSE.Sim.tickHour(cw);
    if (battleStartH < 0 && cw.battles.length) battleStartH = cw.hour;
    if (battleStartH > 0 && !cw.battles.length) { endH = cw.hour; winner = cw.provinces[polProvId].controller; break; }
  }
  const dur = endH - battleStartH;
  console.log('  战斗开始于 ' + battleStartH + 'h，结束于 ' + endH + 'h，历时 ' + dur + ' 小时，' + polProv.name + ' 控制方 = ' + winner);
  ok(battleStartH > 0 && endH > 0, '战斗能开始并结束');
  ok(dur >= 6 && dur <= 240, '战斗时长在 6~240 小时之间（实际 ' + dur + '）', dur);
  ok(winner === 'GER', '3 个德军师 vs 1 个波军师：进攻方攻占平原省（实际 ' + winner + '）');
  const survivors = cw.divisions.filter((d) => d.tag === 'GER').length;
  ok(survivors >= 1, '进攻方未全灭（' + survivors + '/3）');
})();

// ============================================================
section('7. 扩展系统（装备设计 / 军贸 / 海军 / 空军 / 谍报 / 决议 / 将领 / 控制台 / 剧本）');
(function extensions() {
  const xw = mkWorld('GER');
  const c = xw.countries.GER;
  c.pp = 5000; c.credits = 100000; c.armyXp = 5000;
  // 装备设计器
  const def = PSE.Cmd.designEquipment(xw, c, { role: 'tank', chassis: 'heavy', gun: 'heavy', armor: 'heavy', engine: 'diesel', name: '虎式原型' });
  ok(!!def && def.cost > 10, '装备设计器产出坦克定义（成本 ' + (def && def.cost) + '）', def && def.id);
  ok(def.stats.hard > 30 && def.stats.armor > 40, '重坦配置硬攻/装甲高：' + (def && def.stats.hard) + '/' + (def && def.stats.armor));
  const airDef = PSE.Cmd.designEquipment(xw, c, { role: 'air', airframe: 'interceptor', gun: 'medium', engine: 'highpower', name: '自制截击机' });
  ok(!!airDef && airDef.type === 'air', '装备设计器产出飞机定义');
  ok(!!c.equipOverride.mar || !!c.equipOverride.har, '定型后替换了对应营的装备型号');
  // 军贸
  PSE.EquipTrade.list(xw, c, 'infantry_equipment_1', 5000, 1);
  const offer = (xw.market || [])[0];
  ok(!!offer, '挂牌出售生成市场报价');
  const buyer = xw.countries.ITA;
  buyer.credits = 100000;
  const bought = PSE.EquipTrade.buy(xw, buyer, offer.id, 1000);
  ok(bought, '他国可购买装备（信用点结算）');
  ok((buyer.stockpile.infantry_equipment_1 || 0) > 0, '买家库存增加');
  PSE.EquipTrade.lendLease(xw, c, xw.countries.ITA, 'infantry_equipment_1', 50);
  ok((c.lendLease || []).length > 0, '租借协议登记成功');
  // 决策与民族精神
  const decOk = PSE.Decisions.start(xw, c, 'DEC_war_bonds');
  ok(decOk, '决议可启动');
  ok(PSE.Decisions.addSpirit(xw, c, 'SPI_war_economy'), '民族精神可添加');
  // 将领与集团军
  PSE.Army.ensure(xw, c);
  PSE.Army.assign(xw, c);
  ok((c.armies || []).length > 0 && (c.generals || []).length > 0, '集团军与将领自动编组（' + (c.armies || []).length + ' 个军）');
  const before = c.generals[0].level;
  for (let i = 0; i < 12; i++) PSE.Army.xp(xw, c, c.armies[0].id, 100);
  ok(c.generals[0].level > before, '将领经验升级（Lv' + before + ' → Lv' + c.generals[0].level + '）');
  ok(c.generals[0].traits.length > 1, '升级获得新特质');
  // 学说
  PSE.Doctrine.ensure(c);
  const docOk = PSE.Doctrine.buy(xw, c, 'DOC_mob_1');
  ok(docOk, '学说节点可购买（消耗陆军经验）');
  ok(!PSE.Doctrine.buy(xw, c, 'DOC_fire_1') || c.grandDoctrine === 'firepower', '大战略学说互斥生效');
  // 海军
  PSE.Navy.reorganize(xw, c);
  ok(PSE.Navy.power(c) > 0, '舰船战力 > 0（' + Math.round(PSE.Navy.power(c)) + '）');
  PSE.Navy.daily(xw);
  ok(true, '海战结算无异常');
  // 空军任务
  ok(PSE.AIR_MISSIONS.length >= 6, '空军任务 ≥ 6 种');
  c.airWings[0].mission = 'strategic_bombing';
  PSE.Air.daily(xw);
  ok(true, '空军每日结算无异常');
  // 谍报
  ok(PSE.Spy.build(xw, c), '情报局可成立');
  ok(PSE.Spy.recruit(xw, c), '特工可招募');
  const sendR = PSE.Spy.send(xw, c, 'FRA', 'blueprint');
  ok(sendR.ok, '间谍任务可派出：' + sendR.msg);
  for (let i = 0; i < 200; i++) PSE.Spy.daily(xw);
  ok(true, '间谍每日推进无异常');
  // 外交行动
  ok(PSE.Cmd.improveRelations(xw, 'ITA').ok, '改善关系可用');
  ok(PSE.Cmd.guarantee(xw, 'HUN').ok, '保证独立可用');
  c.faction = 'axis'; xw.factions.axis = ['GER'];
  xw.countries.ITA.relations.GER = 60;
  const inv = PSE.Cmd.inviteToFaction(xw, 'ITA');
  ok(inv.ok, '邀请入盟可用：' + inv.msg);
  // 傀儡与自治
  xw.countries.AUT.capitulated = true;
  for (const p of xw.provinces) if (p.owner === 'AUT') p.controller = 'GER';
  const pup = PSE.Cmd.createPuppet(xw, 'AUT');
  ok(pup.ok, '可建立傀儡国：' + pup.msg);
  ok(PSE.Cmd.setAutonomy(xw, 'AUT', 'dominion'), '可调整傀儡自制度');
  // 和平会议
  const war = PSE.Diplo.declareWar(xw, 'GER', 'POL', {});
  xw.playerTag = 'GER';
  PSE.Peace.open(xw, war, 'POL');
  ok(!!xw.peaceConference || xw.countries.POL.capitulated, '和平会议可开启（或已直接吞并）');
  if (xw.peaceConference) { PSE.Peace.apply(xw, 'puppet'); ok(xw.countries.POL.puppetOf === 'GER', '傀儡处置生效'); }
  // 控制台
  const con = PSE.Console.run(xw, 'pp 500');
  ok(con.ok, '控制台 pp 指令：' + con.msg);
  ok(PSE.Console.run(xw, 'research_all').ok, '控制台 research_all 指令');
  ok(PSE.Console.run(xw, 'teleport 柏林').ok, '控制台 teleport 指令');
  ok(PSE.Console.run(xw, 'switch SOV').ok && xw.playerTag === 'SOV', '控制台 switch 切换国家');
  ok(!PSE.Console.run(xw, 'bogus').ok, '未知命令被拒绝');
  xw.ironman = true;
  ok(!PSE.Console.run(xw, 'pp 100').ok, '铁人模式禁用控制台');
  xw.ironman = false;
  // 核武器
  xw.playerTag = 'GER';
  xw.countries.GER.nukes = 1;
  const cap = xw.provinces[xw.countries.GER.capital];
  const nukeR = PSE.Cmd.nuke(xw, cap.id);
  ok(nukeR.ok && (xw.nukeMarks || []).length > 0, '核打击可用并留下标记');
  // 燃料
  PSE.Fuel.daily(xw);
  ok(xw.countries.GER.fuel !== undefined, '燃料系统结算');
  // MOD 加载
  const n = PSE.Mod.apply(xw, { decisions: [{ id: 'MOD_dec', name: 'MOD 决议', cost: 1, days: 1, cooldown: 1, effects: [] }] });
  ok(n > 0, 'MOD 数据可加载（' + n + ' 项）');
})();

// ============================================================
section('8. 剧本与难度');
(function scenarios() {
  const w39 = PSE.World.create({ playerTag: 'GER', seed: 1, scenario: 's1939' });
  const t = PSE.Time.decompose(w39.hour);
  ok(t.year === 1939, '1939 剧本起始年份正确（' + t.year + '）');
  ok(w39.countries.AUT.capitulated && w39.countries.CZE.capitulated, '1939 剧本中奥地利与捷克已被吞并');
  ok(w39.countries.GER.pacts.indexOf('SOV') >= 0, '1939 剧本苏德互不侵犯已生效');
  const wVet = PSE.World.create({ playerTag: 'GER', seed: 1, difficulty: 'veteran' });
  const wRec = PSE.World.create({ playerTag: 'GER', seed: 1, difficulty: 'recruit' });
  ok((wVet.countries.SOV.mods.milOutput || 0) > (wRec.countries.SOV.mods.milOutput || 0),
    '难度影响 AI 工业加成（老兵 > 征召）');
  ok(wVet.difficulty === 'veteran' && wRec.difficulty === 'recruit', '难度标记写入世界状态');
})();

// ============================================================
console.log('\n' + (failures === 0 ? '\x1b[32m全部通过\x1b[0m' : '\x1b[31m失败 ' + failures + ' 项\x1b[0m') + '（检查 ' + checks + ' 项）');
process.exit(failures === 0 ? 0 : 1);
