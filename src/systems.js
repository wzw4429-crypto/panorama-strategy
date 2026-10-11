/* PSE · 扩展系统 (systems.js)
 * 实现此前缺失的功能：装备自定义设计、装备贸易与租借、海军舰队与海战、
 * 空军任务与战略轰炸、间谍情报局、傀儡与流亡政府、燃料、核武器、两栖登陆与伞降。
 * 全部走 PSE.Cmd / PSE.Navy / PSE.Air / PSE.Spy 接口，纯数据、可序列化。
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});
  const U = PSE.U, BAL = PSE.BAL;

  // ============================================================
  // 1. 装备自定义设计（坦克/飞机/舰船 的底盘-火炮-装甲-引擎组合）
  // ============================================================
  PSE.EQ_PARTS = {
    chassis: {
      light: { name: '轻型底盘', cost: 4.0, hp: 22, speed: 10, base: { soft: 6, hard: 8, def: 5, brk: 14 } },
      medium: { name: '中型底盘', cost: 9.0, hp: 24, speed: 9, base: { soft: 9, hard: 14, def: 6, brk: 22 } },
      heavy: { name: '重型底盘', cost: 16.0, hp: 28, speed: 7, base: { soft: 11, hard: 20, def: 8, brk: 26 } },
    },
    gun: {
      mg: { name: '机枪', cost: 0.8, soft: 4, hard: 2, pierce: 4 },
      light: { name: '小口径炮', cost: 1.6, soft: 8, hard: 8, pierce: 12 },
      medium: { name: '中口径炮', cost: 3.0, soft: 12, hard: 16, pierce: 22 },
      heavy: { name: '大口径炮', cost: 5.5, soft: 16, hard: 26, pierce: 34 },
      howitzer: { name: '榴弹炮', cost: 4.0, soft: 22, hard: 8, pierce: 12 },
    },
    armor: {
      none: { name: '无附加装甲', cost: 0, armor: 6, def: 0, speedMul: 1.05 },
      light: { name: '轻型装甲', cost: 1.2, armor: 18, def: 2, speedMul: 1.0 },
      medium: { name: '中型装甲', cost: 2.6, armor: 34, def: 4, speedMul: 0.95 },
      heavy: { name: '重型装甲', cost: 4.5, armor: 52, def: 6, speedMul: 0.88 },
    },
    engine: {
      petrol: { name: '汽油机', cost: 1.0, speedMul: 1.15, fuelUse: 1.0 },
      diesel: { name: '柴油机', cost: 1.8, speedMul: 1.0, fuelUse: 0.75 },
      highpower: { name: '大功率引擎', cost: 3.2, speedMul: 1.3, fuelUse: 1.35 },
    },
    airframe: {
      interceptor: { name: '截击机机架', cost: 10, hp: 12, speed: 12, base: { soft: 2, hard: 3, def: 6, brk: 4 } },
      multirole: { name: '多用途机架', cost: 14, hp: 14, speed: 10, base: { soft: 6, hard: 5, def: 5, brk: 6 } },
      ground_attack: { name: '对地攻击机架', cost: 13, hp: 15, speed: 8, base: { soft: 12, hard: 6, def: 5, brk: 5 } },
      bomber: { name: '轰炸机机架', cost: 20, hp: 20, speed: 8, base: { soft: 18, hard: 6, def: 4, brk: 3 } },
    },
  };

  /** 由部件组合推导装备定义（供设计器与 UI 共用） */
  PSE.deriveEquipment = function (spec) {
    const P = PSE.EQ_PARTS;
    const role = spec.role || 'tank';
    if (role === 'air') {
      const f = P.airframe[spec.airframe] || P.airframe.multirole;
      const g = P.gun[spec.gun] || P.gun.light;
      const e = P.engine[spec.engine] || P.engine.petrol;
      const cost = Math.round((f.cost + g.cost * 0.6 + e.cost) * 100) / 100;
      return {
        id: spec.id, name: spec.name || ('自定义机 ' + spec.id), type: 'air', cost, year: spec.year || 1939,
        res: { aluminum: Math.round(f.cost * 0.7), rubber: Math.round(f.cost * 0.18) },
        stats: {
          soft: f.base.soft + g.soft, hard: f.base.hard + g.hard, def: f.base.def,
          brk: f.base.brk, speed: Math.round(f.speed * e.speedMul), hp: f.hp,
          pierce: g.pierce || 6, armor: 0,
        },
      };
    }
    const ch = P.chassis[spec.chassis] || P.chassis.medium;
    const g = P.gun[spec.gun] || P.gun.light;
    const ar = P.armor[spec.armor] || P.armor.light;
    const en = P.engine[spec.engine] || P.engine.petrol;
    const cost = Math.round((ch.cost + g.cost + ar.cost + en.cost) * 100) / 100;
    return {
      id: spec.id, name: spec.name || ('自定义坦克 ' + spec.id), type: 'tank', cost, year: spec.year || 1939,
      res: { steel: Math.round(cost * 1.4), tungsten: Math.round(cost * 0.18), rubber: Math.max(1, Math.round(cost * 0.08)) },
      stats: {
        soft: ch.base.soft + g.soft, hard: ch.base.hard + g.hard, def: ch.base.def + ar.def,
        brk: ch.base.brk + Math.round(g.hard * 0.5), speed: Math.round(ch.speed * en.speedMul),
        hp: ch.hp, pierce: g.pierce, armor: ar.armor,
      },
    };
  };

  /** 设计装备：写入 PSE.EQUIPMENT 与 world.customEquipment，并把该国对应营的装备替换为新型号 */
  PSE.Cmd.designEquipment = function (w, c, spec) {
    const c2 = c || w.countries[w.playerTag];
    if (!c2) return null;
    w.nextId.equip = (w.nextId.equip || 1) + 1;
    const id = spec.id || ('custom_' + (spec.role === 'air' ? 'air' : 'tank') + '_' + w.nextId.equip);
    const def = PSE.deriveEquipment(Object.assign({}, spec, { id }));
    PSE.EQUIPMENT[id] = def;
    w.customEquipment = w.customEquipment || {};
    w.customEquipment[id] = def;
    c2.equipOverride = c2.equipOverride || {};
    if (spec.role === 'air') {
      // 战斗机/近距支援：替换对应联队使用的装备型号（影响生产与补充成本）
      c2.equipOverride['air_' + (spec.airframe === 'ground_attack' ? 'cas' : 'fighter')] = id;
    } else {
      const map = { light: 'lar', medium: 'mar', heavy: 'har' };
      c2.equipOverride[map[spec.chassis] || 'mar'] = id;
    }
    PSE.log(w, c2.name + ' 完成装备设计：' + def.name + '（成本 ' + def.cost + '）', 'eco', c2.tag);
    return def;
  };

  // ============================================================
  // 2. 装备贸易 / 租借
  // ============================================================
  const Trade = (PSE.EquipTrade = {});

  Trade.list = function (w, c, equipId, amount, price) {
    w.market = w.market || [];
    const offer = {
      id: (w.nextId.offer = (w.nextId.offer || 0) + 1),
      seller: c.tag, equipId, amount,
      price: Math.max(0.1, price || 1),      // 每单位装备的信用点价格
      listed: w.hour,
    };
    w.market.push(offer);
    return offer;
  };

  Trade.buy = function (w, buyer, offerId, amount) {
    const offer = (w.market || []).find((o) => o.id === offerId);
    if (!offer) return false;
    const seller = w.countries[offer.seller];
    if (!seller || seller.capitulated) return false;
    if (PSE.World.areAtWar(w, buyer.tag, seller.tag)) return false;
    const n = Math.min(amount || offer.amount, offer.amount, seller.stockpile[offer.equipId] || 0);
    if (n <= 0) return false;
    const cost = n * offer.price;
    if (buyer.credits < cost) return false;
    buyer.credits -= cost;
    seller.credits += cost;
    seller.stockpile[offer.equipId] -= n;
    buyer.stockpile[offer.equipId] = (buyer.stockpile[offer.equipId] || 0) + n;
    offer.amount -= n;
    if (offer.amount <= 0.01) w.market = w.market.filter((o) => o.id !== offerId);
    const rel = 2;
    buyer.relations[seller.tag] = U.clamp((buyer.relations[seller.tag] || 0) + rel, -200, 200);
    seller.relations[buyer.tag] = U.clamp((seller.relations[buyer.tag] || 0) + rel, -200, 200);
    PSE.log(w, buyer.name + ' 从 ' + seller.name + ' 购入 ' + n.toFixed(0) + ' 件' + PSE.EQUIP_NAME(offer.equipId), 'eco', buyer.tag);
    return true;
  };

  Trade.lendLease = function (w, from, to, equipId, perDay) {
    from.lendLease = from.lendLease || [];
    const existing = from.lendLease.find((l) => l.to === to.tag && l.equipId === equipId);
    if (existing) { existing.perDay = perDay; return true; }
    from.lendLease.push({ to: to.tag, equipId, perDay });
    PSE.log(w, from.name + ' 向 ' + to.name + ' 提供' + PSE.EQUIP_NAME(equipId) + '租借（每日 ' + perDay + '）', 'diplo', from.tag);
    return true;
  };

  /** 每日：执行租借、推进市场时效、AI 买卖 */
  Trade.daily = function (w) {
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated) continue;
      // 租借输出
      for (const ll of (c.lendLease || [])) {
        const to = w.countries[ll.to];
        if (!to || to.capitulated) continue;
        const avail = c.stockpile[ll.equipId] || 0;
        const n = Math.min(ll.perDay, avail);
        if (n <= 0) continue;
        c.stockpile[ll.equipId] -= n;
        to.stockpile[ll.equipId] = (to.stockpile[ll.equipId] || 0) + n;
      }
      // 信用点积累（工业信用）
      c.credits += c.factories.mil * 0.5 + c.factories.civ * 0.2;
    }
    // 市场时效：180 天未成交下架
    w.market = (w.market || []).filter((o) => w.hour - o.listed < 180 * 24 && o.amount > 0.01);
    // AI 行为
    for (const t in w.countries) {
      const c = w.countries[t];
      if (t === w.playerTag || c.capitulated) continue;
      if (w.hour % (24 * 30) !== 0) continue;
      // 卖家：库存过剩则挂单
      const surplus = ['infantry_equipment_1', 'artillery_1', 'light_tank_1'];
      for (const eq of surplus) {
        const stock = c.stockpile[eq] || 0;
        if (stock > 20000 && !(w.market || []).some((o) => o.seller === t && o.equipId === eq)) {
          Trade.list(w, c, eq, Math.floor(stock * 0.2), eq === 'infantry_equipment_1' ? 1 : 2.5);
        }
      }
      // 买家：缺装备且有信用点则购买
      if (c.credits > 500) {
        const offers = (w.market || []).filter((o) => o.seller !== t && !PSE.World.areAtWar(w, t, o.seller));
        for (const o of offers) {
          const mine = c.stockpile[o.equipId] || 0;
          if (mine > 5000) continue;
          if (Trade.buy(w, c, o.id, Math.floor(c.credits / o.price * 0.5))) break;
        }
      }
      // 盟友租借
      if (c.isMajor && PSE.World.inAnyWar(w, c.tag)) {
        for (const a of PSE.World.alliesOf(w, c.tag)) {
          const ally = w.countries[a];
          if (!ally) continue;
          if ((ally.stockpile.infantry_equipment_1 || 0) < 2000 && (c.stockpile.infantry_equipment_1 || 0) > 8000) {
            Trade.lendLease(w, c, ally, 'infantry_equipment_1', 60);
          }
        }
      }
    }
  };

  // ============================================================
  // 3. 海军：舰队、海区、海战、封锁、登陆
  // ============================================================
  const Navy = (PSE.Navy = {});
  const SHIP_TYPES = { destroyer: { w: 1, name: '驱逐舰' }, cruiser: { w: 3, name: '巡洋舰' }, battleship: { w: 8, name: '战列舰' }, carrier: { w: 8, name: '航母' }, submarine: { w: 1.2, name: '潜艇' }, convoy: { w: 0.2, name: '运输船' } };
  PSE.SHIP_TYPES = SHIP_TYPES;

  Navy.power = function (c) {
    let p = 0;
    for (const k in SHIP_TYPES) p += (c.stockpile[k] || 0) * SHIP_TYPES[k].w;
    return p;
  };

  /** 把库存舰船编成舰队（按海区巡逻），每日由 AI/玩家调用 */
  Navy.reorganize = function (w, c) {
    c.fleets = c.fleets || [];
    const total = Navy.power(c);
    if (total <= 0) { c.fleets = []; return; }
    // 目标：把 60% 兵力派到"最重要的海区"（与敌国接壤的己方沿海省所属海区）
    const zones = {};
    for (const p of w.provinces) {
      if (p.controller !== c.tag || !p.seaZones) continue;
      for (const z of p.seaZones) zones[z] = (zones[z] || 0) + 1;
    }
    const enemies = PSE.World.enemiesOf(w, c.tag);
    const enemyZones = {};
    for (const e of enemies) {
      const ec = w.countries[e];
      if (!ec) continue;
      for (const p of w.provinces) {
        if (p.controller !== e) continue;
        for (const z of (p.seaZones || [])) enemyZones[z] = (enemyZones[z] || 0) + 1;
      }
    }
    const priority = Object.keys(enemyZones).length ? Object.keys(enemyZones).map(Number) : Object.keys(zones).map(Number);
    if (!priority.length) { c.fleets = []; return; }
    const mainZone = priority.sort((a, b) => (enemyZones[b] || 0) - (enemyZones[a] || 0))[0];
    c.fleets = [{ id: 1, zone: mainZone, ships: Math.round(total * 0.7), mission: enemies.length ? 'patrol' : 'escort' }];
    // 其余兵力在本国主要海区护航
    const homeZone = Object.keys(zones).map(Number).sort((a, b) => zones[b] - zones[a])[0];
    if (homeZone !== undefined && homeZone !== mainZone) {
      c.fleets.push({ id: 2, zone: homeZone, ships: Math.round(total * 0.3), mission: 'escort' });
    }
    // 潜艇单独执行破交
    const subs = c.stockpile.submarine || 0;
    if (subs > 5 && enemies.length) {
      c.fleets.push({ id: 3, zone: mainZone, ships: Math.round(subs * 1.2), mission: 'raid', sub: true });
    }
  };

  Navy.seaControl = function (w, zoneId, tag) {
    let mine = 0, foe = 0;
    for (const t in w.countries) {
      const c = w.countries[t];
      if (!c.fleets) continue;
      for (const f of c.fleets) {
        if (f.zone !== zoneId) continue;
        if (t === tag || PSE.World.isAllied(w, t, tag)) mine += f.ships;
        else if (PSE.World.areAtWar(w, t, tag)) foe += f.ships;
      }
    }
    const tot = mine + foe;
    return tot ? mine / tot : (foe ? 0 : 0.5);
  };

  /** 每日海战与破交 */
  Navy.daily = function (w) {
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated) continue;
      if (w.hour % (24 * 7) === 0) Navy.reorganize(w, c);
    }
    // 同海区敌对舰队交战
    const byZone = {};
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated || !c.fleets) continue;
      for (const f of c.fleets) (byZone[f.zone] = byZone[f.zone] || []).push({ t, f });
    }
    const rng = w.rng.fork('naval');
    for (const zid in byZone) {
      const list = byZone[zid];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i], B = list[j];
          if (!PSE.World.areAtWar(w, A.t, B.t)) continue;
          // 交战中：按战力比造成损失
          const ratio = A.f.ships / Math.max(1, A.f.ships + B.f.ships);
          const lossesB = A.f.ships * 0.02 * (0.6 + rng.next01() * 0.8);
          const lossesA = B.f.ships * 0.02 * (0.6 + rng.next01() * 0.8);
          A.f.ships = Math.max(0, A.f.ships - lossesA);
          B.f.ships = Math.max(0, B.f.ships - lossesB);
          const ca = w.countries[A.t], cb = w.countries[B.t];
          const lossA = Navy.shipLosses(ca, lossesA, rng);
          const lossB = Navy.shipLosses(cb, lossesB, rng);
          if (w.hour % (24 * 7) === 0) {
            PSE.log(w, '海战（' + (w.countries[A.t].name) + ' vs ' + (w.countries[B.t].name) + '）：损失 ' +
              (lossA + lossB).toFixed(0) + ' 艘', 'war', A.t);
          }
        }
      }
    }
    // 破交：袭击敌方海区 → 提高对方贸易风险
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated || !c.fleets) continue;
      for (const f of c.fleets) {
        if (f.mission !== 'raid' || f.ships <= 0) continue;
        for (const e of PSE.World.enemiesOf(w, t)) {
          const ec = w.countries[e];
          if (!ec) continue;
          for (const tr of (ec.trades || [])) {
            tr.risk = U.clamp((tr.risk || 0) + 0.03 * Math.min(3, f.ships / 50), 0, 0.9);
          }
        }
      }
    }
    // 贸易风险衰减 + 影响实际进口
    for (const t in w.countries) {
      const c = w.countries[t];
      for (const tr of (c.trades || [])) {
        tr.risk = Math.max(0, (tr.risk || 0) - 0.01);
        if (tr.risk > 0.05) tr.amountNow = tr.amount * (1 - tr.risk);
        else tr.amountNow = tr.amount;
      }
    }
  };

  Navy.shipLosses = function (c, lossPower, rng) {
    let lost = 0;
    const order = ['convoy', 'destroyer', 'submarine', 'cruiser', 'battleship', 'carrier'];
    let remaining = lossPower;
    for (const k of order) {
      if (remaining <= 0) break;
      const have = c.stockpile[k] || 0;
      if (have <= 0) continue;
      const take = Math.min(have, Math.ceil(remaining / SHIP_TYPES[k].w));
      c.stockpile[k] = have - take;
      remaining -= take * SHIP_TYPES[k].w;
      lost += take;
    }
    return lost;
  };

  // ---------- 两栖登陆 / 伞降 ----------
  PSE.Cmd.navalInvasion = function (w, divIds, targetProvId) {
    const c = w.countries[w.playerTag];
    const target = w.provinces[targetProvId];
    if (!c || !target || !target.coastal) return { ok: false, msg: '目标必须是沿海省份' };
    const divs = divIds.map((id) => w.divisions.find((d) => d.id === id)).filter((d) => d && d.tag === c.tag);
    if (!divs.length) return { ok: false, msg: '没有可用的部队' };
    const fromCoastal = divs.filter((d) => w.provinces[d.loc].coastal || w.provinces[d.loc].isPort);
    if (!fromCoastal.length) return { ok: false, msg: '部队必须从沿海省份出发' };
    const zone = (target.seaZones || [])[0];
    const control = Navy.seaControl(w, zone, c.tag);
    const needed = Navy.power(c);
    if (needed < 20) return { ok: false, msg: '海军力量不足（需要至少 20 点舰船战力）' };
    if (control < 0.4) return { ok: false, msg: '该海区制海权不足（' + Math.round(control * 100) + '%）' };
    for (const d of fromCoastal) {
      const risk = 0.25 + (1 - control) * 0.4;
      const rng = w.rng.fork('inv' + d.id + w.hour);
      d.status = 'invading';
      d.invasionTarget = targetProvId;
      d.invasionEta = w.hour + 48 + rng.int(48);
      if (rng.next01() < risk * 0.5) {
        d.hp = Math.max(1, d.hp * 0.7);
        d.org = Math.max(0, d.org * 0.5);
        PSE.log(w, d.name + ' 的登陆船团遭到拦截，损失惨重', 'war', c.tag);
      }
    }
    PSE.log(w, c.name + ' 发起两栖登陆：目标 ' + target.name + '（制海权 ' + Math.round(control * 100) + '%）', 'war', c.tag);
    return { ok: true, msg: '登陆船团已出发（约 2~4 天抵达）' };
  };

  PSE.Cmd.paradrop = function (w, divIds, targetProvId) {
    const c = w.countries[w.playerTag];
    const target = w.provinces[targetProvId];
    if (!c || !target) return { ok: false, msg: '无效目标' };
    const wings = c.airWings.filter((x) => x.type === 'transport' && x.count > 0);
    const hasTransport = wings.length > 0 || (c.stockpile.transport_plane || 0) > 20;
    if (!hasTransport) return { ok: false, msg: '需要运输机（科技：运输机）' };
    const divs = divIds.map((id) => w.divisions.find((d) => d.id === id)).filter((d) => d && d.tag === c.tag);
    if (!divs.length) return { ok: false, msg: '没有可空降的部队' };
    const enemyAir = 0.5;
    const airSup = 1 - enemyAir * 0.4;
    for (const d of divs) {
      d.status = 'paradrop';
      d.invasionTarget = targetProvId;
      d.invasionEta = w.hour + 24;
      d.org = Math.max(0, d.org * (0.6 + airSup * 0.3));
      d.hp = Math.max(1, d.hp * 0.85);
    }
    PSE.log(w, c.name + ' 发起空降作战：目标 ' + target.name, 'war', c.tag);
    return { ok: true, msg: '空降部队已登机（24 小时后落地）' };
  };

  /** 跨海/空降部队抵达结算（每小时由 sim 调用） */
  Navy.tickInsertions = function (w) {
    for (const d of w.divisions) {
      if (d.status !== 'invading' && d.status !== 'paradrop') continue;
      if (w.hour < (d.invasionEta || 0)) continue;
      const target = w.provinces[d.invasionTarget];
      d.status = 'idle';
      d.invasionTarget = null;
      if (!target) continue;
      const wasParadrop = d.paradrop;
      d.loc = target.id;
      d.entrench = 0;
      d.path = [];
      if (d.status !== 'battle') d.status = 'idle';
      PSE.log(w, d.name + ' 已在 ' + target.name + ' 登陆/着陆', 'war', d.tag);
      d.paradrop = false;
    }
  };

  // ============================================================
  // 4. 空军：任务、制空、战略轰炸、对海打击、空运
  // ============================================================
  const Air = (PSE.Air = {});
  PSE.AIR_MISSION_NAME = {
    air_superiority: '争夺制空', cas: '近距支援', interception: '拦截',
    strategic_bombing: '战略轰炸', naval_strike: '对海打击', air_supply: '空中补给',
    transport: '运输',
  };
  PSE.AIR_MISSIONS = ['air_superiority', 'cas', 'interception', 'strategic_bombing', 'naval_strike', 'air_supply'];

  Air.daily = function (w) {
    const rng = w.rng.fork('airdaily');
    // 空战：同一直径内敌对战斗机争夺制空权
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated) continue;
      for (const wing of c.airWings) {
        if (wing.count <= 0) continue;
        if (wing.mission === 'air_superiority' || wing.mission === 'interception') {
          // 与敌军战斗机对比
          const p = w.provinces[wing.loc];
          if (!p) continue;
          let enemyF = 0;
          for (const e of PSE.World.enemiesOf(w, t)) {
            const ec = w.countries[e];
            if (!ec) continue;
            for (const ew of ec.airWings) {
              const q = w.provinces[ew.loc];
              if (!q) continue;
              if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) <= 2) enemyF += ew.count;
            }
          }
          const losses = enemyF * 0.01 * (0.5 + rng.next01());
          if (losses > 0) {
            const l = Math.min(wing.count, Math.round(losses));
            wing.count -= l;
          }
          wing.str = Math.max(0.4, wing.str - 0.005);
        }
      }
    }
    // 战略轰炸：摧毁工厂与基建
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated) continue;
      for (const wing of c.airWings) {
        if (wing.count <= 0 || (wing.mission !== 'strategic_bombing' && wing.type !== 'tactical')) continue;
        if (wing.mission !== 'strategic_bombing') continue;
        // 找航程内敌国工业省
        const p = w.provinces[wing.loc];
        if (!p) continue;
        let best = null, bestVp = 0;
        for (const q of w.provinces) {
          if (q.controller === t || !PSE.World.areAtWar(w, t, q.controller)) continue;
          if (!q.buildings || (!q.buildings.civ && !q.buildings.mil)) continue;
          const dist = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
          if (dist > 4) continue;
          const score = (q.buildings.civ || 0) + (q.buildings.mil || 0) * 2 + q.cityVp * 0.1;
          if (score > bestVp) { bestVp = score; best = q; }
        }
        if (!best) continue;
        const dmg = wing.count * 0.02 * (0.5 + rng.next01()) * (1 + (c.mods.stratDamage || 0));
        best.bombDamage = Math.min(0.9, (best.bombDamage || 0) + dmg * 0.01);
        if ((best.buildings.mil || 0) > 0 && rng.next01() < dmg * 0.02) {
          best.buildings.mil -= 1;
          const owner = w.countries[best.owner];
          if (owner && owner.factories.mil > 0) owner.factories.mil -= 1;
        } else if ((best.buildings.civ || 0) > 0 && rng.next01() < dmg * 0.015) {
          best.buildings.civ -= 1;
          const owner = w.countries[best.owner];
          if (owner && owner.factories.civ > 0) owner.factories.civ -= 1;
        }
      }
    }
    // 对海打击
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated) continue;
      for (const wing of c.airWings) {
        if (wing.count <= 0 || wing.mission !== 'naval_strike') continue;
        const p = w.provinces[wing.loc];
        if (!p) continue;
        for (const z of (p.seaZones || [])) {
          for (const e of PSE.World.enemiesOf(w, t)) {
            const ec = w.countries[e];
            if (!ec || !ec.fleets) continue;
            for (const f of ec.fleets) {
              if (f.zone !== z || f.ships <= 0) continue;
              const dmg = wing.count * 0.01 * (0.5 + rng.next01());
              f.ships = Math.max(0, f.ships - dmg);
              if (rng.next01() < dmg * 0.02) Navy.shipLosses(ec, dmg, rng);
            }
          }
        }
      }
    }
    // 空中补给：给被围省补给的简化实现
    for (const t in w.countries) {
      const c = w.countries[t];
      for (const wing of c.airWings) {
        if (wing.mission !== 'air_supply' || wing.count <= 0) continue;
        const p = w.provinces[wing.loc];
        if (p && p.supply < 0.6) p.supply = Math.min(1, p.supply + 0.15);
      }
    }
  };

  // ============================================================
  // 5. 间谍与情报局
  // ============================================================
  const Spy = (PSE.Spy = {});
  PSE.SPY_MISSIONS = {
    blueprint: { name: '窃取蓝图', days: 60, risk: 0.25, desc: '获得目标国某领域研究加成' },
    sabotage: { name: '破坏工厂', days: 45, risk: 0.30, desc: '降低目标国军用产出' },
    strike: { name: '煽动罢工', days: 50, risk: 0.20, desc: '降低目标国稳定度' },
    coup: { name: '策划政变', days: 150, risk: 0.55, desc: '有机会改变目标国意识形态' },
    network: { name: '建立抵抗网络', days: 80, risk: 0.25, desc: '在目标国占领区制造抵抗' },
    decrypt: { name: '解密外交电报', days: 40, risk: 0.15, desc: '揭示目标国的战争意图与阵营' },
  };

  Spy.build = function (w, c) {
    if (c.agency && c.agency.exists) return false;
    if (c.pp < 50) return false;
    c.pp -= 50;
    c.agency = { exists: true, level: 1, agents: [], network: {} };
    PSE.log(w, c.name + ' 成立情报局', 'pol', c.tag);
    return true;
  };

  Spy.recruit = function (w, c) {
    if (!c.agency || !c.agency.exists) return false;
    const max = Math.min(5, 1 + Math.floor(c.factories.civ / 10));
    if (c.agency.agents.length >= max) return false;
    if (c.pp < 30) return false;
    c.pp -= 30;
    c.agency.agents.push({ id: c.agency.agents.length + 1, skill: 1 + (w.nextId.spy = (w.nextId.spy || 0) % 3), status: 'idle', mission: null, target: null, progress: 0 });
    return true;
  };

  Spy.send = function (w, c, targetTag, mission) {
    if (!c.agency || !c.agency.exists) return { ok: false, msg: '尚未成立情报局' };
    const def = PSE.SPY_MISSIONS[mission];
    if (!def) return { ok: false, msg: '未知任务' };
    const agent = c.agency.agents.find((a) => a.status === 'idle');
    if (!agent) return { ok: false, msg: '没有空闲特工（可先招募）' };
    if (!w.countries[targetTag]) return { ok: false, msg: '目标国不存在' };
    agent.status = 'mission';
    agent.mission = mission;
    agent.target = targetTag;
    agent.progress = 0;
    const net = (c.agency.network[targetTag] || 0);
    agent.total = def.days * (1 - Math.min(0.4, net / 250));
    PSE.log(w, c.name + ' 对 ' + w.countries[targetTag].name + ' 执行「' + def.name + '」', 'pol', c.tag);
    return { ok: true, msg: '任务已启动（约 ' + Math.round(agent.total) + ' 天）' };
  };

  Spy.daily = function (w) {
    const rng = w.rng.fork('spy');
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated || !c.agency || !c.agency.exists) continue;
      // 情报网自然增长
      for (const k in c.agency.network) c.agency.network[k] = Math.min(100, c.agency.network[k] + 0.05);
      for (const a of c.agency.agents) {
        if (a.status !== 'mission') continue;
        const target = w.countries[a.target];
        if (!target || target.capitulated) { a.status = 'idle'; a.mission = null; continue; }
        a.progress += 1;
        const def = PSE.SPY_MISSIONS[a.mission];
        const net = (c.agency.network[a.target] || 0);
        // 被发现概率
        const counter = target.agency && target.agency.exists ? target.agency.level * 0.08 : 0.02;
        const catchRisk = def.risk * (1 - Math.min(0.5, net / 200)) * (0.5 + counter) * (1 - a.skill * 0.08);
        if (rng.next01() < catchRisk / def.days) {
          a.status = 'captured';
          c.relations[a.target] = U.clamp((c.relations[a.target] || 0) - 20, -200, 200);
          target.relations[t] = U.clamp((target.relations[t] || 0) - 20, -200, 200);
          PSE.log(w, c.name + ' 特工在 ' + target.name + ' 被捕', 'warn', c.tag);
          continue;
        }
        if (a.progress >= a.total) {
          Spy.resolve(w, c, target, a, def);
          a.status = 'idle'; a.mission = null; a.target = null; a.progress = 0;
        }
      }
      // 情报网增长：有特工在目标国活动
      for (const a of c.agency.agents) {
        if (a.status !== 'mission' || !a.target) continue;
        c.agency.network[a.target] = Math.min(100, (c.agency.network[a.target] || 0) + 0.2);
      }
    }
  };

  Spy.resolve = function (w, c, target, agent, def) {
    const net = c.agency.network[target.tag] || 0;
    const success = U.clamp(0.35 + net / 200 + agent.skill * 0.08, 0.05, 0.95);
    const rng = w.rng.fork('spyres' + c.tag + target.tag + w.hour);
    if (rng.next01() > success) {
      PSE.log(w, c.name + ' 在 ' + target.name + ' 的「' + def.name + '」行动失败', 'warn', c.tag);
      return;
    }
    switch (agent.mission) {
      case 'blueprint': {
        const areas = ['army', 'air', 'navy', 'industry'];
        const area = areas[rng.int(areas.length)];
        c.techBonus = c.techBonus || [];
        c.techBonus.push({ area, v: 0.10 });
        PSE.log(w, c.name + ' 窃取到 ' + target.name + ' 的' + area + '蓝图（研究 +10%）', 'tech', c.tag);
        break;
      }
      case 'sabotage': {
        const p = w.provinces.filter((q) => q.owner === target.tag && q.buildings && q.buildings.mil > 0)[0];
        if (p) { p.buildings.mil -= 1; if (target.factories.mil > 0) target.factories.mil -= 1; }
        target.mods.milOutput = (target.mods.milOutput || 0) - 0.05;
        PSE.log(w, c.name + ' 破坏了 ' + target.name + ' 的工厂', 'warn', c.tag);
        break;
      }
      case 'strike':
        target.stability = U.clamp(target.stability - 0.08, 0, 1);
        PSE.log(w, c.name + ' 在 ' + target.name + ' 煽动罢工成功', 'warn', c.tag);
        break;
      case 'coup': {
        if (rng.next01() < 0.4) {
          target.ideology = c.ideology;
          target.stability = U.clamp(target.stability - 0.15, 0, 1);
          target.relations[c.tag] = U.clamp((target.relations[c.tag] || 0) + 60, -200, 200);
          PSE.log(w, c.name + ' 在 ' + target.name + ' 策划政变成功！', 'war', c.tag);
        } else {
          PSE.log(w, c.name + ' 在 ' + target.name + ' 的政变失败', 'warn', c.tag);
        }
        break;
      }
      case 'network': {
        for (const p of w.provinces) {
          if (p.owner === target.tag && p.controller !== target.tag) p.resistance = Math.min(100, p.resistance + 10);
        }
        PSE.log(w, c.name + ' 在 ' + target.name + ' 建立了抵抗网络', 'warn', c.tag);
        break;
      }
      case 'decrypt':
        c.intel = c.intel || {};
        c.intel[target.tag] = { level: Math.min(100, (c.intel[target.tag] ? c.intel[target.tag].level : 0) + 30), h: w.hour };
        PSE.log(w, c.name + ' 破译了 ' + target.name + ' 的外交电报', 'diplo', c.tag);
        break;
    }
  };

  // ============================================================
  // 6. 傀儡 / 流亡政府
  // ============================================================
  PSE.Cmd.createPuppet = function (w, tag) {
    const c = w.countries[w.playerTag];
    const target = w.countries[tag];
    if (!c || !target) return { ok: false, msg: '目标不存在' };
    if (!target.capitulated) return { ok: false, msg: '目标必须已被击败（先使其投降）' };
    const occupied = w.provinces.filter((p) => p.owner === tag && p.controller === c.tag).length;
    if (occupied < 1) return { ok: false, msg: '尚未占领目标领土' };
    target.puppetOf = c.tag;
    target.puppetType = 'puppet';
    target.capitulated = false;
    for (const p of w.provinces) {
      if (p.owner === tag && p.controller === c.tag) { p.controller = tag; p.resistance = 20; p.compliance = 40; }
    }
    if (!c.puppets) c.puppets = [];
    c.puppets.push(tag);
    if (c.faction) { target.faction = c.faction; (w.factions[c.faction] = w.factions[c.faction] || []).push(tag); }
    PSE.log(w, c.name + ' 建立了傀儡国：' + target.name, 'diplo', c.tag);
    return { ok: true, msg: target.name + ' 已成为傀儡国' };
  };

  PSE.Cmd.integratePuppet = function (w, tag) {
    const c = w.countries[w.playerTag];
    const target = w.countries[tag];
    if (!c || !target || target.puppetOf !== c.tag) return false;
    // 提取民用工厂与人力
    const civ = Math.floor(target.factories.civ * 0.25);
    c.puppetIncome = (c.puppetIncome || 0) + civ;
    c.manpower += target.manpower * 0.1;
    target.manpower *= 0.9;
    PSE.log(w, c.name + ' 从 ' + target.name + ' 征收 ' + civ + ' 座民用工厂产出', 'eco', c.tag);
    return true;
  };

  /** 流亡政府：本土全部沦陷但有盟友/殖民地时保留海军与部分领土 */
  PSE.Puppet_daily = function (w) {};

  // ============================================================
  // 7. 燃料 / 核武器
  // ============================================================
  PSE.Fuel = {
    daily: function (w) {
      for (const t in w.countries) {
        const c = w.countries[t];
        if (c.capitulated) continue;
        // 精炼：石油产出 × 0.5 + 精炼厂
        const oil = (c.dailyHave && c.dailyHave.oil) || 0;
        const cap = 500 + c.factories.civ * 5;
        const refined = oil * 0.5 + (c.mods.synthRatio || 0) * 20;
        c.fuel = Math.min(cap, (c.fuel || 0) + refined);
        // 消耗：装甲/摩托化师 + 飞机架次 + 舰队
        let use = 0;
        for (const id of c.divisions) {
          const d = w.divisions.find((x) => x.id === id);
          if (!d) continue;
          if (d.tplId === 'armor' || d.tplId === 'armor_med' || d.tplId === 'mot') use += 0.6;
        }
        for (const wing of c.airWings) use += wing.count * 0.02;
        for (const f of (c.fleets || [])) use += f.ships * 0.05;
        use += c.factories.mil * 0.2;
        c.fuelUse = use;
        if (c.fuel < use) {
          c.fuelShortage = U.clamp(1 - c.fuel / Math.max(0.01, use), 0, 1);
          c.fuel = 0;
        } else {
          c.fuel -= use;
          c.fuelShortage = 0;
        }
        // 缺油惩罚：机动与空军效率下降（在 cellHours/战斗中被读取）
        c.mods.fuelPenalty = c.fuelShortage * 0.5;
      }
    },
  };

  PSE.Nuke = {
    daily: function (w) {
      for (const t in w.countries) {
        const c = w.countries[t];
        if (c.capitulated) continue;
        if (c.researched.indexOf('nuc_bomb') < 0) continue;
        const reactors = w.provinces.filter((p) => p.controller === t && p.reactor).length;
        if (!reactors) continue;
        c.nukeProgress = (c.nukeProgress || 0) + reactors * (100 / 90); // 每座反应堆 90 天一枚
        while (c.nukeProgress >= 100) {
          c.nukeProgress -= 100;
          c.nukes = (c.nukes || 0) + 1;
          PSE.log(w, c.name + ' 完成一枚核装置（库存 ' + c.nukes + '）', 'tech', c.tag);
        }
      }
    },
  };

  PSE.Cmd.nuke = function (w, provId) {
    const c = w.countries[w.playerTag];
    const p = w.provinces[provId];
    if (!c || !p) return { ok: false, msg: '无效目标' };
    if (!(c.nukes > 0)) return { ok: false, msg: '没有可用的核装置' };
    c.nukes -= 1;
    const owner = w.countries[p.owner];
    p.bombDamage = 1.0;
    if (p.buildings) {
      const lostCiv = p.buildings.civ || 0, lostMil = p.buildings.mil || 0;
      if (owner) { owner.factories.civ = Math.max(0, owner.factories.civ - lostCiv); owner.factories.mil = Math.max(0, owner.factories.mil - lostMil); }
      p.buildings.civ = 0; p.buildings.mil = 0;
    }
    for (const d of w.divisions) {
      if (d.loc !== p.id) continue;
      d.org = Math.max(0, d.org * 0.2);
      d.hp = Math.max(0, d.hp * 0.5);
      d.str = Math.max(0.05, Math.min(d.str, d.hp / d.hpMax));
    }
    p.pop = (p.pop || 0) * 0.7;
    w.tension = U.clamp(w.tension + 30, 0, 100);
    w.nukeMarks = w.nukeMarks || [];
    w.nukeMarks.push({ lon: p.cx, lat: p.cy, h: w.hour, by: c.tag });
    for (const t in w.countries) {
      if (t === c.tag) continue;
      c.relations[t] = U.clamp((c.relations[t] || 0) - 40, -200, 200);
      w.countries[t].relations[c.tag] = U.clamp((w.countries[t].relations[c.tag] || 0) - 40, -200, 200);
    }
    PSE.log(w, '☢ ' + c.name + ' 对 ' + p.name + ' 使用了核武器！全球紧张度 +30', 'war', c.tag);
    return { ok: true, msg: p.name + ' 已被核打击' };
  };

  // ============================================================
  // 8. 统一每日/每小时入口
  // ============================================================
  PSE.Systems = {
    daily: function (w) {
      Trade.daily(w);
      Navy.daily(w);
      Air.daily(w);
      Spy.daily(w);
      PSE.Fuel.daily(w);
      PSE.Nuke.daily(w);
    },
    hourly: function (w) {
      Navy.tickInsertions(w);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
