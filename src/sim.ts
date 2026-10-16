/* PSE · 模拟层 (sim.js)
 * 时钟管线：每小时 tick（移动/战斗），日界跑日度系统（经济/科研/政治/占领/外交/事件/AI）。
 * 约束：无 DOM；全部状态在 world 上，可 JSON 序列化。
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});
  const U = PSE.U, BAL = PSE.BAL, Time = PSE.Time;

  const Sim = (PSE.Sim = {}) as any;

  // ============================================================
  // 常量：地形 / 天气
  // ============================================================
  const TERRAIN = {
    plain:    { atk: 1.00, def: 1.00, cost: 1.00 },
    hills:    { atk: 0.90, def: 1.15, cost: 1.30 },
    forest:   { atk: 0.85, def: 1.20, cost: 1.35 },
    mountain: { atk: 0.40, def: 1.60, cost: 1.70 },
    desert:   { atk: 1.00, def: 0.95, cost: 1.15 },
    marsh:    { atk: 0.70, def: 1.30, cost: 1.60 },
  };
  const WEATHER_NAME = ['晴', '降雨', '风暴', '降雪', '泥泞'];
  const WEATHER = {
    0: { atk: 1.00, move: 1.00 },
    1: { atk: 0.90, move: 1.20 },
    2: { atk: 0.75, move: 1.45 },
    3: { atk: 0.85, move: 1.30 },
    4: { atk: 0.80, move: 1.40 },
  };
  Sim.TERRAIN = TERRAIN;
  Sim.WEATHER_NAME = WEATHER_NAME;

  const ORG_DIV = 40;      // 组织度伤害分母（原型校准值）
  const HP_MUL = 2.0;      // HP 伤害 = 组织伤害 × HP_MUL
  const BASE_WIDTH = 80;   // 省份基础战场宽度（≈ 3~4 个步兵师）
  const FLANK_BONUS = 20;  // 每条侧翼（相邻己方控制省）增加的宽度

  // 供给档位：FULL>=0.90 / PENALTY>=0.60 / STARVING>0 / CUT=0
  function supplyTier(v) {
    if (v >= BAL.SUPPLY_FULL) return 'full';
    if (v >= BAL.SUPPLY_PENALTY) return 'penalty';
    if (v > 0) return 'starving';
    return 'cut';
  }
  Sim.supplyTier = supplyTier;
  const SUPPLY_ATK_MUL = { full: 1.0, penalty: 0.85, starving: 0.55, cut: 0.30 };
  const SUPPLY_DEF_MUL = { full: 1.0, penalty: 0.90, starving: 0.60, cut: 0.35 };

  // ============================================================
  // 通用索引
  // ============================================================
  function divsInProvince(w) {
    const map = {};
    for (const d of w.divisions) {
      if (d.battleId != null) continue; // 交战中的在 battle 里
      (map[d.loc] = map[d.loc] || []).push(d);
    }
    return map;
  }
  Sim.divsInProvince = divsInProvince;

  function alliesOfTag(w, tag) {
    // 同阵营 = 同一战线
    return PSE.World.alliesOf(w, tag).concat([tag]);
  }
  function sameSide(w, a, b) {
    if (a === b) return true;
    if (PSE.World.isAllied(w, a, b)) return true;
    return false;
  }

  // ============================================================
  // 天气（每日生成，确定性 RNG）
  // ============================================================
  function dailyWeather(w) {
    const season = Time.season(w.hour);
    const rng = w.rng.fork('weather');
    for (const p of w.provinces) {
      const r = rng.next01();
      if (season === 3) {
        p.weather = r < 0.45 ? 0 : r < 0.7 ? 3 : r < 0.9 ? 1 : 4;
      } else if (season === 0 || season === 2) {
        p.weather = r < 0.55 ? 0 : r < 0.75 ? 1 : r < 0.9 ? 4 : 2;
      } else {
        p.weather = r < 0.75 ? 0 : r < 0.9 ? 1 : 2;
      }
      if (p.terrain === 'desert' && p.weather === 4) p.weather = 0;
    }
  }
  Sim.dailyWeather = dailyWeather;

  // ============================================================
  // 移动：寻路 + 每小时推进
  // ============================================================
  function passable(w, p, tag) {
    const c = w.countries[tag];
    if (!c) return false;
    if (p.controller === tag) return true;
    if (sameSide(w, p.controller, tag)) return true;
    // 交战：可进入敌占区
    if (p.controller !== 'NEU' && PSE.World.areAtWar(w, tag, p.controller)) return true;
    if (p.controller === 'NEU') return false;
    const owner = w.countries[p.owner];
    if (owner && PSE.World.areAtWar(w, tag, p.owner)) return true;
    return false;
  }
  Sim.passable = passable;

  function cellHours(w, d, to) {
    const c = w.countries[d.tag];
    const speed = Math.max(1, d.template.speed * (1 + (c ? c.mods.speedMul : 0)));
    const t = TERRAIN[to.terrain] || TERRAIN.plain;
    let h = 48 / speed * t.cost;
    if (to.isCity) h *= 1.15;
    if (to.infra) h *= (1 - Math.min(0.3, to.infra * 0.04));
    if (to.rail > 0) h *= 0.92;
    const wx = WEATHER[to.weather || 0] || WEATHER[0];
    h *= wx.move;
    if (d.supply < BAL.SUPPLY_PENALTY) h *= 1.5;
    const season = Time.season(w.hour);
    if (season === 3 && (to.terrain === 'forest' || to.terrain === 'marsh')) h *= 1.2;
    return Math.max(1, Math.round(h));
  }
  Sim.cellHours = cellHours;

  // Dijkstra（限界）：返回省 id 数组（不含起点）
  function findPath(w, d, targetId) {
    const startId = d.loc;
    if (startId === targetId) return [];
    const target = w.provinces[targetId];
    if (!target || !passable(w, target, d.tag)) return null;
    const dist = {}, prev = {};
    const todo = [[0, startId]];
    dist[startId] = 0;
    let guard = 0;
    while (todo.length && guard++ < 1200) {
      todo.sort((a, b) => a[0] - b[0]);
      const [cd, id] = todo.shift();
      if (id === targetId) break;
      if (cd > (dist[id] !== undefined ? dist[id] : Infinity)) continue;
      const p = w.provinces[id];
      const neigh = p.neighbors.concat(p.seaLinks || []);
      for (const nb of neigh) {
        const q = w.provinces[nb];
        if (!q) continue;
        if (!passable(w, q, d.tag)) continue;
        const cost = q.seaLinks && p.neighbors.indexOf(nb) < 0
          ? 10 // 跨海（海峡/群岛）：耗时大
          : cellHours(w, d, q);
        const nd = cd + cost;
        if (dist[nb] === undefined || nd < dist[nb]) {
          dist[nb] = nd; prev[nb] = id;
          todo.push([nd, nb]);
        }
      }
    }
    if (dist[targetId] === undefined) return null;
    const path = [];
    let cur = targetId;
    while (cur !== startId) { path.unshift(cur); cur = prev[cur]; if (path.length > 80) return null; }
    return path;
  }
  Sim.findPath = findPath;

  Sim.orderMove = function (w, divs, targetId) {
    const target = w.provinces[targetId];
    if (!target) return 0;
    let ok = 0;
    for (const d of divs) {
      if (!passable(w, target, d.tag)) continue;
      const path = findPath(w, d, targetId);
      if (!path || !path.length) {
        // 目标即当前省
        if (d.loc === targetId) continue;
        continue;
      }
      d.path = path; d.moveTo = targetId; d.moveProgress = 0;
      d.status = 'moving'; d.entrench = 0; d.battleId = null;
      ok++;
    }
    return ok;
  };

  function stepMove(w, d) {
    if (d.status !== 'moving' || !d.path || !d.path.length) return;
    const nextId = d.path[0];
    const next = w.provinces[nextId];
    if (!next) { cancelMove(d); return; }
    if (!passable(w, next, d.tag)) { cancelMove(d); return; }
    d.moveProgress += 1;
    const need = cellHours(w, d, next);
    if (d.moveProgress < need) return;
    // 到达下一省
    d.loc = nextId; d.moveProgress = 0; d.path.shift();
    // 占领无人防守的敌占区（无敌军且非同侧控制）
    if (!sameSide(w, next.controller, d.tag) && next.controller !== 'NEU'
      && PSE.World.areAtWar(w, d.tag, next.controller)) {
      let hostile = false;
      for (const x of w.divisions) {
        if (x.loc === nextId && x.tag !== d.tag && !sameSide(w, x.tag, d.tag)) { hostile = true; break; }
      }
      if (!hostile) Sim.captureProvince(w, next, d.tag);
    }
    // 敌军在场 → 下一次扫描开战
    if (!d.path.length) { d.status = 'idle'; d.moveTo = null; }
  }
  function cancelMove(d) {
    d.path = []; d.moveTo = null; d.moveProgress = 0; d.status = 'idle';
  }
  Sim.cancelMove = cancelMove;

  // ============================================================
  // 战斗：扫描开战 + 小时结算
  // ============================================================
  function scanBattles(w) {
    const byLoc = divsInProvince(w);
    // 既有战斗：把新到单位编入
    for (const b of w.battles.slice()) {
      const p = w.provinces[b.prov];
      const here = byLoc[b.prov] || [];
      for (const d of here) {
        if (d.battleId != null) continue;
        if (d.org <= 0) continue;
        addToSide(w, b, d, p);
      }
      refreshSideIds(w, b);
      if (!b.atk.length && !b.def.length) removeBattle(w, b);
    }
    // 新冲突
    for (const key in byLoc) {
      const list = byLoc[key];
      if (list.length < 2) continue;
      const p = w.provinces[key];
      const inBattle = list.filter((d) => d.battleId != null);
      if (inBattle.length) continue;
      // 找敌对分组
      let side1 = null;
      for (const d of list) {
        if (!side1) { side1 = d.tag; continue; }
        if (!sameSide(w, side1, d.tag) && PSE.World.areAtWar(w, side1, d.tag)) {
          startBattle(w, p, list);
          break;
        }
      }
    }
  }

  function startBattle(w, p, list) {
    const b = {
      id: w.nextId.battle++, prov: p.id, startH: w.hour,
      atk: [], def: [], atkTag: null, defTag: null,
      airSuper: 0, log: [], rounds: 0,
    };
    // 分边：控制方为守
    const tagged = [];
    for (const d of list) {
      const side = (p.controller !== 'NEU' && sameSide(w, p.controller, d.tag)) ? 'def' : 'atk';
      if (side === 'atk') {
        if (!b.atkTag) b.atkTag = d.tag;
        if (!sameSide(w, b.atkTag, d.tag)) continue;
        b.atk.push(d.id);
      } else {
        if (!b.defTag) b.defTag = d.tag;
        if (!sameSide(w, b.defTag, d.tag)) continue;
        b.def.push(d.id);
      }
      tagged.push(d);
    }
    // 一侧为空 → 不开战，复位
    if (!b.def.length || !b.atk.length) {
      for (const d of list) { d.battleId = null; d.status = 'idle'; }
      return null;
    }
    for (const d of tagged) {
      d.battleId = b.id; d.status = 'battle'; d.moveProgress = 0; d.path = [];
    }
    w.battles.push(b);
    p.battleId = b.id;
    p.weather = p.weather || 0;
    PSE.bus.emit('battle_start', { battle: b, prov: p });
    return b;
  }

  function addToSide(w, b, d, p) {
    const side = (p.controller !== 'NEU' && sameSide(w, p.controller, d.tag)) ? 'def' : 'atk';
    if (side === 'atk') {
      if (b.atkTag && !sameSide(w, b.atkTag, d.tag)) return;
      b.atkTag = b.atkTag || d.tag;
      if (b.atk.indexOf(d.id) < 0) b.atk.push(d.id);
    } else {
      if (b.defTag && !sameSide(w, b.defTag, d.tag)) return;
      b.defTag = b.defTag || d.tag;
      if (b.def.indexOf(d.id) < 0) b.def.push(d.id);
    }
    d.battleId = b.id; d.status = 'battle'; d.path = []; d.moveProgress = 0;
  }

  /**
   * 清理战斗人员名单，并处理三种脱离情况：
   *  ① 组织度归零 → 撤退（HP 也归零则歼灭）；② 已离开该省 → 解除交战状态；
   *  ③ 引用了不存在的战斗 → 由 sweepOrphanBattles 兜底。
   * 旧实现只做过滤，会把 org=0 的师团变成"孤儿"：既不在名单里、battleId 又不为 null，
   * 于是永远不撤退、也永远不恢复组织度 —— 曾导致全线停战死锁。
   */
  function refreshSideIds(w, b) {
    const clean = (ids) => {
      const out = [];
      for (const id of ids) {
        const d = divById(w, id);
        if (!d || d.dead) continue;
        if (d.battleId !== b.id || d.loc !== b.prov) {
          if (d.battleId === b.id) { d.battleId = null; if (d.status === 'battle') d.status = 'idle'; }
          continue;
        }
        if (d.hp <= 0) { destroyDivision(w, d); continue; }
        if (d.org <= 0) { retreat(w, d); continue; }
        out.push(id);
      }
      return out;
    };
    b.atk = clean(b.atk);
    b.def = clean(b.def);
  }

  /** 兜底：清理指向已不存在战斗的师团（战斗结束时名单外单位可能残留） */
  function sweepOrphanBattles(w) {
    const live = {};
    for (const b of w.battles) live[b.id] = true;
    for (const d of w.divisions) {
      if (d.battleId == null) continue;
      if (!live[d.battleId]) {
        d.battleId = null;
        if (d.status === 'battle') d.status = 'idle';
      }
    }
  }

  const divIndex = new Map();
  function rebuildDivIndex(w) {
    divIndex.clear();
    for (const d of w.divisions) divIndex.set(d.id, d);
  }
  function divById(w, id) { return divIndex.get(id) || null; }
  Sim.rebuildDivIndex = rebuildDivIndex;

  function aggregate(w, b, sideIds) {
    const agg = {
      soft: 0, hard: 0, def: 0, brk: 0, width: 0, n: 0,
      orgSum: 0, hpSum: 0, supplySum: 0, supplyAvg: 1, entrench: 0, entrenchAvg: 0,
      byCountry: {}, flankDivs: 0,
    };
    for (const id of sideIds) {
      const d = divById(w, id);
      if (!d) continue;
      const c = w.countries[d.tag];
      const m = c ? c.modifiers : { softMul: 1, hardMul: 1, defMul: 1, brkMul: 1, orgMul: 1 };
      const str = d.str;
      const tpl = d.template;
      agg.soft += tpl.soft * str * (m.softMul || 1);
      agg.hard += tpl.hard * str * (m.hardMul || 1);
      agg.def += tpl.def * str * (m.defMul || 1);
      agg.brk += tpl.brk * str * (m.brkMul || 1);
      agg.width += d.width;
      agg.n++;
      agg.orgSum += d.org;
      agg.hpSum += d.hp;
      agg.supplySum += d.supply;
      agg.entrench += d.entrench || 0;
      const bc = (agg.byCountry[d.tag] = agg.byCountry[d.tag] || { soft: 0, cas: 0 });
      bc.soft += tpl.soft * str;
    }
    agg.supplyAvg = agg.n ? agg.supplySum / agg.n : 1;
    agg.entrenchAvg = agg.n ? agg.entrench / agg.n : 0;
    return agg;
  }

  // 战场宽度：基础 + 侧翼（邻接的己方控制省）
  function widthAllowance(w, b, isAtk) {
    const p = w.provinces[b.prov];
    const tag = isAtk ? b.atkTag : b.defTag;
    let flank = 0;
    for (const nb of p.neighbors) {
      const q = w.provinces[nb];
      if (!q || !tag) continue;
      if (sameSide(w, q.controller, tag)) flank++;
    }
    return BASE_WIDTH + FLANK_BONUS * Math.min(2, flank);
  }

  /**
   * 宽度内参战：按组织度降序（同组织度按 id 升序，保证确定性）依次纳入，
   * 直到宽度用尽；其余为预备队（不受伤害、不输出，随前排撤退自动顶上）。
   */
  function splitEngaged(w, sideIds, allowed) {
    const list = [];
    for (const id of sideIds) { const d = divById(w, id); if (d && !d.dead) list.push(d); }
    list.sort((a, b) => (b.org - a.org) || (a.id - b.id));
    const engaged = [], reserve = [];
    let used = 0;
    for (const d of list) {
      if (used + d.width <= allowed || engaged.length === 0) { engaged.push(d.id); used += d.width; }
      else reserve.push(d.id);
    }
    return { engaged, reserve, used, allowed };
  }

  function airPower(w, b, sideTag, enemyTag) {
    const p = w.provinces[b.prov];
    const range = 3;
    let mine = 0, enemy = 0, cas = 0;
    const check = (tag) => {
      let f = 0, c = 0;
      const cs = w.countries[tag];
      if (!cs) return [0, 0];
      for (const wing of cs.airWings) {
        const wp = w.provinces[wing.loc];
        if (!wp || wing.count <= 0) continue;
        const dist = Math.abs(wp.x - p.x) + Math.abs(wp.y - p.y);
        if (dist > range) continue;
        if (wing.type === 'fighter') f += wing.count * (wing.str || 1);
        else if (wing.type === 'cas') c += wing.count * (wing.str || 1);
      }
      return [f, c];
    };
    const [mf, mc] = check(sideTag);
    const [ef] = check(enemyTag);
    mine = mf; enemy = ef; cas = mc;
    const airSuper = U.div(mine - enemy, mine + enemy + 20, 0); // 归一 [-1,1]
    const cs = w.countries[sideTag];
    const casBonus = cs ? (cs.mods.casBonus || 0) : 0;
    return { airSuper, cas: cas * (0.0004 + casBonus * 0.0004) };
  }

  function battleTick(w, b) {
    refreshSideIds(w, b);
    if (!b.atk.length || !b.def.length) { endBattle(w, b); return; }
    const p = w.provinces[b.prov];
    const terr = TERRAIN[p.terrain] || TERRAIN.plain;
    const wx = WEATHER[p.weather || 0] || WEATHER[0];
    const rng = w.rng.fork('battle' + b.id);
    b.rounds++;

    // 战场宽度：只有宽度内的单位参战，其余为预备队（随前排撤退自动顶上）
    const allowedA = widthAllowance(w, b, true);
    const allowedD = widthAllowance(w, b, false);
    const ea = splitEngaged(w, b.atk, allowedA);
    const ed = splitEngaged(w, b.def, allowedD);
    b.engaged = {
      atk: ea.engaged.length, def: ed.engaged.length,
      reserveAtk: ea.reserve.length, reserveDef: ed.reserve.length,
      allowedA, allowedD,
    };
    const A = aggregate(w, b, ea.engaged);
    const D = aggregate(w, b, ed.engaged);

    // 制空权（进攻方 + 守方各自视角）
    const airA = airPower(w, b, b.atkTag, b.defTag);
    const airD = airPower(w, b, b.defTag, b.atkTag);

    const diceA = 0.5 + rng.next01();
    const diceD = 0.5 + rng.next01();

    // 供给惩罚
    const spA = SUPPLY_ATK_MUL[supplyTier(A.supplyAvg)];
    const spD = SUPPLY_DEF_MUL[supplyTier(D.supplyAvg)];

    // 城市/要塞防御加成
    let defMulD = terr.def * (1 + Math.min(BAL.ENTRENCH_MAX, D.entrenchAvg * 0.02));
    defMulD *= (1 + (p.fort || 0) * 0.04);
    if (p.isCity) defMulD *= 1.25;

    // 攻守有效攻击（宽度已在"参战筛选"阶段体现，不再额外折减）
    let atkEff = A.soft * terr.atk * wx.atk * diceA * spA
      * (1 + 0.10 * airA.airSuper) * (1 + airA.cas);
    let defEff = D.soft * terr.atk * wx.atk * diceD * spD
      * (1 + 0.10 * airD.airSuper) * (1 + airD.cas);

    // 包围修正：防守方无友邻省 → +5%/h 持续损耗 & 无法撤退
    let encircled = false;
    if (D.n > 0) {
      let friendly = 0;
      for (const nb of p.neighbors) {
        const q = w.provinces[nb];
        if (q && sameSide(w, q.controller, b.defTag)) { friendly++; break; }
      }
      if (!friendly) { encircled = true; atkEff *= 1.05; }
    }

    // 组织度伤害：
    //   攻方输出 ∝ 攻方总攻击；守方抗性 ∝ 单师平均防御（随规模线性摊薄）
    //   这样"人多"对进攻是线性增益，对防御是线性血池 —— 符合兰彻斯特直觉
    const avgDefD = D.n ? D.def / D.n : 0;
    const avgDefA = A.n ? A.def / A.n : 0;
    const defFactorD = 1 + (avgDefD * defMulD) / 100;
    const defFactorA = 1 + (avgDefA * (1 + Math.min(BAL.ENTRENCH_MAX, A.entrenchAvg * 0.02))) / 100;

    // —— 破防机制（HOI 式）：突破 vs 防御，超出部分转化为额外伤害 ——
    const defWallD = avgDefD * defMulD;
    const brkExcess = Math.max(0, A.brk / Math.max(1, A.n) - defWallD);
    const defExcess = Math.max(0, defWallD - A.brk / Math.max(1, A.n));
    const penA = 1 + Math.min(1.6, brkExcess / Math.max(20, defWallD));   // 攻方破防加成
    const penD = 1 + Math.min(1.2, defExcess / Math.max(20, avgDefA + 1)); // 守方防御压制加成
    atkEff *= penA;
    defEff *= penD;
    b.lastPen = penA;
    b.lastDefPen = penD;

    const orgDmgToDef = atkEff / defFactorD / ORG_DIV;
    const orgDmgToAtk = defEff / defFactorA / ORG_DIV;

    applyDamage(w, b, ed.engaged, orgDmgToDef, encircled, rng);
    applyDamage(w, b, ea.engaged, orgDmgToAtk, false, rng);

    b.airSuper = airA.airSuper;
    b.lastAtkDmg = orgDmgToDef; b.lastDefDmg = orgDmgToAtk;

    // 侧翼/突破经验
    if (b.rounds % 24 === 0) {
      for (const id of b.atk.concat(b.def)) {
        const d = divById(w, id);
        if (d) d.veterancy = Math.min(10, (d.veterancy || 0) + 0.15);
      }
    }

    refreshSideIds(w, b);
    if (!b.atk.length || !b.def.length) endBattle(w, b);
  }

  function applyDamage(w, b, sideIds, orgDmg, ignoreRetreat, rng) {
    if (orgDmg <= 0 || !sideIds.length) return;
    const per = orgDmg / sideIds.length;
    const hpPer = per * HP_MUL;
    const doers = sideIds.slice();
    for (const id of doers) {
      const d = divById(w, id);
      if (!d) continue;
      const c = w.countries[d.tag];
      const ml = c ? (c.mods.manpowerLoss || 0) : 0;
      d.org = Math.max(0, d.org - per * (1 + ml));
      d.hp = Math.max(0, d.hp - hpPer * (1 + ml));
      d.str = Math.max(0.05, Math.min(d.str, U.div(d.hp, d.hpMax, 0)));
      d.lastBattleH = w.hour;
      if (d.hp <= 0) { destroyDivision(w, d); continue; }
      if (d.org <= 0) {
        if (ignoreRetreat) {
          // 被围歼：无法撤退 → 持续掉血
          d.hp = Math.max(0, d.hp - hpPer);
          if (d.hp <= 0) destroyDivision(w, d);
        } else {
          retreat(w, d);
        }
      }
    }
  }

  function retreat(w, d) {
    const from = w.provinces[d.loc];
    const friendly = (q) => q && (q.controller === d.tag || sameSide(w, q.controller, d.tag));
    const noBattle = (q) => q && q.battleId == null;
    // 优先：无战斗的友方邻省
    for (const nb of from.neighbors) {
      const q = w.provinces[nb];
      if (friendly(q) && noBattle(q)) { doRetreat(w, d, nb); return; }
    }
    // 次选：2 跳内无战斗友方省
    for (const nb of from.neighbors) {
      const q0 = w.provinces[nb];
      if (!q0) continue;
      for (const nb2 of q0.neighbors) {
        const q = w.provinces[nb2];
        if (friendly(q) && noBattle(q)) { doRetreat(w, d, nb2); return; }
      }
    }
    // 无路可退 → 歼灭
    destroyDivision(w, d);
  }
  function doRetreat(w, d, provId) {
    d.loc = provId; d.battleId = null; d.status = 'retreat';
    d.path = []; d.moveTo = null;
    d.entrench = 0; d.moveProgress = 0;
    d.retreatingUntil = w.hour + 24;
    PSE.bus.emit('retreat', { div: d });
  }

  function destroyDivision(w, d) {
    d.dead = true;
    const b = w.battles.find((x) => x.id === d.battleId);
    if (b) {
      b.atk = b.atk.filter((i) => i !== d.id);
      b.def = b.def.filter((i) => i !== d.id);
    }
    PSE.World.removeDivision(w, d);
    PSE.bus.emit('division_dead', { div: d });
  }
  Sim.destroyDivision = destroyDivision;

  function endBattle(w, b) {
    refreshSideIds(w, b);
    const p = w.provinces[b.prov];
    const winner = b.def.length && !b.atk.length ? 'def' : (!b.def.length && b.atk.length ? 'atk' : 'draw');
    if (winner === 'atk') {
      // 进攻方占领
      if (b.atkTag) captureProvince(w, p, b.atkTag);
    }
    // 胜方小幅组织度奖励，双方脱离
    for (const id of b.atk.concat(b.def)) {
      const d = divById(w, id);
      if (d) { d.battleId = null; d.status = 'idle'; d.path = []; d.moveTo = null; }
    }
    p.battleId = null;
    w.battles = w.battles.filter((x) => x.id !== b.id);
    w.stats.battles = (w.stats.battles || 0) + 1;
    const dur = w.hour - b.startH;
    if (winner !== 'draw') {
      PSE.log(w, '战斗结束（' + (p.name || '') + '）：' +
        (winner === 'atk' ? PSE.COUNTRY_NAME[b.atkTag] || b.atkTag : PSE.COUNTRY_NAME[b.defTag] || b.defTag) +
        ' 获胜，历时 ' + dur + ' 小时', 'war', winner === 'atk' ? b.atkTag : b.defTag);
    }
    PSE.bus.emit('battle_end', { battle: b, winner, prov: p });
  }
  function removeBattle(w, b) {
    for (const id of b.atk.concat(b.def)) {
      const d = divById(w, id);
      if (d && d.battleId === b.id) { d.battleId = null; d.status = 'idle'; }
    }
    const p = w.provinces[b.prov];
    if (p) p.battleId = null;
    w.battles = w.battles.filter((x) => x.id !== b.id);
  }

  function captureProvince(w, p, tag) {
    if (p.controller === tag) return;
    const prev = p.controller;
    p.controller = tag;
    if (p.owner === tag) { p.resistance = 0; p.compliance = 1; p.occupiedBy = null; }
    else {
      p.occupiedBy = tag;
      p.resistance = Math.min(100, p.resistance + 5);
      p.compliance = Math.max(0, p.compliance - 5);
    }
    PSE.World.recomputeVP(w);
    PSE.bus.emit('capture', { prov: p, tag, prev });
    PSE.log(w, (p.name || '省份') + ' 被 ' + (PSE.COUNTRY_NAME[tag] || tag) + ' 占领', 'war', tag);
  }
  Sim.captureProvince = captureProvince;

  // ============================================================
  // 补给（每日 BFS 传播：供给中心 → 0.975^max(0, dist-3)）
  // ============================================================
  function computeSupply(w) {
    const srcs = {};
    for (const t in w.countries) srcs[t] = [];
    for (const p of w.provinces) {
      const owner = p.owner;
      if (!w.countries[owner]) continue;
      if (p.controller !== owner) continue;
      const hub = p.isCapital || p.isPort || (p.buildings.civ || 0) >= 2 || (p.buildings.mil || 0) >= 2;
      if (hub) srcs[owner].push(p.id);
    }
    for (const p of w.provinces) p.supply = 0;
    for (const t in srcs) {
      const sources = srcs[t];
      if (!sources.length) continue;
      const dist = {};
      const queue = [];
      for (const s of sources) { dist[s] = 0; queue.push(s); }
      let qi = 0;
      while (qi < queue.length) {
        const id = queue[qi++];
        const dcur = dist[id];
        if (dcur >= BAL.SUPPLY_RANGE) continue;
        const p = w.provinces[id];
        for (const nb of p.neighbors) {
          const q = w.provinces[nb];
          if (!q) continue;
          // 补给只在本国控制区内流动
          const allowedOwner = q.owner === t || q.controller === t;
          if (!allowedOwner) continue;
          if (dist[nb] === undefined) {
            dist[nb] = dcur + 1;
            queue.push(nb);
          }
        }
      }
      for (const id in dist) {
        const p = w.provinces[id];
        const v = Math.pow(0.975, Math.max(0, dist[id] - 3));
        if (v > p.supply) p.supply = v;
      }
    }
    // 局部拥挤：驻军超过容量 → 打折
    const byLoc = {};
    for (const d of w.divisions) (byLoc[d.loc] = byLoc[d.loc] || []).push(d);
    for (const p of w.provinces) {
      const here = byLoc[p.id] || [];
      const cap = 3 + (p.infra || 0) * 2;
      if (here.length > cap) {
        p.supply *= Math.max(0.4, Math.sqrt(U.div(cap, here.length, 1)));
      }
      p.supplyAt = p.supply;
      for (const d of here) {
        d.supply = p.supply;
        if (p.controller !== d.tag && !sameSide(w, p.controller, d.tag)) d.supply *= 0.6; // 敌占区被围困
      }
    }
    // 交战单位也吃所在省补给
    for (const d of w.divisions) {
      if (d.battleId == null) continue;
      const p = w.provinces[d.loc];
      if (p) d.supply = p.supply * (p.controller === d.tag || sameSide(w, p.controller, d.tag) ? 1 : 0.6);
    }
  }
  Sim.computeSupply = computeSupply;

  // ============================================================
  // 经济（每日）
  // ============================================================
  function controlledProvinces(w, tag) {
    const out = [];
    for (const p of w.provinces) if (p.controller === tag) out.push(p);
    return out;
  }
  Sim.controlledProvinces = controlledProvinces;

  function dailyResources(w, c) {
    const have = { coal: 0, oil: 0, rubber: 0, steel: 0, aluminum: 0, tungsten: 0, chromium: 0 };
    for (const p of w.provinces) {
      if (p.controller !== c.tag) continue;
      let f = 1;
      if (p.owner !== c.tag) {
        f = 0.4 + (p.compliance / 100) * 0.6;
        if (p.resistance > 50) f *= 0.6;
      }
      for (const k in p.resource) have[k] += p.resource[k] * f;
    }
    for (const k in c.resourceBonus) have[k] += c.resourceBonus[k];
    return have;
  }

  function dailyProduction(w, c) {
    // 不变量：陆空产线占用不得超过可用军用工厂（防止"空闲为负"）
    let assigned = c.production.reduce((s, l) => s + (l.dock ? 0 : l.factories), 0);
    if (assigned > c.factories.mil) {
      const over = assigned - c.factories.mil;
      const sorted = c.production.filter((l) => !l.dock).sort((a, b) => b.factories - a.factories);
      let cut = over;
      for (const l of sorted) {
        if (cut <= 0) break;
        const take = Math.min(l.factories, cut);
        l.factories -= take; cut -= take;
      }
      c.production = c.production.filter((l) => l.dock || l.factories > 0);
    }
    const have = dailyResources(w, c);
    // —— 煤炭（第七资源）：由工业省与钢铁产地派生；缺煤直接压低工厂出力 ——
    const coal = PSE.Coal ? PSE.Coal.produce(w, c) : 0;
    const coalNeed = c.factories.mil * 2 + c.factories.civ * 0.8;
    have.coal = coal;
    c.mods.coalPenalty = coalNeed > 0 ? U.clamp(coal / coalNeed, 0.5, 1) : 1;
    const trades = c.trades || (c.trades = []);
    // 贸易：民用工厂换进口资源
    let tradeCivs = 0;
    const imported = { coal: 0, oil: 0, rubber: 0, steel: 0, aluminum: 0, tungsten: 0, chromium: 0 };
    for (const tr of trades) {
      const partner = w.countries[tr.partner];
      if (!partner || partner.capitulated || (tr.res && PSE.World.areAtWar(w, c.tag, tr.partner))) continue;
      const srcHave = dailyResources(w, partner);
      const got = Math.min(tr.amount, Math.max(0, (srcHave[tr.res] || 0) * 0.5));
      imported[tr.res] += got;
      tradeCivs += 1;
    }
    const avail = {};
    for (const k in have) {
      const v = (have[k] || 0) + (imported[k] || 0);
      avail[k] = isFinite(v) ? v : 0;      // 防 NaN 污染（曾因新增 coal 缺省值导致全线 NaN）
    }
    c.resourceAvail = avail;

    // 需求
    const need = { coal: 0, oil: 0, rubber: 0, steel: 0, aluminum: 0, tungsten: 0, chromium: 0 };
    const econMul = (1 + (c.mods.milOutput || 0));
    for (const line of c.production) {
      if (!line.active || line.factories <= 0) continue;
      const eq = PSE.EQUIPMENT[line.equipId];
      if (!eq) continue;
      const units = plannedUnits(c, line, econMul);
      for (const k in eq.res) need[k] += units * eq.res[k];
    }
    // 木桶：任一资源不足 → 全线打折（下限 0.35）
    need.coal = coalNeed;
    let rf = 1;
    for (const k in need) {
      if (need[k] <= 0) continue;
      rf = Math.min(rf, U.div(avail[k], need[k], 0));
    }
    rf = U.clamp(isFinite(rf) ? rf : 1, 0.35, 1);
    c.resourceFactor = rf;

    // 实际生产
    for (const line of c.production) {
      if (!line.active || line.factories <= 0) { line.output = 0; continue; }
      const eq = PSE.EQUIPMENT[line.equipId];
      if (!eq) continue;
      // 换型冷却：期间效率停止爬升（换型惩罚的核心手感）
      if (line.switchDays > 0) line.switchDays -= 1;
      const points = plannedPoints(c, line, econMul) * rf;
      const units = points / eq.cost;
      line.output = Math.round(units * 100) / 100;
      c.stockpile[line.equipId] = (c.stockpile[line.equipId] || 0) + units;
      if (!(line.switchDays > 0)) {
        line.eff = Math.min(BAL.EQUIP_EFFICIENCY_CAP, line.eff + BAL.EQUIP_EFFICIENCY_GROWTH);
      }
    }
    c.tradeCivs = tradeCivs;
    c.dailyNeed = need;
    c.dailyHave = have;
    return tradeCivs;
  }

  function plannedPoints(c, line, econMul) {
    // 稳定度影响工厂产出（0.6~1.0 倍），战争支持影响动员效率
    const stabMul = 0.6 + 0.4 * (c.stability || 0.5);
    const wsMul = 0.9 + 0.1 * (c.warSupport || 0.4);
    const coalMul = c.mods.coalPenalty === undefined ? 1 : c.mods.coalPenalty;
    return line.factories * BAL.BASE_MIL_OUTPUT * line.eff * econMul * stabMul * wsMul * coalMul;
  }
  function plannedUnits(c, line, econMul) {
    const eq = PSE.EQUIPMENT[line.equipId];
    if (!eq) return 0;
    return plannedPoints(c, line, econMul) / eq.cost;
  }
  Sim.plannedUnits = plannedUnits;

  // 自动贸易：短缺 → 找顺差伙伴开一条线（1 民工换 12 单位/日）
  function autoTrade(w, c) {
    if (c.autoTrade === false) return;
    const trades = c.trades || (c.trades = []);
    const need = c.dailyNeed || {};
    const avail = c.resourceAvail || {};
    // 移除失效线
    c.trades = trades.filter((tr) => {
      const partner = w.countries[tr.partner];
      if (!partner || partner.capitulated) return false;
      if (PSE.World.areAtWar(w, c.tag, tr.partner)) return false;
      const shortage = (need[tr.res] || 0) - (avail[tr.res] || 0);
      return shortage > 1;
    });
    // 补新线
    for (const k in need) {
      const shortage = (need[k] || 0) - (avail[k] || 0);
      if (shortage <= 1) continue;
      if (c.trades.some((t) => t.res === k)) continue;
      // 找伙伴
      let best = null, bestScore = 0;
      for (const t in w.countries) {
        if (t === c.tag) continue;
        const p = w.countries[t];
        if (p.capitulated) continue;
        if (PSE.World.areAtWar(w, c.tag, t)) continue;
        const pHave = dailyResources(w, p)[k] || 0;
        if (pHave < 1) continue;
        const score = pHave * 0.5 + ((c.relations[t] || 0) + 100) * 0.2;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (best) {
        c.trades.push({ res: k, amount: Math.min(12, Math.ceil(shortage)), partner: best });
        PSE.log(w, c.name + ' 与 ' + w.countries[best].name + ' 签订' + resourceName(k) + '贸易协定', 'eco', c.tag);
      }
    }
  }
  function resourceName(k) {
    return { coal: '煤', oil: '石油', rubber: '橡胶', steel: '钢铁', aluminum: '铝', tungsten: '钨', chromium: '铬' }[k] || k;
  }
  Sim.resourceName = resourceName;

  function dailyConstruction(w, c) {
    const cg = BAL.CONSUMER_GOODS[c.laws.economy] + (c.mods.consumerGoods || 0);
    let avail = Math.max(0, c.factories.civ * (1 - U.clamp(cg, 0, 0.9)) - (c.tradeCivs || 0));
    if (avail <= 0 || !c.construction.length) return;
    const n = c.construction.length;
    const per = avail / n;
    const speed = 5 * (1 + (c.mods.buildSpeed || 0));
    let done = false;
    for (const item of c.construction) {
      if (done) break;
      item.prog += speed * per;
      if (item.prog >= item.cost) {
        finishConstruction(w, c, item);
        done = true;
      }
    }
    c.construction = c.construction.filter((it) => it.prog < it.cost);
  }

  function finishConstruction(w, c, item) {
    const p = w.provinces[item.prov] || WorldById(c.capital);
    if (!p) return;
    const def = PSE.BUILDINGS[item.kind];
    if (!def) return;
    if (item.kind === 'civ' || item.kind === 'mil' || item.kind === 'dock') {
      p.buildings[item.kind] = (p.buildings[item.kind] || 0) + 1;
      c.factories[item.kind]++;
    } else if (item.kind === 'infra') p.infra = Math.min(def.maxLevel, (p.infra || 0) + 1);
    else if (item.kind === 'rail') p.rail = Math.min(def.maxLevel, (p.rail || 0) + 1);
    else if (item.kind === 'fort') p.fort = Math.min(def.maxLevel, (p.fort || 0) + 1);
    else if (item.kind === 'airbase') p.airbase = Math.min(def.maxLevel, (p.airbase || 0) + 1);
    else if (item.kind === 'reactor') p.reactor = true;
    else if (item.kind === 'rocket_site') p.rocket = true;
    PSE.log(w, c.name + ' 完成建设：' + (def.name) + ' @' + (p.name || ''), 'eco', c.tag);
    PSE.bus.emit('construction_done', { c, item, p });
  }
  function WorldById(id) { return PSE.World.byId[id]; }

  // ============================================================
  // 科研（每日）
  // ============================================================
  function dailyResearch(w, c) {
    const slots = PSE.World.researchSlotsOf(w, c);
    while (c.research.length > slots) c.research.pop();
    const speed = 1 * (1 + (c.mods.researchSpeed || 0));
    for (let i = c.research.length - 1; i >= 0; i--) {
      const r = c.research[i];
      r.prog += speed;
      if (r.prog >= r.cost) {
        const tid = r.techId;
        if (c.researched.indexOf(tid) < 0) c.researched.push(tid);
        PSE.World.applyTech(w, c, tid);
        c.research.splice(i, 1);
        PSE.log(w, c.name + ' 完成科技：' + (PSE.TECHS[tid] ? PSE.TECHS[tid].name : tid), 'tech', c.tag);
        PSE.bus.emit('tech_done', { c, techId: tid });
      }
    }
    // 槽位空缺 → 自动补（AI 与玩家都默认自动，UI 可手动换）
    while (c.research.length < slots) {
      const tid = pickTech(c);
      if (!tid) break;
      PSE.World.startResearch(c, tid);
    }
  }

  function doctrineLock(c) {
    const docs = ['doc_mobile', 'doc_fire', 'doc_mass', 'doc_quality'];
    for (const d of docs) if (c.researched.indexOf(d) >= 0) return docs;
    return null;
  }
  function techAvailable(c, tid) {
    const t = PSE.TECHS[tid];
    if (!t) return false;
    if (c.researched.indexOf(tid) >= 0) return false;
    if (c.research.some((r) => r.techId === tid)) return false;
    if (t.prereq.some((pr) => c.researched.indexOf(pr) < 0)) return false;
    if (t.area === 'doctrine') {
      const lock = doctrineLock(c);
      if (lock && lock.indexOf(tid) < 0 && lock.some((d) => c.researched.indexOf(d) >= 0)) return false;
      if (lock && c.research.some((r) => PSE.TECHS[r.techId] && PSE.TECHS[r.techId].area === 'doctrine')) return false;
    }
    if (t.exclusiveWith && c.researched.indexOf(t.exclusiveWith) >= 0) return false;
    return true;
  }
  Sim.techAvailable = techAvailable;

  function pickTech(c) {
    // 工业优先 + 年代接近优先
    const list = [];
    for (const tid in PSE.TECHS) if (techAvailable(c, tid)) list.push(tid);
    if (!list.length) return null;
    const areaWeight = { industry: 1.3, army: 1.2, air: 1.0, doctrine: 0.9, navy: 0.7, nuclear: 0.6, rocket: 0.6 };
    list.sort((a, b) => {
      const ta = PSE.TECHS[a], tb = PSE.TECHS[b];
      const wa = (areaWeight[ta.area] || 1) * (ta.cost / 100) * (0.5 + ta.year * 0.0003);
      const wb = (areaWeight[tb.area] || 1) * (tb.cost / 100) * (0.5 + tb.year * 0.0003);
      return wb - wa;
    });
    return list[0];
  }
  Sim.pickTech = pickTech;

  // ============================================================
  // 政治（每日）
  // ============================================================
  function dailyPolitics(w, c) {
    // 政治点
    let pp = BAL.PP_BASE * (0.6 + 0.4 * c.stability);
    for (const a of c.advisors) if (a.pp) pp += a.pp;
    if (PSE.World.inAnyWar(w, c.tag)) pp *= 1.1;
    c.pp += pp;
    // 稳定度漂移
    const drift = 0.5 - c.stability;
    c.stability = U.clamp(c.stability + drift * 0.002, 0, 1);
    if (PSE.World.inAnyWar(w, c.tag)) {
      const pull = (0.35 + c.warSupport * 0.5) - c.stability;
      c.stability = U.clamp(c.stability + pull * 0.003, 0, 1);
    }
    // 国策
    if (c.focus.current) {
      c.focus.progress += 1;
      const node = focusNode(c, c.focus.current.id);
      if (node && c.focus.progress >= node.days) {
        completeFocus(w, c, node);
      }
      if (!node) { c.focus.current = null; c.focus.progress = 0; }
    }
    // 人力
    const regen = c.population * 1000 * BAL.MANPOWER_REGEN / 30;
    c.manpower += regen;
    // 延迟宣战倒计时
    if (c.delayedWar) {
      c.delayedWar.days -= 1;
      if (c.delayedWar.days <= 0) {
        const target = c.delayedWar.tag;
        c.delayedWar = null;
        PSE.Diplo.declareWar(w, c.tag, target, {});
      }
    }
    // 借口制造
    if (c.justifying) {
      c.justifying.days -= 1;
      if (c.justifying.days <= 0) {
        c.wargoals[c.justifying.target] = true;
        PSE.log(w, c.name + ' 对 ' + (PSE.COUNTRY_NAME[c.justifying.target] || '') + ' 的战争借口制造完毕', 'diplo', c.tag);
        c.justifying = null;
      }
    }
  }

  function focusNode(c, id) {
    const tree = PSE.FOCUS_TREES[c.focusTree] || PSE.FOCUS_TREES.generic;
    for (const n of tree.nodes) if (n.id === id) return n;
    return null;
  }
  Sim.focusNode = focusNode;

  Sim.focusAvailable = function (w, c, node) {
    if (c.focusDone.indexOf(node.id) >= 0) return false;
    if (c.focus.current === node.id) return false;
    for (const pr of node.prereq) if (c.focusDone.indexOf(pr) < 0) return false;
    // 互斥组
    if (node.excl) {
      for (const ex of node.excl) if (c.focusDone.indexOf(ex) >= 0) return false;
    }
    // 年代门槛（hidden.date）
    if (node.hidden && node.hidden.date) {
      const t = Time.decompose(w.hour);
      const [y, m, d] = node.hidden.date;
      if (t.year < y || (t.year === y && (t.month < m || (t.month === m && t.day < d)))) return false;
    }
    return true;
  };

  function completeFocus(w, c, node) {
    c.focusDone.push(node.id);
    c.focus.current = null;
    c.focus.progress = 0;
    c.focus.candidate = null;
    PSE.log(w, c.name + ' 完成国策：' + node.name, 'focus', c.tag);
    for (const e of node.effects) PSE.World.execEffect(w, c, e, 'focus');
    PSE.bus.emit('focus_done', { c, node });
    // 自动开下一个（AI 逻辑；玩家可立即手动改）
    const next = PSE.AI.pickFocus ? PSE.AI.pickFocus(w, c) : null;
    if (next) c.focus.current = { id: next, progress: 0 };
  }
  Sim.completeFocus = completeFocus;

  // ============================================================
  // 占领 / 抵抗（每日）
  // ============================================================
  function dailyOccupation(w, c) {
    const policy = c.resistPolicy || 'harsh';
    const POL = {
      harsh: { res: 1.5, com: 0.6, out: 1.0 },
      gentle: { res: 0.6, com: 1.4, out: 1.0 },
      collaborative: { res: 0.35, com: 2.2, out: 1.1 },
    }[policy] || { res: 1, com: 1, out: 1 };

    // 驻军压制：宪兵连分布在被占领省
    const suppression = {};
    for (const d of w.divisions) {
      const p = w.provinces[d.loc];
      if (!p || p.owner === d.tag) continue;
      const tpl = PSE.TEMPLATES[d.tplId];
      const st = PSE.computeTemplate(d.tplId);
      const supp = st ? (st.suppression || 0) : 0;
      if (supp > 0) suppression[p.id] = (suppression[p.id] || 0) + supp * d.str;
    }

    for (const p of w.provinces) {
      if (p.controller === p.owner) {
        if (p.resistance > 0) p.resistance = Math.max(0, p.resistance - 1);
        if (p.compliance < 100 && p.occupiedBy) p.compliance = Math.min(100, p.compliance + 1);
        if (p.compliance >= 100) p.occupiedBy = null;
        continue;
      }
      const ctrl = w.countries[p.controller];
      if (!ctrl) continue;
      const sup = suppression[p.id] || 0;
      const supMul = Math.max(0.2, 1 - Math.min(0.8, sup / 12));
      p.resistance = U.clamp(p.resistance + BAL.RESISTANCE_GROWTH * POL.res * supMul - 0.1, 0, 100);
      p.compliance = U.clamp(p.compliance + BAL.COMPLIANCE_GROWTH * POL.com, 0, 100);
        if (p.resistance >= 100) {
          p.resistance = 65;
          // 抵抗活动：驻军掉组织度、建筑受损
          for (const d of w.divisions) {
            if (d.loc === p.id) d.org = Math.max(0, d.org - 5);
          }
          if ((p.buildings.civ || 0) > 0) {
            const rng = w.rng.fork('res' + p.id);
            if (rng.next01() < 0.3) p.buildings.civ = Math.max(0, p.buildings.civ - 1);
          }
          PSE.log(w, (p.name || '') + ' 爆发抵抗运动', 'warn', p.controller);
        }
    }
  }

  // ============================================================
  // 补员（每日）
  // ============================================================
  function dailyReinforce(w, c) {
    for (const d of w.divisions) {
      if (d.tag !== c.tag) continue;
      if (d.hp >= d.hpMax - 0.01 && d.str >= 0.995) continue;
      const need = PSE.World.equipNeed(d.tplId);
      const ratio = 1 - d.str;
      if (ratio <= 0.005) continue;
      // 装备可得性
      let avail = 1;
      for (const e in need.equip) {
        const have = c.stockpile[e] || 0;
        avail = Math.min(avail, U.div(have, need.equip[e] * ratio, 0));
      }
      avail = U.clamp(avail, 0, 1);
      if (avail <= 0) continue;
      const step = Math.min(0.06, 0.04 + avail * 0.04);
      const actual = Math.min(ratio, step * avail);
      for (const e in need.equip) {
        c.stockpile[e] = Math.max(0, (c.stockpile[e] || 0) - need.equip[e] * actual);
      }
      d.str = Math.min(1, d.str + actual);
      d.hp = Math.min(d.hpMax, d.hp + d.hpMax * actual);
      d.reinforceNeed = 1 - d.str;
    }
  }

  // ============================================================
  // 每日组织度/HP 恢复、堑壕
  // ============================================================
  function hourlyRecovery(w) {
    for (const d of w.divisions) {
      if (d.battleId != null) continue;
      if (d.status === 'moving') continue;
      const tier = supplyTier(d.supply);
      if (d.org < d.orgMax * d.str) {
        const regen = tier === 'full' ? BAL.ORG_REGEN_SUPPLIED : tier === 'cut' ? 0 : BAL.ORG_REGEN;
        d.org = Math.min(d.orgMax * d.str, d.org + regen);
      }
      if (d.hp < d.hpMax && tier === 'full') {
        d.hp = Math.min(d.hpMax, d.hp + BAL.HP_REGEN * d.hpMax * 0.02);
      }
      d.entrench = Math.min(10, d.entrench + 0.05);
      if (d.retreatingUntil && w.hour > d.retreatingUntil) { d.status = 'idle'; d.retreatingUntil = 0; }
    }
  }

  // ============================================================
  // 外交 / 战争（每日）
  // ============================================================
  function dailyDiplomacy(w) {
    // 紧张度衰减
    w.tension = Math.max(0, w.tension - BAL.TENSION_DECAY);
    // 战争分数 + 投降检查
    for (const war of w.wars.slice()) {
      computeWarScore(w, war);
    }
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated) continue;
      checkCapitulation(w, c);
    }
  }

  function computeWarScore(w, war) {
    let atkScore = 0, defScore = 0;
    for (const t of war.attackers) { const c = w.countries[t]; if (c) atkScore += (c.vpTotal || 0); }
    for (const t of war.defenders) { const c = w.countries[t]; if (c) defScore += (c.vpTotal || 0); }
    if (!atkScore || !defScore) return;
    let aLost = 0, dLost = 0;
    for (const t of war.attackers) { const c = w.countries[t]; if (c) aLost += Math.max(0, (c.vpTotal || 0) - (c.vpHeld || 0)); }
    for (const t of war.defenders) { const c = w.countries[t]; if (c) dLost += Math.max(0, (c.vpTotal || 0) - (c.vpHeld || 0)); }
    war.warScore = U.clamp((dLost / defScore - aLost / atkScore) * 100, -100, 100);
  }

  function checkCapitulation(w, c) {
    const wars = PSE.World.warsOf(w, c.tag);
    if (!wars.length) return;
    if (!c.vpTotal) return;
    const lost = 1 - U.div(c.vpHeld, c.vpTotal, 1);
    const moraleHigh = c.warSupport >= 0.75 && c.stability >= 0.65;
    const moraleLow = c.warSupport < 0.35 || c.stability < 0.35;
    const threshold = BAL.CAPITULATION_VP + (moraleHigh ? 0.10 : 0) - (moraleLow ? 0.10 : 0);
    if (lost >= threshold) {
      capitulate(w, c, null);
    }
  }

  function capitulate(w, c, winnerHint) {
    if (c.capitulated) return;
    c.capitulated = true;
    c.capitulatedAt = w.hour;
    // 找主要敌人
    const wars = PSE.World.warsOf(w, c.tag);
    let winner = winnerHint;
    if (!winner) {
      for (const war of wars) {
        const other = war.attackers.indexOf(c.tag) >= 0 ? war.defenders : war.attackers;
        if (other.length) { winner = other[0]; break; }
      }
    }
    if (winner) {
      for (const p of w.provinces) {
        if (p.owner === c.tag || p.controller === c.tag) { p.controller = winner; p.occupiedBy = winner; }
      }
      // 装备与海军移交
      const wc = w.countries[winner];
      if (wc) for (const k in c.stockpile) wc.stockpile[k] = (wc.stockpile[k] || 0) + c.stockpile[k];
    }
    // 部队解散
    for (const id of c.divisions.slice()) {
      const div = w.divisions.find((x) => x.id === id);
      if (div) PSE.World.removeDivision(w, div);
    }
    c.divisions = [];
    // 战争移除（该国退出）
    c.warsOut = true;
    PSE.World.recomputeVP(w);
    PSE.log(w, c.name + ' 投降！', 'war', c.tag);
    PSE.bus.emit('capitulate', { c, winner });
    // 结束其战争
    w.wars = w.wars.filter((war) => {
      if (war.attackers.indexOf(c.tag) < 0 && war.defenders.indexOf(c.tag) < 0) return true;
      const side = war.attackers.indexOf(c.tag) >= 0 ? war.attackers : war.defenders;
      const alive = side.filter((t) => t !== c.tag && !w.countries[t].capitulated);
      if (alive.length) {
        if (war.attackers.indexOf(c.tag) >= 0) war.attackers = alive;
        else war.defenders = alive;
        return true;
      }
      // 一侧全灭 → 战争结束
      return false;
    });
    // 玩家战败判定
    if (c.tag === w.playerTag) w.gameOver = { win: false, reason: c.name + ' 投降' };
    // 战后和平会议（简化：参战方按占领贡献分配处置权）
    const war = wars[0];
    if (war && PSE.Peace) PSE.Peace.open(w, war, c.tag);
    checkVictory(w);
  }
  Sim.capitulate = capitulate;

  function checkVictory(w) {
    if (w.gameOver) return;
    const majors = ['GER', 'SOV', 'ENG', 'FRA', 'ITA'];
    const player = w.countries[w.playerTag];
    if (!player) return;
    // 玩家所在阵营的敌对主要国家全部投降 → 胜利
    const enemies = new Set<string>();
    for (const tag of majors) {
      if (tag === w.playerTag) continue;
      if (PSE.World.areAtWar(w, w.playerTag, tag)) enemies.add(tag);
    }
    if (enemies.size > 0) {
      let allCap = true;
      for (const e of enemies) if (!w.countries[e].capitulated) allCap = false;
      if (allCap) w.gameOver = { win: true, reason: '敌对主要国家全部投降' };
    }
  }
  Sim.checkVictory = checkVictory;

  // ============================================================
  // 事件系统
  // ============================================================
  const Events = (PSE.Events = {}) as any;

  Events.queueEvent = function (w, id) {
    if (!PSE.EVENTS[id]) return;
    if (w.events.queue.indexOf(id) >= 0) return;
    w.events.queue.push(id);
  };

  function evalTrigger(w, tr, tag) {
    if (!tr) return true;
    switch (tr.op) {
      case 'and': return tr.ts.every((t) => evalTrigger(w, t, tag));
      case 'or': return tr.ts.some((t) => evalTrigger(w, t, tag));
      case 'not': return !evalTrigger(w, tr.t, tag);
      case 'focus': { const c = w.countries[tag]; return !!c && c.focusDone.indexOf(tr.id) >= 0; }
      case 'date_after': {
        const t = Time.decompose(w.hour);
        if (t.year !== tr.y) return t.year > tr.y;
        if (t.month !== tr.m) return t.month > tr.m;
        return t.day >= tr.d;
      }
      case 'tag_is': return tag === tr.tag;
      case 'at_war': return PSE.World.areAtWar(w, tr.a, tr.b);
      case 'captured': { const c = w.countries[tr.tag]; return !!c && c.capitulated; }
      case 'tension_above': return w.tension >= tr.v;
      case 'has_tech_any': { const c = w.countries[tag]; return !!c && c.researched.indexOf(tr.id) >= 0; }
      case 'player_is': return w.playerTag === tr.tag;
      default: return false;
    }
  }
  Events.evalTrigger = evalTrigger;

  Events.tickDaily = function (w) {
    const rng = w.rng.fork('events');
    for (const id in PSE.EVENTS) {
      const ev = PSE.EVENTS[id];
      const fired = w.events.fired[id];
      if (ev.once && fired) continue;
      if (fired && !ev.once) {
        // 可重复：冷却 180 天
        if (w.hour - fired.h < 180 * 24) continue;
      }
      const tag = ev.tag === '*' ? w.playerTag : ev.tag;
      if (!evalTrigger(w, ev.trigger, tag)) continue;
      if (ev.randomPct && !fired && rng.next01() * 100 > ev.randomPct) continue;
      // 触发 → 入队（带延迟）
      if (!w.events.queue.some((q) => q.id === id)) {
        w.events.queue.push({ id, fireAt: w.hour + (ev.fireDelayH || 0) });
      } else {
        const q = w.events.queue.find((q) => q.id === id);
        if (q && typeof q === 'object') q.fireAt = Math.min(q.fireAt, w.hour + (ev.fireDelayH || 0));
      }
      if (ev.once) w.events.fired[id] = { h: w.hour, pending: true };
    }
    // 处理到期队列
    for (let i = w.events.queue.length - 1; i >= 0; i--) {
      const q = w.events.queue[i];
      const id = typeof q === 'string' ? q : q.id;
      const fireAt = typeof q === 'string' ? 0 : q.fireAt;
      if (w.hour < fireAt) continue;
      w.events.queue.splice(i, 1);
      Events.fire(w, id);
    }
    // 当前挂着的玩家事件等待 UI 决策
  };

  Events.fire = function (w, id) {
    const ev = PSE.EVENTS[id];
    if (!ev) return;
    if (w.events.current) {
      // 一次只挂一个：占用时推迟 6 小时重试
      if (!w.events.queue.some((q) => (typeof q === 'object' && q.id === id))) {
        w.events.queue.push({ id, fireAt: w.hour + 6 });
      }
      return;
    }
    const tag = ev.tag === '*' ? w.playerTag : ev.tag;
    w.events.current = { id, tag };
    if (ev.once) w.events.fired[id] = { h: w.hour };
    // AI 国家自动抉择
    if (tag !== w.playerTag) {
      Events.resolve(w, pickAiOption(w, ev, tag), true);
    }
  };

  function pickAiOption(w, ev, tag) {
    const c = w.countries[tag];
    if (!c) return 0;
    const aggr = (c.ai && c.ai.aggression) || 0.3;
    // 进攻性 AI 倾向第一个（通常更激进）选项
    return aggr > 0.6 ? 0 : (ev.options.length > 1 && aggr < 0.4 ? 1 : 0);
  }

  Events.resolve = function (w, optIdx, isAi) {
    const cur = w.events.current;
    if (!cur) return;
    const ev = PSE.EVENTS[cur.id];
    w.events.current = null;
    if (!ev) return;
    const opt = ev.options[U.clamp(optIdx | 0, 0, ev.options.length - 1)];
    const c = w.countries[cur.tag];
    if (!c) return;
    for (const e of opt.effects) PSE.World.execEffect(w, c, e, isAi ? 'auto' : 'player');
    PSE.log(w, '事件【' + ev.title + '】：' + opt.name, 'event', cur.tag);
    PSE.bus.emit('event_resolved', { ev, opt, tag: cur.tag });
  };

  // ============================================================
  // 外交动作
  // ============================================================
  const Diplo = (PSE.Diplo = {}) as any;

  Diplo.declareWar = function (w, attacker, defender, opts) {
    opts = opts || {};
    if (attacker === defender) return null;
    if (PSE.World.areAtWar(w, attacker, defender)) return null;
    const ac = w.countries[attacker], dc = w.countries[defender];
    if (!ac || !dc || ac.capitulated || dc.capitulated) return null;

    // 加入既有战争或新建
    let war = w.wars.find((x) =>
      (x.attackers.indexOf(attacker) >= 0 && x.defenders.indexOf(defender) >= 0) ||
      (x.attackers.indexOf(defender) >= 0 && x.defenders.indexOf(attacker) >= 0));
    if (war) {
      // 站队
      if (war.attackers.indexOf(defender) >= 0) {
        if (war.attackers.indexOf(attacker) < 0) war.attackers.push(attacker);
      } else {
        if (war.defenders.indexOf(attacker) < 0) war.defenders.push(attacker);
      }
    } else {
      war = { id: w.nextId.war++, attackers: [attacker], defenders: [defender], startH: w.hour, warScore: 0 };
      w.wars.push(war);
    }

    // 破坏互不侵犯
    if (PSE.World.isPact(w, attacker, defender)) {
      ac.pacts = ac.pacts.filter((t) => t !== defender);
      dc.pacts = dc.pacts.filter((t) => t !== attacker);
      w.tension = U.clamp(w.tension + 15, 0, 100);
    }
    // 紧张度
    const weight = (dc.isMajor ? 2 : 1) * (dc.tensionWeight || 1);
    w.tension = U.clamp(w.tension + (opts.tension || 6) * weight, 0, 100);
    ac.warSupport = U.clamp(ac.warSupport + 0.02, 0, 1);

    // 阵营自动参战
    for (const m of PSE.World.alliesOf(w, attacker)) joinWar(w, war, m, 'attackers');
    for (const m of PSE.World.alliesOf(w, defender)) joinWar(w, war, m, 'defenders');
    // 保护国承诺
    const guar = PSE.World.guarantorOf(w, defender);
    for (const g of guar) {
      if (PSE.World.areAtWar(w, g, attacker)) continue;
      joinWar(w, war, g, 'defenders');
      PSE.log(w, PSE.COUNTRY_NAME[g] + ' 因保护承诺对 ' + PSE.COUNTRY_NAME[attacker] + ' 宣战', 'diplo', g);
    }

    delete ac.wargoals[defender];
    PSE.log(w, PSE.COUNTRY_NAME[attacker] + ' 对 ' + PSE.COUNTRY_NAME[defender] + ' 宣战！', 'war', attacker);
    PSE.bus.emit('war', { war, attacker, defender });
    // 战争目标国若有迟滞宣战
    if (attacker === w.playerTag && !opts.silent) w.speed = Math.max(w.speed, 1);
    return war;
  };

  function joinWar(w, war, tag, side) {
    if (war[side].indexOf(tag) >= 0) return;
    if (war.attackers.indexOf(tag) >= 0 || war.defenders.indexOf(tag) >= 0) return;
    if (w.countries[tag] && w.countries[tag].capitulated) return;
    war[side].push(tag);
  }
  Diplo.joinWar = joinWar;

  Diplo.annexCountry = function (w, byTag, tag) {
    const c = w.countries[tag];
    if (!c || c.capitulated) return;
    for (const p of w.provinces) {
      if (p.owner === tag) {
        p.owner = byTag;
        p.controller = byTag;
        p.occupiedBy = null;
        p.resistance = 8;      // 合并初期少量抵抗
        p.compliance = 70;
        p.originalOwner = p.originalOwner; // 保留原主
      }
    }
    c.capitulated = true;
    c.annexedBy = byTag;
    c.divisions = [];
    w.tension = U.clamp(w.tension + (c.isMajor ? 15 : 6), 0, 100);
    PSE.World.recomputeVP(w);
    PSE.log(w, PSE.COUNTRY_NAME[byTag] + ' 吞并了 ' + c.name, 'war', byTag);
    PSE.bus.emit('annex', { by: byTag, tag });
    // 结束其战争
    w.wars = w.wars.filter((war) => {
      if (war.attackers.indexOf(tag) < 0 && war.defenders.indexOf(tag) < 0) return true;
      const side = war.attackers.indexOf(tag) >= 0 ? war.attackers : war.defenders;
      const alive = side.filter((t) => t !== tag);
      if (!alive.length) return false;
      if (war.attackers.indexOf(tag) >= 0) war.attackers = alive; else war.defenders = alive;
      return true;
    });
    checkVictory(w);
  };

  Diplo.annexState = function (w, byTag, tag, frac) {
    const c = w.countries[tag];
    if (!c) return;
    const provs = w.provinces.filter((p) => p.owner === tag);
    provs.sort((a, b) => (b.cityVp || 0) + (b.pop || 0) - ((a.cityVp || 0) + (a.pop || 0)));
    const n = Math.floor(provs.length * U.clamp(frac, 0, 1));
    let i = 0;
    for (const p of provs) {
      if (i >= n) break;
      if (p.isCapital) continue;
      p.owner = byTag; p.controller = byTag; p.occupiedBy = null;
      p.resistance = 10; p.compliance = 60;
      i++;
    }
    w.tension = U.clamp(w.tension + 5, 0, 100);
    PSE.World.recomputeVP(w);
    PSE.log(w, PSE.COUNTRY_NAME[byTag] + ' 从 ' + c.name + ' 夺取了 ' + i + ' 个省份', 'war', byTag);
    PSE.bus.emit('annex_state', { by: byTag, tag, n: i });
  };

  // ============================================================
  // 玩家命令
  // ============================================================
  const Cmd = (PSE.Cmd = {}) as any;

  Cmd.startFocus = function (w, focusId) {
    const c = w.countries[w.playerTag];
    if (!c) return false;
    // 允许"更换国策"：正在进行的国策会被放弃（进度清零），这是玩家的主动权
    if (c.focus.current && c.focus.current.id === focusId) return false;
    const node = focusNode(c, focusId);
    if (!node || !Sim.focusAvailable(w, c, node)) return false;
    if (c.focus.current) {
      const old = focusNode(c, c.focus.current.id);
      PSE.log(w, '放弃国策「' + (old ? old.name : c.focus.current.id) + '」，改推「' + node.name + '」', 'focus', c.tag);
    } else {
      PSE.log(w, '开始国策：' + node.name, 'focus', c.tag);
    }
    c.focus.current = { id: focusId, progress: 0 };
    return true;
  };

  Cmd.setResearch = function (w, slotIdx, techId) {
    const c = w.countries[w.playerTag];
    if (!c || slotIdx >= c.research.length) return false;
    if (!techAvailable(c, techId)) return false;
    const old = c.research[slotIdx];
    // 未使用进度部分转移（50%），换科研不再完全白费
    const carried = old ? Math.min(old.prog * 0.5, PSE.TECHS[techId].cost * 0.4) : 0;
    c.research[slotIdx] = { techId, prog: carried, cost: PSE.TECHS[techId].cost };
    if (carried > 0) PSE.log(w, '科研进度转移：' + Math.round(carried) + ' 天进度保留', 'tech', c.tag);
    return true;
  };

  /** 更换生产线型号：触发换型惩罚（效率归零 + 冷却），生产装备更替 */
  Cmd.switchLine = function (w, lineId, equipId) {
    const c = w.countries[w.playerTag];
    if (!c) return false;
    const line = c.production.find((l) => l.id === lineId);
    if (!line || !PSE.EQUIPMENT[equipId]) return false;
    if (line.equipId === equipId) return false;
    line.equipId = equipId;
    const eq = PSE.EQUIPMENT[equipId];
    const days = eq.type === 'tank' ? 30 : eq.type === 'air' ? 45 : eq.type === 'naval' ? 60 : 14;
    line.eff = BAL.EQUIP_EFFICIENCY_BASE;
    line.switchDays = days;
    PSE.log(w, '产线换型 → ' + eq.name + '（效率归零，冷却 ' + days + ' 天）', 'eco', c.tag);
    return true;
  };

  /** 军工已分配数（只算陆空军产线；船坞产线占的是 factories.dock，不占军工） */
  Cmd.prodUsedMil = function (c) {
    return (c.production || []).reduce((s, l) => s + (l.dock ? 0 : Math.max(0, l.factories || 0)), 0);
  };
  /** 空闲军工（面板与命令共用同一口径，避免「面板说有空闲、点击却说没有」） */
  Cmd.prodFreeMil = function (c) {
    return Math.max(0, (c.factories.mil || 0) - Cmd.prodUsedMil(c));
  };

  Cmd.setProdFactories = function (w, lineId, n) {
    const c = w.countries[w.playerTag];
    if (!c) return false;
    const line = c.production.find((l) => l.id === lineId);
    if (!line) return false;
    const max = c.factories.mil;
    const used = Cmd.prodUsedMil(c);
    const usedByOthers = used - (line.dock ? 0 : line.factories);
    // 关键：上限 = 本线现有 + 他人未占用的空闲军工，避免出现"空闲为负"
    const cap = Math.max(0, Math.min(max, max - usedByOthers));
    line.factories = Math.max(0, Math.min(n, cap));
    return true;
  };

  /**
   * 新增产线（带原因）：把空闲军工开成一条新产线；若该装备已有产线，则把空闲军工并入该线。
   * 关键修复：空闲口径与面板一致——船坞产线不占军工，过去把它算进来会出现
   * 「面板显示有空闲军工，点新增却提示没有空闲」。
   */
  Cmd.addProductionEx = function (w, equipId) {
    const c = w.countries[w.playerTag];
    if (!c) return { ok: false, msg: '当前没有可操作的国家' };
    const eq = PSE.EQUIPMENT[equipId];
    if (!eq) return { ok: false, msg: '未知装备型号' };
    if (eq.type === 'naval') {
      // 舰船走船坞：每座船坞一条产线（一条产线 1 座船坞，不占军工）
      const dockLines = c.production.filter((l) => l.dock);
      const freeDock = Math.max(0, (c.factories.dock || 0) - dockLines.length);
      if (freeDock <= 0) return { ok: false, msg: '没有空闲船坞（船坞 ' + (c.factories.dock || 0) + ' 座，已用 ' + dockLines.length + '）' };
      if (dockLines.some((l) => l.equipId === equipId)) {
        return { ok: true, msg: '「' + eq.name + '」已有船坞产线（船坞已用 ' + dockLines.length + '/' + (c.factories.dock || 0) + '）' };
      }
      const dl = { id: w.nextId.prod++, equipId: equipId, factories: 1, eff: BAL.EQUIP_EFFICIENCY_BASE, active: true, dock: true };
      c.production.push(dl);
      return { ok: true, msg: '新增船坞产线：' + eq.name + '（占 1 座船坞，已用 ' + (dockLines.length + 1) + '/' + (c.factories.dock || 0) + '）', lineId: dl.id };
    }
    const free = Cmd.prodFreeMil(c);
    if (free <= 0) return { ok: false, msg: '没有空闲军用工厂（军工 ' + c.factories.mil + '，已分配 ' + Cmd.prodUsedMil(c) + '）' };
    const same = c.production.find((l) => l.equipId === equipId && !l.dock);
    if (same) {
      same.factories += free;
      return { ok: true, msg: '「' + eq.name + '」已有产线，已并入 ' + free + ' 座军工（共 ' + same.factories + ' 座）', lineId: same.id };
    }
    const line = { id: w.nextId.prod++, equipId: equipId, factories: free, eff: BAL.EQUIP_EFFICIENCY_BASE, active: true };
    c.production.push(line);
    return { ok: true, msg: '新增产线：' + eq.name + '（' + free + ' 座军工）', lineId: line.id };
  };

  Cmd.addProduction = function (w, equipId) {
    return Cmd.addProductionEx(w, equipId).ok;
  };

  Cmd.removeProduction = function (w, lineId) {
    const c = w.countries[w.playerTag];
    if (!c) return false;
    const i = c.production.findIndex((l) => l.id === lineId);
    if (i < 0) return false;
    c.production.splice(i, 1);
    return true;
  };

  Cmd.toggleProduction = function (w, lineId) {
    const c = w.countries[w.playerTag];
    const line = c && c.production.find((l) => l.id === lineId);
    if (line) line.active = !line.active;
  };

  Cmd.queueBuild = function (w, kind, provId) {
    const c = w.countries[w.playerTag];
    if (!c) return false;
    const def = PSE.BUILDINGS[kind];
    if (!def) return false;
    const p = w.provinces[provId] || w.provinces.find((q) => q.id === c.capital);
    if (!p || p.controller !== c.tag) return false;
    if (def.coastal && !p.coastal) return false;
    c.construction.push({ kind, prov: p.id, prog: 0, cost: def.cost });
    return true;
  };

  Cmd.changeLaw = function (w, lawKey, value) {
    const c = w.countries[w.playerTag];
    if (!c) return false;
    const cost = 100 + value * 60;
    if (c.pp < cost) return false;
    if (c.laws[lawKey] === value) return false;
    c.pp -= cost;
    const old = c.laws[lawKey];
    c.laws[lawKey] = value;
    if (lawKey === 'conscription') {
      const oldRate = BAL.CONSCRIPTION[old] || 0.015;
      const newRate = BAL.CONSCRIPTION[value] || 0.015;
      c.manpower += c.population * 1000 * Math.max(0, newRate - oldRate);
    }
    PSE.log(w, '通过新法案：' + lawName(lawKey) + ' = ' + lawValueName(lawKey, value), 'pol', c.tag);
    return true;
  };
  function lawName(k) { return { conscription: '征召法', economy: '经济法', trade: '贸易法', training: '训练法' }[k] || k; }
  function lawValueName(k, v) {
    const names = {
      conscription: ['限 volunteer', '有限征召', '广泛征召', '总动员', '人人皆兵'],
      economy: ['民用经济', '部分动员', '战时经济', '总动员', '激进总动员', '彻底动员'],
      trade: ['出口自由', '有限出口', '断绝出口', '进口自由', '自由贸易', '自给自足'],
      training: ['短期训练', '标准训练', '长期训练', '精锐训练'],
    };
    return (names[k] && names[k][v]) || String(v);
  }
  Sim.lawName = lawName;
  Sim.lawValueName = lawValueName;

  Cmd.setResistPolicy = function (w, policy) {
    const c = w.countries[w.playerTag];
    if (c) c.resistPolicy = policy;
  };

  Cmd.justifyWarGoal = function (w, target) {
    const c = w.countries[w.playerTag];
    if (!c || c.justifying || c.wargoals[target]) return false;
    const cost = 40;
    if (c.pp < cost) return false;
    c.pp -= cost;
    c.justifying = { target, days: 30 };
    PSE.log(w, '开始对 ' + (PSE.COUNTRY_NAME[target] || target) + ' 制造战争借口…', 'diplo', c.tag);
    return true;
  };

  Cmd.declareWar = function (w, target) {
    const c = w.countries[w.playerTag];
    if (!c) return false;
    if (!c.wargoals[target] && w.tension < 25) return false;
    return !!PSE.Diplo.declareWar(w, w.playerTag, target, {});
  };

  Cmd.recruit = function (w, tplId, count) {
    const c = w.countries[w.playerTag];
    if (!c) return 0;
    const cap = w.provinces[c.capital];
    let n = 0;
    for (let i = 0; i < (count || 1); i++) {
      const d = PSE.World.createDivision(w, c.tag, tplId, cap.id, {});
      if (d) n++;
      else break;
    }
    if (n) PSE.log(w, '新编 ' + n + ' 个' + (PSE.TEMPLATES[tplId] ? PSE.TEMPLATES[tplId].name : tplId), 'army', c.tag);
    return n;
  };

  Cmd.orderMove = function (w, divIds, targetId) {
    const divs = [];
    for (const id of divIds) {
      const d = w.divisions.find((x) => x.id === id);
      if (d && d.tag === w.playerTag) divs.push(d);
    }
    if (!divs.length) return 0;
    return Sim.orderMove(w, divs, targetId);
  };

  Cmd.selectAll = function (w) {
    const c = w.countries[w.playerTag];
    if (!c) return [];
    return c.divisions.slice();
  };

  Cmd.saveTemplate = function (w, name, comp, support) {
    const c = w.countries[w.playerTag];
    if (!c) return null;
    const id = 'custom_' + (w.nextId.tpl = (w.nextId.tpl || 1) + 1);
    const tpl = { id, name, comp, support: support || [], unlocked: true };
    w.templates = w.templates || {};
    w.templates[id] = tpl;
    PSE.TEMPLATES[id] = tpl;
    const stats = PSE.computeTemplate(id, c.modifiers);
    if (stats.width <= 0) return null;
    if (c.templates.indexOf(id) < 0) c.templates.push(id);
    return { id, stats };
  };

  Cmd.buyAdvisor = function (w, advId) {
    const c = w.countries[w.playerTag];
    const adv = (PSE.ADVISORS || []).find((a) => a.id === advId);
    if (!c || !adv) return false;
    if (c.advisors.some((a) => a.id === advId)) return false;
    if (c.pp < adv.cost) return false;
    c.pp -= adv.cost;
    c.advisors.push(adv);
    if (adv.pp) { /* 每日 PP 在 dailyPolitics 结算 */ }
    for (const k in (adv.mods || {})) PSE.World.execEffect(w, c, { op: 'mod', key: k, v: adv.mods[k] }, 'player');
    return true;
  };

  // ============================================================
  // 主循环
  // ============================================================
  Sim.tickHour = function (w) {
    if (w.gameOver) return;
    rebuildDivIndex(w);
    w.hour++;

    // 1. 移动
    for (const d of w.divisions) stepMove(w, d);
    // 2. 战斗扫描
    scanBattles(w);
    // 3. 战斗结算
    rebuildDivIndex(w);
    for (const b of w.battles.slice()) battleTick(w, b);
    // 4. 恢复
    hourlyRecovery(w);
    // 4b. 登陆/空降抵达结算
    if (PSE.Systems) PSE.Systems.hourly(w);
    // 5. 兜底清理：指向已消失战斗的师团（防止"孤儿交战"永久冻结组织度恢复）
    sweepOrphanBattles(w);

    // 6. 日界
    if (w.hour % 24 === 0) daily(w);
  };

  function daily(w) {
    rebuildDivIndex(w);
    dailyWeather(w);
    computeSupply(w);

    for (const tag in w.countries) {
      const c = w.countries[tag];
      if (c.capitulated) continue;
      dailyProduction(w, c);
      autoTrade(w, c);
      dailyConstruction(w, c);
      dailyResearch(w, c);
      dailyPolitics(w, c);
      dailyOccupation(w, c);
      dailyReinforce(w, c);
    }
    dailyDiplomacy(w);
    // 占领后的控制权校正：无人防守的敌占区由占领军控制（已在 capture 处理）
    Events.tickDaily(w);
    // AI
    if (PSE.AI && PSE.AI.tickDaily) PSE.AI.tickDaily(w);
    // 扩展系统：军贸/海军/空军/谍报/燃料/核
    if (PSE.Systems) PSE.Systems.daily(w);
    // 扩展系统 II：决议/民族精神/阵营/傀儡自制度/将领与学说/煤炭
    if (PSE.Systems2) PSE.Systems2.daily(w);
    // 空军联队损耗（小）
    dailyAir(w);
    // 玩家国策自动开启（如果玩家没选）
    autoPlayerFocus(w);
  }
  Sim.daily = daily;

  function dailyAir(w) {
    const rng = w.rng.fork('air');
    for (const tag in w.countries) {
      const c = w.countries[tag];
      for (const wing of c.airWings) {
        if (wing.count <= 0) continue;
        // 非战斗损耗
        if (rng.next01() < 0.004) wing.count = Math.max(0, wing.count - 1);
        wing.str = U.clamp(wing.str + 0.01, 0, 1);
      }
    }
    // 空战：争夺战斗省上空
    for (const b of w.battles) {
      const p = w.provinces[b.prov];
      const a = airPower(w, b, b.atkTag, b.defTag);
      const d = airPower(w, b, b.defTag, b.atkTag);
      damageWings(w, b.defTag, Math.max(0, a.airSuper), rng);
      damageWings(w, b.atkTag, Math.max(0, d.airSuper), rng);
    }
  }
  function damageWings(w, tag, pressure, rng) {
    const c = w.countries[tag];
    if (!c) return;
    for (const wing of c.airWings) {
      if (wing.type !== 'fighter') continue;
      if (rng.next01() < pressure * 0.05) wing.count = Math.max(0, wing.count - Math.ceil(wing.count * 0.02));
    }
  }

  function autoPlayerFocus(w) {
    const c = w.countries[w.playerTag];
    if (!c || c.focus.current) return;
    if (c.autoFocus === false) return;
    const next = PSE.AI.pickFocus ? PSE.AI.pickFocus(w, c) : null;
    if (next) c.focus.current = { id: next, progress: 0 };
  }

  // 简单日志包装（GameLog 由 UI 持有；无 UI 时只进 world.log）
  PSE.log = function (w, text, kind, tag) {
    w.log = w.log || [];
    w.log.push({ h: w.hour, text, kind: kind || 'info', tag: tag || '' });
    if (w.log.length > 500) w.log.shift();
    if (PSE.gameLog) PSE.gameLog.push(w.hour, text, kind, tag);
    if (PSE.EventBus) PSE.bus.emit('log', { text, kind, tag });
  };
})(typeof window !== 'undefined' ? window : globalThis);
