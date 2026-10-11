/* PSE · 世界状态构建 (world.js)
 * 职责：创建/序列化世界状态、创建师团、外交关系查询、初始兵力与工厂部署。
 * 纯数据，无 DOM。加载顺序：core → data-rules → data-map → world
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});
  const U = PSE.U, MD = PSE.MapData, BAL = PSE.BAL;

  const World = (PSE.World = {});

  // ============================================================
  // 外交查询
  // ============================================================
  World.areAtWar = function (w, a, b) {
    if (!a || !b || a === b) return false;
    for (const war of w.wars) {
      const aAtk = war.attackers.indexOf(a) >= 0, aDef = war.defenders.indexOf(a) >= 0;
      const bAtk = war.attackers.indexOf(b) >= 0, bDef = war.defenders.indexOf(b) >= 0;
      if ((aAtk && bDef) || (aDef && bAtk)) return true;
    }
    return false;
  };
  /** 某国在某场战争中的敌人列表（含盟友牵连） */
  World.warEnemies = function (war, tag) {
    if (war.attackers.indexOf(tag) >= 0) return war.defenders;
    if (war.defenders.indexOf(tag) >= 0) return war.attackers;
    return [];
  };
  World.isAllied = function (w, a, b) {
    const ca = w.countries[a], cb = w.countries[b];
    if (!ca || !cb || ca.capitulated || cb.capitulated) return false;
    return !!ca.faction && ca.faction === cb.faction;
  };
  World.isPact = function (w, a, b) {
    const ca = w.countries[a];
    return !!(ca && ca.pacts && ca.pacts.indexOf(b) >= 0);
  };
  World.guarantorOf = function (w, tag) {
    const out = [];
    for (const t in w.countries) {
      if (t === tag) continue;
      const g = w.countries[t].guarantees;
      if (g && g.indexOf(tag) >= 0 && !w.countries[t].capitulated) out.push(t);
    }
    return out;
  };
  World.warsOf = function (w, tag) {
    const out = [];
    for (const war of w.wars) {
      if (war.attackers.indexOf(tag) >= 0 || war.defenders.indexOf(tag) >= 0) out.push(war);
    }
    return out;
  };
  World.enemiesOf = function (w, tag) {
    const out = [];
    for (const war of w.wars) {
      const foes = World.warEnemies(war, tag);
      for (const f of foes) if (!cap(w, f) && out.indexOf(f) < 0) out.push(f);
    }
    return out;
  };
  function cap(w, t) { const c = w.countries[t]; return !c || c.capitulated; }
  World.alliesOf = function (w, tag) {
    const out = [];
    const c = w.countries[tag];
    if (!c || !c.faction) return out;
    for (const t in w.countries) {
      if (t === tag) continue;
      const o = w.countries[t];
      if (o.faction === c.faction && !o.capitulated) out.push(t);
    }
    return out;
  };
  World.inAnyWar = function (w, tag) { return World.warsOf(w, tag).length > 0; };

  // ============================================================
  // 装备库存
  // ============================================================
  World.addEquip = function (w, tag, id, n) {
    const c = w.countries[tag];
    if (!c) return;
    c.stockpile[id] = Math.max(0, (c.stockpile[id] || 0) + n);
  };

  // ============================================================
  // 师团
  // ============================================================
  World.equipNeed = function (tplId) {
    const st = PSE.computeTemplate(tplId);
    if (!st) return { equip: {}, manpower: 0 };
    return { equip: st.equip, manpower: Math.max(1, Math.round(st.manpower)) };
  };

  // opts.free: 历史开局，不扣人力不扣装备；opts.full: 尽量满员
  World.createDivision = function (w, tag, tplId, locId, opts) {
    opts = opts || {};
    const c = w.countries[tag];
    if (!c) return null;
    const st = PSE.computeTemplate(tplId, c.modifiers || {});
    if (!st) return null;
    const need = World.equipNeed(tplId);
    let ratio = 1;
    if (!opts.free) {
      let have = 1;
      for (const e in need.equip) {
        const s = c.stockpile[e] || 0;
        if (need.equip[e] > 0) have = Math.min(have, s / need.equip[e]);
      }
      ratio = U.clamp(Math.min(1, have), 0, 1);
      const mp = need.manpower * ratio;
      if (c.manpower < mp) ratio = Math.min(ratio, c.manpower / Math.max(1, need.manpower));
      if (ratio <= 0.01) return null;
      for (const e in need.equip) {
        c.stockpile[e] = Math.max(0, (c.stockpile[e] || 0) - need.equip[e] * ratio);
      }
      c.manpower = Math.max(0, c.manpower - need.manpower * ratio);
    }
    const id = w.nextId.division++;
    const d = {
      id, tag, tplId,
      name: (PSE.COUNTRY_NAME[tag] || tag) + '·' + ((c.divisionCounter = (c.divisionCounter || 0) + 1)) + '师',
      loc: locId, org: st.org * ratio, orgMax: st.org,
      hp: st.hp * ratio, hpMax: st.hp,
      str: ratio, exp: 0, supply: 1, entrench: 0,
      moveTo: null, moveProgress: 0, battleId: null, status: 'idle', path: [],
      reinforceNeed: 1 - ratio, veterancy: 0, lastBattleH: -999,
      width: st.width,
      template: { soft: st.soft, hard: st.hard, def: st.def, brk: st.brk, speed: st.speed, supply: st.supply, manpower: need.manpower },
    };
    w.divisions.push(d);
    c.divisions.push(id);
    return d;
  };

  World.removeDivision = function (w, d) {
    const c = w.countries[d.tag];
    if (c) { const i = c.divisions.indexOf(d.id); if (i >= 0) c.divisions.splice(i, 1); }
    const j = w.divisions.indexOf(d);
    if (j >= 0) w.divisions.splice(j, 1);
  };

  // ============================================================
  // 胜利点统计
  // ============================================================
  World.recomputeVP = function (w) {
    for (const t in w.countries) { const c = w.countries[t]; c.vpTotal = 0; c.vpHeld = 0; }
    for (const p of w.provinces) {
      const c = w.countries[p.owner];
      if (!c) continue;
      c.vpTotal += p.cityVp || 0;
      if (p.controller === p.owner) c.vpHeld += p.cityVp || 0;
    }
  };

  // ============================================================
  // 国家初始化
  // ============================================================
  function initCountry(w, def) {
    const tag = def.tag;
    const provinces = w.provinces.filter((p) => p.owner === tag);
    const capital = provinces.find((p) => p.isCity && !p.colonial) || provinces.find((p) => !p.colonial) || provinces[0] || { id: -1 };

    const c = {
      tag, name: def.name, color: def.color, ideology: def.ideology, regime: def.regime,
      isMajor: !!def.isMajor, focusTree: def.focusTree || 'generic',
      faction: null, pacts: [], guarantees: [], claims: [], wargoals: {},
      pp: def.pp || 40, stability: def.stability || 0.6, warSupport: def.warSupport || 0.4,
      laws: Object.assign({ conscription: 1, economy: 1, trade: 1, training: 1 }, def.laws || {}),
      relations: {},
      factories: Object.assign({ civ: 0, mil: 0, dock: 0 }, def.factories),
      factoriesBuilt: { civ: 0, mil: 0, dock: 0 },
      stockpile: {}, production: [], construction: [],
      research: [], researched: [], techBonus: [],
      focus: { current: null, progress: 0, candidate: null },
      focusDone: [],
      templates: (def.templates || ['inf_9_1']).slice(),
      divisions: [], airWings: [],
      manpower: 0, population: 0,
      mods: {}, modifiers: {},
      advisors: [],
      resistPolicy: 'harsh',
      capitulated: false, capitulatedAt: -1,
      capital: capital.id,
      nukes: 0, warExhaustion: 0,
      ai: Object.assign({ aggression: 0.3, expand: 0.3 }, def.ai || {}),
      extraSlots: 0,
      divisionCounter: 0,
      justifying: null,
      delayedWar: null,
      resourceBonus: {},
      dailyProduction: {}, dailyNeed: {},
      // —— 扩展系统状态（军贸/海军/空军/谍报/燃料/核/傀儡）——
      credits: (def.factories ? def.factories.mil * 60 + def.factories.civ * 20 : 200),
      fleets: [], fuel: 0, fuelUse: 0, fuelShortage: 0,
      nukes: 0, nukeProgress: 0, reactors: 0,
      agency: null, intel: {}, techBonus: [], lendLease: [],
      equipmentOffers: [], equipOverride: {}, market: [],
      puppetOf: null, puppets: [], puppetIncome: 0,
      trades: [], autoTrade: true,
    };

    for (const t in PSE.COUNTRIES) if (t !== tag) c.relations[t] = 0;
    c.relations[tag] = 100;

    // 人口（百万）与人力池（千人）
    let pop = 0;
    for (const p of provinces) pop += (p.pop || 0) * (p.colonial ? 0.25 : 1);
    c.population = Math.round(pop * 10) / 10; // 百万
    c.manpower = c.population * 1000 * BAL.CONSCRIPTION[c.laws.conscription];

    resetMods(c);
    w.countries[tag] = c;
    return c;
  }

  function resetMods(c) {
    c.modifiers = { softMul: 1, hardMul: 1, defMul: 1, brkMul: 1, orgMul: 1 };
    c.mods = {
      civOutput: 0, milOutput: 0, buildSpeed: 0, researchSpeed: 0, synthRatio: 0,
      resourceFactor: 0, consumerGoods: 0, speedMul: 0, aaMul: 0, casBonus: 0,
      stratDamage: 0, airAtk: 0, navalAtk: 0, subAtk: 0, asw: 0, planningMul: 0,
      widthMul: 0, manpowerLoss: 0, supportMul: 0, supplyRange: 0, lendLease: 0,
      navalInvasion: 0, conscription: 0, entrenchMul: 0,
    };
  }
  World.resetMods = resetMods;

  const MUL_KEYS = { softMul: 1, hardMul: 1, defMul: 1, brkMul: 1, orgMul: 1 };
  function addToMods(c, key, v) {
    if (key in c.mods) c.mods[key] += v;
    else c.mods[key] = v;
    if (MUL_KEYS[key]) c.modifiers[key] = (c.modifiers[key] || 1) + v;
  }

  // ============================================================
  // 国策/事件共用效果执行器
  // ============================================================
  function execEffect(w, c, e, mode) {
    const tag = c.tag;
    switch (e.op) {
      case 'pp': c.pp = Math.max(0, c.pp + e.v); break;
      case 'stab': c.stability = U.clamp(c.stability + e.v, 0, 1); break;
      case 'ws': c.warSupport = U.clamp(c.warSupport + e.v, 0, 1); break;
      case 'tension': w.tension = U.clamp(w.tension + e.v, 0, 100); break;
      case 'factory':
        if (c.factories[e.kind] != null) { c.factories[e.kind] += e.n; c.factoriesBuilt[e.kind] += e.n; placeFreeFactory(w, c, e.kind, e.n); }
        break;
      case 'mod': case 'mod_self': addToMods(c, e.key, e.v); break;
      case 'mod_all_allies':
        addToMods(c, e.key, e.v);
        for (const a of World.alliesOf(w, tag)) addToMods(w.countries[a], e.key, e.v);
        break;
      case 'target_stab': { const t = w.countries[e.tag]; if (t) t.stability = U.clamp(t.stability + e.v, 0, 1); break; }
      case 'relation': {
        const t = w.countries[e.tag];
        if (t) {
          c.relations[e.tag] = U.clamp((c.relations[e.tag] || 0) + e.v, -200, 200);
          t.relations[tag] = U.clamp((t.relations[tag] || 0) + e.v, -200, 200);
        }
        break;
      }
      case 'res':
        c.resourceBonus[e.key] = (c.resourceBonus[e.key] || 0) + e.v;
        break;
      case 'tech':
        if (c.researched.indexOf(e.id) < 0) { c.researched.push(e.id); World.applyTech(w, c, e.id); }
        break;
      case 'equip': World.addEquip(w, tag, e.id, e.n); break;
      case 'manpower': c.manpower += e.v; break;
      case 'fort': {
        const p = World.byId[c.capital];
        if (p) p.fort = Math.min(10, p.fort + e.v);
        break;
      }
      case 'template': if (c.templates.indexOf(e.id) < 0) c.templates.push(e.id); break;
      case 'troops': {
        const p = World.byId[c.capital];
        if (p) for (let i = 0; i < e.n; i++) World.createDivision(w, tag, e.id, p.id, {});
        break;
      }
      case 'claim': if (c.claims.indexOf(e.tag) < 0) c.claims.push(e.tag); break;
      case 'guarantee': if (c.guarantees.indexOf(e.tag) < 0) c.guarantees.push(e.tag); break;
      case 'pact': {
        const t = w.countries[e.tag];
        if (t && c.pacts.indexOf(e.tag) < 0) { c.pacts.push(e.tag); t.pacts.push(tag); }
        break;
      }
      case 'wargoal': c.wargoals[e.tag] = true; break;
      case 'faction':
        if (!c.faction) { c.faction = 'axis'; (w.factions.axis = w.factions.axis || []).push(tag); }
        break;
      case 'faction_with': {
        const t = w.countries[e.tag];
        if (!t) break;
        if (t.faction) { if (c.faction && w.factions[c.faction]) removeFaction(w, c.faction, tag); c.faction = t.faction; (w.factions[c.faction] = w.factions[c.faction] || []).push(tag); }
        else if (c.faction) { if (t.faction && w.factions[t.faction]) removeFaction(w, t.faction, e.tag); t.faction = c.faction; (w.factions[c.faction] = w.factions[c.faction] || []).push(e.tag); }
        else { c.faction = 'axis'; (w.factions.axis = w.factions.axis || [tag]); if (w.factions.axis.indexOf(e.tag) < 0) w.factions.axis.push(e.tag); t.faction = 'axis'; }
        break;
      }
      case 'faction_join': {
        const t = w.countries[e.tag];
        if (t && t.faction) {
          if (c.faction && w.factions[c.faction]) removeFaction(w, c.faction, tag);
          c.faction = t.faction;
          (w.factions[c.faction] = w.factions[c.faction] || []).push(tag);
        }
        break;
      }
      case 'declare_war': PSE.Diplo.declareWar(w, tag, e.tag, { silent: mode === 'auto' }); break;
      case 'delay_war': c.delayedWar = { tag: e.tag, days: e.days }; break;
      case 'annex': PSE.Diplo.annexCountry(w, tag, e.tag); break;
      case 'annex_state': PSE.Diplo.annexState(w, tag, e.tag, e.frac || 0.5); break;
      case 'event': PSE.Events.queueEvent(w, e.id); break;
      case 'slot': c.extraSlots += e.v; break;
      default: break;
    }
  }
  World.execEffect = execEffect;

  function removeFaction(w, fac, tag) {
    const arr = w.factions[fac];
    if (!arr) return;
    const i = arr.indexOf(tag);
    if (i >= 0) arr.splice(i, 1);
    if (!arr.length) delete w.factions[fac];
  }
  World.removeFaction = removeFaction;

  World.applyTech = function (w, c, techId) {
    const t = PSE.TECHS[techId];
    if (!t) return;
    for (const k in t.effects) {
      const v = t.effects[k];
      if (typeof v === 'number' && !MUL_KEYS[k]) addToMods(c, k, v);
      else if (typeof v === 'number') addToMods(c, k, v);
    }
  };

  // ============================================================
  // 工厂落地：把国家工厂数分配到具体省份建筑
  // ============================================================
  function ownedProvs(w, c) {
    return w.provinces.filter((p) => p.owner === c.tag && !p.colonial);
  }
  function placeFreeFactory(w, c, kind, n) {
    const provs = ownedProvs(w, c);
    if (!provs.length) return;
    const sorted = provs.slice().sort((a, b) => (b.cityVp || 0) - (a.cityVp || 0));
    let placed = 0;
    // 找第一个能放的省（dock 必须沿海）
    for (let round = 0; round < 3 && placed < n; round++) {
      for (const p of sorted) {
        if (placed >= n) break;
        if (kind === 'dock' && !p.coastal) continue;
        p.buildings[kind] = (p.buildings[kind] || 0) + 1;
        placed++;
        if (round === 0) break; // 第一轮每个省放 1 个即可（简化：都放首都/大城市）
      }
    }
  }

  function distributeFactories(w, c) {
    const provs = ownedProvs(w, c);
    if (!provs.length) {
      // 无领土国家（如未定领地 NEU）不应保留账面工厂
      c.factories = { civ: 0, mil: 0, dock: 0 };
      return;
    }
    const byCity = provs.slice().sort((a, b) => (b.cityVp || 0) - (a.cityVp || 0));
    const placed = { civ: 0, mil: 0, dock: 0 };
    const assign = (kind, n, pool) => {
      for (let i = 0; i < n; i++) {
        let p = pool[i % pool.length];
        if (!p) break;
        if (kind === 'dock' && !p.coastal) {
          p = pool.find((q) => q.coastal);
          if (!p) break; // 内陆国没有船坞
        }
        p.buildings[kind] = (p.buildings[kind] || 0) + 1;
        placed[kind]++;
      }
    };
    assign('civ', c.factories.civ, byCity);
    assign('mil', c.factories.mil, byCity);
    assign('dock', c.factories.dock, byCity.slice().sort((a, b) => (b.coastal ? 1 : 0) - (a.coastal ? 1 : 0)));
    // 与实际建筑对齐（内陆国船坞归零等）
    c.factories.civ = placed.civ;
    c.factories.mil = placed.mil;
    c.factories.dock = placed.dock;
  }

  // ============================================================
  // 初始经济：生产 / 建造 / 研究 / 库存
  // ============================================================
  const RESEARCH_PRIORITY = ['con_1', 'ind_civ_1', 'res_1', 'inf_weap_1', 'art_1', 'mot_1', 'ftr_1',
    'sup_1', 'con_2', 'ind_mil_1', 'at_1', 'aa_1', 'cas_1', 'nav_1', 'res_2', 'ind_civ_2', 'armor_1', 'synth_1'];

  function researchSlotsOf(w, c) {
    const base = 2 + (c.factories.civ >= 8 ? 1 : 0) + (c.factories.civ >= 18 ? 1 : 0) + (c.factories.civ >= 28 ? 1 : 0);
    return Math.max(2, Math.min(5, base + c.extraSlots));
  }
  World.researchSlotsOf = researchSlotsOf;

  function initEconomy(w, tag, def) {
    const c = w.countries[tag];
    const mil = c.factories.mil;
    const heavy = !!def.isMajor;
    const lines = [];
    const nMain = Math.max(1, Math.ceil(mil * 0.45));
    const nArt = Math.max(1, Math.floor(mil * 0.30));
    const nRest = mil - nMain - nArt;
    lines.push({ equipId: 'infantry_equipment_1', factories: nMain });
    lines.push({ equipId: 'artillery_1', factories: nArt });
    if (nRest > 0) lines.push({ equipId: heavy ? 'fighter_1' : 'support_equipment', factories: nRest });
    if ((def.templates || []).indexOf('armor') >= 0 && mil >= 6) {
      lines[0].factories -= 1;
      lines.push({ equipId: 'light_tank_1', factories: 1 });
    }
    for (const l of lines) {
      if (l.factories <= 0) continue;
      c.production.push({ id: w.nextId.prod++, equipId: l.equipId, factories: l.factories, eff: BAL.EQUIP_EFFICIENCY_BASE, active: true });
    }
    for (let i = 0; i < c.factories.dock; i++) {
      c.production.push({
        id: w.nextId.prod++, equipId: i % 3 === 0 ? 'submarine' : (i % 3 === 1 ? 'destroyer' : 'convoy'),
        factories: 1, eff: BAL.EQUIP_EFFICIENCY_BASE, active: true, dock: true,
      });
    }
    // 收敛：陆空军产线分配数不得超过可用军用工厂（防止"已分配 12 / 军工 8"的负数空闲）
    let assigned = c.production.reduce((s, l) => s + (l.dock ? 0 : l.factories), 0);
    while (assigned > mil) {
      const biggest = c.production.filter((l) => !l.dock && l.factories > 1)
        .sort((a, b) => b.factories - a.factories)[0];
      if (!biggest) break;
      biggest.factories -= 1;
      assigned -= 1;
    }
    // 仍然超出（每个产线只剩 1 工厂）→ 删除多余产线
    while (c.production.reduce((s, l) => s + (l.dock ? 0 : l.factories), 0) > mil) {
      const idx = c.production.map((l, i) => (l.dock ? -1 : i)).filter((i) => i >= 0).pop();
      if (idx === undefined || c.production.filter((l) => !l.dock).length <= 1) break;
      c.production.splice(idx, 1);
    }
    // 建造：优先民工
    const cap = World.byId[c.capital];
    const nCiv = Math.max(1, Math.floor(c.factories.civ * 0.25));
    for (let i = 0; i < nCiv; i++) {
      c.construction.push({ kind: 'civ', prov: cap ? cap.id : 0, prog: 0, cost: PSE.BUILDINGS.civ.cost });
    }
    // 科研
    const slots = researchSlotsOf(w, c);
    for (let i = 0; i < slots; i++) {
      const tid = nextTech(c, RESEARCH_PRIORITY);
      if (tid) startResearch(c, tid);
    }
    // 起始库存（现役 + 预备）
    const divCount = (def.army || []).reduce((s, a) => s + a[1], 0);
    World.addEquip(w, tag, 'infantry_equipment_1', divCount * 600 + mil * 400);
    World.addEquip(w, tag, 'support_equipment', divCount * 60 + mil * 60);
    World.addEquip(w, tag, 'artillery_1', divCount * 40 + mil * 30);
    World.addEquip(w, tag, 'motorized_equipment', divCount * 30 + mil * 40);
    if ((def.templates || []).indexOf('armor') >= 0) World.addEquip(w, tag, 'light_tank_1', 600 + mil * 40);
    if ((def.templates || []).indexOf('mot') >= 0) World.addEquip(w, tag, 'motorized_equipment', 300);
    World.addEquip(w, tag, 'fighter_1', heavy ? 300 : 80);
    World.addEquip(w, tag, 'cas_1', heavy ? 150 : 40);
    World.addEquip(w, tag, 'destroyer', heavy ? 40 : 8);
    World.addEquip(w, tag, 'convoy', heavy ? 60 : 20);
    World.addEquip(w, tag, 'cruiser', heavy ? 10 : 2);
    World.addEquip(w, tag, 'submarine', heavy ? 24 : 6);
    World.addEquip(w, tag, 'battleship', heavy ? 6 : 1);
    World.addEquip(w, tag, 'infantry_equipment_2', 0);
  }

  function nextTech(c, priority) {
    for (const tid of priority) {
      if (c.researched.indexOf(tid) >= 0) continue;
      if (c.research.some((r) => r.techId === tid)) continue;
      const t = PSE.TECHS[tid];
      if (!t) continue;
      if (t.prereq.some((pr) => c.researched.indexOf(pr) < 0)) continue;
      return tid;
    }
    return null;
  }
  World.nextTech = nextTech;

  function startResearch(c, tid) {
    const t = PSE.TECHS[tid];
    if (!t) return false;
    c.research.push({ techId: tid, prog: 0, cost: t.cost });
    return true;
  }
  World.startResearch = startResearch;

  // 空军联队：把库存飞机转为联队
  function initAir(w, tag, def) {
    const c = w.countries[tag];
    const cap = World.byId[c.capital];
    if (!cap) return;
    const mk = (type, stockId) => {
      const n = Math.floor(c.stockpile[stockId] || 0);
      if (n > 0) {
        c.airWings.push({ id: w.nextId.wing++, tag, type, loc: cap.id, count: n, str: 1, mission: 'air_superiority' });
        c.stockpile[stockId] = 0;
      }
    };
    mk('fighter', 'fighter_1');
    mk('cas', 'cas_1');
    if (def.isMajor) c.airWings.push({ id: w.nextId.wing++, tag, type: 'tactical', loc: cap.id, count: 60, str: 1, mission: 'bombing' });
  }

  // ============================================================
  // 世界创建
  // ============================================================
  World.create = function (opts) {
    opts = opts || {};
    const w = {
      version: 1, hour: 0, speed: opts.speed != null ? opts.speed : 2,
      playerTag: opts.playerTag || 'GER',
      tension: 0, factions: {}, wars: [],
      provinces: [], countries: {}, divisions: [], battles: [],
      log: [], events: { fired: {}, queue: [], shown: {} },
      nextId: { division: 1, battle: 1, war: 1, prod: 1, wing: 1, event: 1 },
      ai: {}, stats: { battles: 0 },
      ironman: !!opts.ironman,
      rngSeed: opts.seed || 19360101,
      ui: { layer: 'political' },
      gameOver: null,
    };

    // ---- 省份 ----
    for (const p of MD.provinces) {
      const prov = {
        id: p.id, x: p.x, y: p.y,
        cx: p.cx, cy: p.cy,                  // 真实经纬度质心（渲染/海区/距离计算用）
        poly: p.poly,                        // 多边形轮廓（真实地理形状）
        borderEdges: (p.borderEdges || []).slice(),
        seaZones: (p.seaZones || []).slice(),
        name: p.name || '',
        owner: p.owner, controller: p.controller || p.owner, originalOwner: p.owner,
        colonial: !!p.colonial,
        terrain: p.terrain,
        cityVp: p.vp || 0, isCity: (p.vp || 0) > 0,
        isCapital: false,
        coastal: !!p.coastal, isPort: !!p.isPort,
        neighbors: p.neighbors.slice(),
        seaLinks: [],
        fort: p.fort || 0, infra: p.infra || 3, rail: p.rail || 1,
        airbase: p.hasAirbase ? 2 : (p.coastal || p.vp > 0 ? 1 : 0),
        pop: Math.round((p.population || 0) * 100) / 100, // 百万（map-generated 已是百万）
        resource: Object.assign({ oil: 0, rubber: 0, steel: 0, aluminum: 0, tungsten: 0, chromium: 0 }, p.resource),
        occupiedBy: null, resistance: 0, compliance: 1,
        supply: 1, battleId: null, camp: false,
        buildings: { civ: p.buildings.civ || 0, mil: p.buildings.mil || 0, dock: p.buildings.dock || 0 },
      };
      w.provinces.push(prov);
    }
    World.byId = {};
    for (const p of w.provinces) World.byId[p.id] = p;

    // 海上邻接：共享同一海格的两省互为 seaLinks
    const seaMap = {};
    for (const p of w.provinces) {
      const src = MD.provinces[p.id];
      for (const cell of (src.seaNeighbors || [])) {
        (seaMap[cell] = seaMap[cell] || []).push(p.id);
      }
    }
    for (const cell in seaMap) {
      const list = seaMap[cell];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = World.byId[list[i]], b = World.byId[list[j]];
          if (a.seaLinks.indexOf(b.id) < 0) a.seaLinks.push(b.id);
          if (b.seaLinks.indexOf(a.id) < 0) b.seaLinks.push(a.id);
        }
      }
    }

    // ---- 国家 ----
    for (const tag in PSE.COUNTRIES) initCountry(w, PSE.COUNTRIES[tag]);
    for (const p of w.provinces) {
      const c = w.countries[p.owner];
      if (c && p.id === c.capital) { p.isCapital = true; }
    }
    for (const tag in w.countries) distributeFactories(w, w.countries[tag]);
    World.recomputeVP(w);

    // ---- 初始兵力（历史现役，免费） ----
    for (const tag in PSE.COUNTRIES) {
      const def = PSE.COUNTRIES[tag];
      const c = w.countries[tag];
      const owned = w.provinces.filter((p) => p.owner === tag);
      if (!owned.length) continue;
      const border = owned.filter((p) => p.neighbors.some((n) => {
        const q = World.byId[n];
        return q && q.owner !== tag && q.owner !== 'NEU';
      }));
      const pool = border.length ? border : owned;
      let idx = 0;
      for (const [tplId, count] of (def.army || [])) {
        for (let i = 0; i < count; i++) {
          const loc = pool[idx % pool.length];
          idx++;
          World.createDivision(w, tag, tplId, loc.id, { free: true });
        }
      }
      initEconomy(w, tag, def);
      initAir(w, tag, def);
    }

    // ---- 预设阵营 ----
    w.factions = { allies: ['ENG', 'FRA'], comintern: ['SOV'] };
    w.countries.ENG.faction = 'allies';
    w.countries.FRA.faction = 'allies';
    w.countries.SOV.faction = 'comintern';

    // ---- 初始国策候选 ----
    for (const tag in w.countries) {
      const c = w.countries[tag];
      const tree = PSE.FOCUS_TREES[c.focusTree] || PSE.FOCUS_TREES.generic;
      if (tree && tree.nodes.length) c.focus = { current: null, progress: 0, candidate: tree.nodes[0].id };
    }

    // ---- 初始关系 ----
    relate(w, 'GER', 'ITA', 40); relate(w, 'GER', 'POL', -30); relate(w, 'GER', 'FRA', -60);
    relate(w, 'GER', 'ENG', -30); relate(w, 'GER', 'SOV', -40); relate(w, 'GER', 'CZE', -40);
    relate(w, 'FRA', 'ENG', 60); relate(w, 'FRA', 'POL', 40); relate(w, 'FRA', 'CZE', 50);
    relate(w, 'ENG', 'POL', 30); relate(w, 'SOV', 'FIN', -50);
    relate(w, 'SOV', 'BAL', -40); relate(w, 'SOV', 'POL', -60);
    relate(w, 'GRE', 'ITA', -30); relate(w, 'YUG', 'ITA', -30); relate(w, 'SOV', 'ROM', -20);

    // 难度修正：AI 获得加成，玩家按难度调整
    const diff = PSE.DIFFICULTY && PSE.DIFFICULTY[opts.difficulty || 'standard'];
    if (diff) {
      w.difficulty = opts.difficulty || 'standard';
      for (const tag in w.countries) {
        const c = w.countries[tag];
        const bonus = tag === w.playerTag ? diff.playerBonus : diff.aiBonus;
        if (!bonus) continue;
        addToMods(c, 'civOutput', bonus * 0.5);
        addToMods(c, 'milOutput', bonus * 0.5);
        addToMods(c, 'orgMul', bonus * 0.3);
      }
    }
    // 剧本（1936 / 1939）
    if (opts.scenario && PSE.applyScenario) PSE.applyScenario(w, opts.scenario);

    w.hour = w.hour || 0;
    w.rng = new PSE.RNG(w.rngSeed);
    return w;
  };

  function relate(w, a, b, v) {
    if (w.countries[a] && w.countries[b]) {
      w.countries[a].relations[b] = v;
      w.countries[b].relations[a] = v;
    }
  }

  // ============================================================
  // 序列化
  // ============================================================
  World.serialize = function (w) { return JSON.stringify(w); };
  World.deserialize = function (json) {
    const w = JSON.parse(json);
    World.byId = {};
    for (const p of w.provinces) World.byId[p.id] = p;
    // 重挂 RNG 原型（JSON 只保留 s0/s1 数值）
    if (w.rng) w.rng = Object.assign(new PSE.RNG(w.rngSeed), w.rng);
    else w.rng = new PSE.RNG(w.rngSeed);
    // 自定义模板回填到全局表（computeTemplate 依赖）
    if (w.templates) for (const id in w.templates) PSE.TEMPLATES[id] = w.templates[id];
    for (const t in w.countries) {
      const c = w.countries[t];
      c.modifiers = c.modifiers || { softMul: 1, hardMul: 1, defMul: 1, brkMul: 1, orgMul: 1 };
      c.mods = c.mods || {};
      c.trades = c.trades || [];
      c.airWings = c.airWings || [];
    }
    return w;
  };
})(typeof window !== 'undefined' ? window : globalThis);
