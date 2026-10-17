/* PSE · 扩展系统 II (systems2.js)
 * 补齐成熟大战略游戏的核心机制：
 *   煤炭等七资源 / 决议与民族精神 / 将领-集团军-集团军群与前线计划 /
 *   学说精通度与特种作战 / 阵营影响力与联合研究 / 外交行动 / 战后和平会议 /
 *   傀儡自制度 / 难度与剧本 / 控制台 / MOD 数据加载
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});
  const U = PSE.U;

  // ============================================================
  // 1. 煤炭（第七资源）：由工业省与钢铁产地派生，缺煤影响工厂出力
  // ============================================================
  PSE.RESOURCE_KEYS = ['coal', 'steel', 'oil', 'rubber', 'aluminum', 'tungsten', 'chromium'];
  PSE.RESOURCE_NAME_CN = {
    coal: '煤炭', steel: '钢铁', oil: '石油', rubber: '橡胶',
    aluminum: '铝', tungsten: '钨', chromium: '铬',
  };
  PSE.Coal = {
    /** 每日煤炭产出：基础 + 钢铁产地加成 + 基建 */
    produce: function (w, c) {
      let coal = 0;
      for (const p of w.provinces) {
        if (p.controller !== c.tag) continue;
        const steel = (p.resource && p.resource.steel) || 0;
        const urban = (p.buildings && (p.buildings.civ + p.buildings.mil)) || 0;
        coal += 1.2 + steel * 0.8 + urban * 0.5 + (p.infra || 0) * 0.3;
      }
      return coal;
    },
  };

  // ============================================================
  // 2. 决议与民族精神
  // ============================================================
  PSE.DECISIONS = [
    { id: 'DEC_rearmament', name: '紧急重整军备', cost: 75, days: 60, cooldown: 365,
      effects: [{ op: 'equip', id: 'infantry_equipment_1', n: 4000 }, { op: 'ws', v: 0.05 }],
      desc: '全国工厂转入军需生产，快速补充步兵装备' },
    { id: 'DEC_general_mobilization', name: '全国总动员', cost: 150, days: 90, cooldown: 720,
      effects: [{ op: 'manpower', v: 250 }, { op: 'mod', key: 'conscription', v: 1 }, { op: 'stab', v: -0.05 }],
      desc: '扩大征兵范围，稳定度小幅下降' },
    { id: 'DEC_war_bonds', name: '发行战争公债', cost: 60, days: 45, cooldown: 365,
      effects: [{ op: 'pp', v: 80 }, { op: 'mod', key: 'civOutput', v: 0.05 }],
      desc: '举债扩充财政，短期获得大量政治点' },
    { id: 'DEC_fortify_border', name: '边境筑垒工程', cost: 90, days: 120, cooldown: 999,
      effects: [{ op: 'fort', v: 2 }, { op: 'mod', key: 'defMul', v: 0.08 }],
      desc: '在首都与边境修建永备工事' },
    { id: 'DEC_industrial_push', name: '工业突击建设', cost: 100, days: 150, cooldown: 720,
      effects: [{ op: 'factory', kind: 'civ', n: 4 }],
      desc: '集中资源新建民用工厂' },
    { id: 'DEC_army_reform', name: '军事改革', cost: 120, days: 120, cooldown: 720,
      effects: [{ op: 'mod', key: 'orgMul', v: 0.06 }, { op: 'mod', key: 'defMul', v: 0.05 }],
      desc: '整顿指挥体系，提升组织度与防御' },
    { id: 'DEC_propaganda', name: '战时宣传运动', cost: 50, days: 40, cooldown: 365,
      effects: [{ op: 'ws', v: 0.10 }, { op: 'stab', v: 0.05 }],
      desc: '提高战争支持度与稳定度' },
    { id: 'DEC_oil_rationing', name: '燃料配给制', cost: 40, days: 30, cooldown: 365,
      effects: [{ op: 'mod', key: 'resourceFactor', v: 0.08 }],
      desc: '配给燃料，缓解资源短缺' },
    { id: 'DEC_research_funding', name: '科研拨款', cost: 80, days: 60, cooldown: 720,
      effects: [{ op: 'mod', key: 'researchSpeed', v: 0.06 }],
      desc: '增加科研经费，加速研究' },
    { id: 'DEC_draft_dogs', name: '征用民用车辆', cost: 35, days: 30, cooldown: 365,
      effects: [{ op: 'equip', id: 'motorized_equipment', n: 1500 }],
      desc: '征用民间卡车补充后勤' },
  ];

  PSE.SPIRITS = {
    SPI_war_economy: { name: '战时经济体制', mods: { milOutput: 0.10, consumerGoods: -0.05 }, desc: '军工产出 +10%，消费品 −5%' },
    SPI_total_mobilization: { name: '总动员状态', mods: { conscription: 1, orgMul: 0.05 }, desc: '征兵上限提升，组织度 +5%' },
    SPI_veteran_army: { name: '百战之师', mods: { brkMul: 0.08, orgMul: 0.05 }, desc: '突破 +8%，组织度 +5%' },
    SPI_fortress_nation: { name: '堡垒国家', mods: { defMul: 0.12 }, desc: '防御 +12%' },
    SPI_scientific_boom: { name: '科研黄金期', mods: { researchSpeed: 0.10 }, desc: '科研速度 +10%' },
    SPI_war_exhaustion: { name: '战争疲惫', mods: { civOutput: -0.10, stab: -0.05 }, desc: '民用产出 −10%（负面精神）' },
    SPI_occupation_burden: { name: '占领负担', mods: { consumerGoods: 0.05 }, desc: '消费品 +5%（负面精神）' },
  };

  const Decisions = (PSE.Decisions = {}) as any;
  Decisions.available = function (w, c, def) {
    if (!c.decisions) c.decisions = {};
    const st = c.decisions[def.id];
    if (st && w.hour - st.h < def.cooldown * 24) return false;
    if (c.pp < def.cost) return false;
    return true;
  };
  Decisions.start = function (w, c, id) {
    const def = PSE.DECISIONS.find((d) => d.id === id);
    if (!def || !Decisions.available(w, c, def)) return false;
    c.pp -= def.cost;
    c.decisions = c.decisions || {};
    c.decisions[id] = { h: w.hour, progress: 0, days: def.days };
    PSE.log(w, c.name + ' 启动决议：' + def.name, 'pol', c.tag);
    return true;
  };
  Decisions.daily = function (w) {
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated) continue;
      for (const id in (c.decisions || {})) {
        const st = c.decisions[id];
        if (st.done) continue;
        st.progress += 1;
        if (st.progress >= st.days) {
          const def = PSE.DECISIONS.find((d) => d.id === id);
          if (def) {
            for (const e of def.effects) PSE.World.execEffect(w, c, e, 'decision');
            PSE.log(w, c.name + ' 完成决议：' + def.name, 'pol', c.tag);
          }
          st.done = true;
        }
      }
    }
  };
  Decisions.addSpirit = function (w, c, id, days) {
    c.spirits = c.spirits || [];
    const def = PSE.SPIRITS[id];
    if (!def) return false;
    c.spirits.push({ id, from: w.hour, until: days ? w.hour + days * 24 : null });
    for (const k in def.mods) {
      if (k === 'stab') c.stability = U.clamp(c.stability + def.mods[k], 0, 1);
      else PSE.World.execEffect(w, c, { op: 'mod', key: k, v: def.mods[k] }, 'spirit');
    }
    PSE.log(w, c.name + ' 获得民族精神：' + def.name, 'pol', c.tag);
    return true;
  };
  Decisions.tickSpirits = function (w) {
    for (const t in w.countries) {
      const c = w.countries[t];
      if (!c.spirits) continue;
      for (const s of c.spirits.slice()) {
        if (s.until && w.hour >= s.until) {
          const def = PSE.SPIRITS[s.id];
          if (def) for (const k in def.mods) {
            if (k !== 'stab') PSE.World.execEffect(w, c, { op: 'mod', key: k, v: -def.mods[k] }, 'spirit');
          }
          c.spirits = c.spirits.filter((x) => x !== s);
        }
      }
    }
  };

  // ============================================================
  // 3. 将领 / 集团军 / 集团军群 / 前线计划
  // ============================================================
  PSE.TRAITS = {
    infantry_leader: { name: '步兵将领', mods: { orgMul: 0.05 }, desc: '步兵组织度 +5%' },
    panzer_leader: { name: '装甲将领', mods: { brkMul: 0.10 }, desc: '突破 +10%' },
    defensive: { name: '防御大师', mods: { defMul: 0.10 }, desc: '防御 +10%' },
    offensive: { name: '攻势大师', mods: { softMul: 0.08 }, desc: '软攻 +8%' },
    logistician: { name: '后勤专家', mods: { supplyRange: 2 }, desc: '补给范围 +2' },
    organizer: { name: '组织者', mods: { orgMul: 0.08 }, desc: '组织度 +8%' },
    trickster: { name: '诡道', mods: { speedMul: 0.10 }, desc: '行军速度 +10%' },
    naval_leader: { name: '海军将领', mods: { navalAtk: 0.10 }, desc: '海军攻击 +10%' },
    air_leader: { name: '空军将领', mods: { airAtk: 0.10 }, desc: '空军攻击 +10%' },
    engineer: { name: '工兵专家', mods: { defMul: 0.05, brkMul: 0.05 }, desc: '防御与突破各 +5%' },
  };
  const FIRST_NAMES = {
    GER: ['冯·博克', '曼施坦因', '古德里安', '隆美尔', '伦德施泰特', '莫德尔'],
    SOV: ['朱可夫', '罗科索夫斯基', '科涅夫', '华西列夫斯基', '崔可夫', '铁木辛哥'],
    ENG: ['蒙哥马利', '亚历山大', '奥金莱克', '韦维尔', '布鲁克', '佩吉特'],
    FRA: ['甘末林', '魏刚', '戴高乐', '朱安', '勒克莱尔', '塔西尼'],
    ITA: ['格拉齐亚尼', '巴多格里奥', '梅塞', '安布罗西奥', '里卡尔迪'],
    USA: ['艾森豪威尔', '巴顿', '布莱德雷', '麦克阿瑟', '马歇尔', '克拉克'],
    JAP: ['山下奉文', '冈村宁次', '东条英机', '今村均', '寺内寿一', '牛岛满'],
    CHI: ['白崇禧', '薛岳', '卫立煌', '李宗仁', '杜聿明', '孙立人'],
    POL: ['雷兹-希米格维', '安德斯', '索斯恩科夫斯基'],
    TUR: ['恰克马克', '厄兹代米尔'],
    BRA: ['蒙泰罗', '杜特拉'],
  };
  const DEFAULT_NAMES = ['第一军司令', '第二军司令', '第三军司令', '第四军司令'];

  const Army = (PSE.Army = {}) as any;
  Army.ensure = function (w, c) {
    // 一旦初始化过就只补空数组：玩家可能把集团军全解散，不能被 ensure 又造回来
    if (c.armiesInit || (c.armies && c.armies.length)) {
      c.armies = c.armies || [];
      c.generals = c.generals || [];
      c.armiesInit = true;
      return;
    }
    c.armiesInit = true;
    const pool = FIRST_NAMES[c.tag] || DEFAULT_NAMES;
    c.armies = [];
    c.generals = c.generals || [];
    const n = Math.max(1, Math.min(4, Math.ceil(c.divisions.length / 12)));
    for (let i = 0; i < n; i++) {
      const traitKeys = Object.keys(PSE.TRAITS);
      const traits = [traitKeys[(i * 3 + c.tag.length) % traitKeys.length]];
      const g = {
        id: i + 1, name: pool[i % pool.length],
        attack: 2 + (i % 3), defense: 2 + ((i + 1) % 3), planning: 2 + (i % 2),
        level: 1, xp: 0, traits,
      };
      c.generals.push(g);
      c.armies.push({ id: i + 1, name: (i + 1) + ' 集团军', generalId: g.id, divisions: [], order: 'hold', orderTarget: null, plan: 0 });
    }
  };
  Army.assign = function (w, c) {
    Army.ensure(w, c);
    if (!c.armies.length) return;
    let i = 0;
    for (const id of c.divisions) {
      const d = w.divisions.find((x) => x.id === id);
      if (!d) continue;
      if (d.army || d.armyManual) continue;      // 手动编成（编入/调出过）不再被自动编组动
      const a = c.armies[i % c.armies.length];
      d.army = a.id;
      a.divisions.push(d.id);
      i++;
    }
  };
  // ---------- 集团军自定义：数量、名称、将领、编成 ----------
  /** 新生成一名将领（先用国家专属名字池，用尽后按序号命名） */
  Army.newGeneral = function (w, c) {
    c.generals = c.generals || [];
    const pool = FIRST_NAMES[c.tag] || DEFAULT_NAMES;
    const used = {};
    for (const g of c.generals) used[g.name] = true;
    let name = null;
    for (const n of pool) if (!used[n]) { name = n; break; }
    if (!name) name = '第' + (c.generals.length + 1) + '军司令';
    const i = c.generals.length;
    const traitKeys = Object.keys(PSE.TRAITS);
    const g = {
      id: (c.generalSeq = Math.max(c.generalSeq || 0, i) + 1),
      name: name,
      attack: 2 + (i % 3), defense: 2 + ((i + 1) % 3), planning: 2 + (i % 2),
      level: 1, xp: 0, traits: [traitKeys[(i * 3 + c.tag.length) % traitKeys.length]],
    };
    c.generals.push(g);
    return g;
  };
  /** 新建集团军（自动配一名新将领），数量不设上限 */
  Army.add = function (w, c, name) {
    Army.ensure(w, c);
    const g = Army.newGeneral(w, c);
    let maxId = 0;
    for (const a of c.armies) maxId = Math.max(maxId, a.id || 0);
    const id = (c.armySeq = Math.max(c.armySeq || 0, maxId) + 1);
    const a = {
      id, name: (name && String(name).trim()) || (id + ' 集团军'), generalId: g.id,
      divisions: [], order: 'hold', orderTarget: null, plan: 0,
    };
    c.armies.push(a);
    return a;
  };
  /** 把某个师从它所属的集团军里摘出来 */
  Army.detach = function (w, c, d) {
    for (const a of (c.armies || [])) {
      const i = a.divisions.indexOf(d.id);
      if (i >= 0) a.divisions.splice(i, 1);
    }
    d.army = null;
  };
  /** 解散集团军：下辖部队变为待编（并标记为手动，避免立刻被自动编回） */
  Army.remove = function (w, c, armyId) {
    const a = (c.armies || []).find((x) => x.id === armyId);
    if (!a) return false;
    for (const id of a.divisions.slice()) {
      const d = w.divisions.find((x) => x.id === id);
      if (d) { d.army = null; d.armyManual = 1; }
    }
    c.armies = c.armies.filter((x) => x.id !== armyId);
    return true;
  };
  /** 编成：把这些师编入指定集团军（自动从原集团军调出），返回实际编入数 */
  Army.setDivisions = function (w, c, armyId, ids) {
    Army.ensure(w, c);
    const a = (c.armies || []).find((x) => x.id === armyId);
    if (!a) return 0;
    let n = 0;
    for (const id of (ids || [])) {
      const d = w.divisions.find((x) => x.id === id);
      if (!d || d.tag !== c.tag) continue;
      if (d.army !== armyId) {
        Army.detach(w, c, d);
        d.army = armyId;
      }
      if (a.divisions.indexOf(d.id) < 0) a.divisions.push(d.id);
      d.armyManual = 1;
      n++;
    }
    return n;
  };
  /** 把这些师从所属集团军调出（变为待编，并标记手动） */
  Army.releaseDivisions = function (w, c, ids) {
    let n = 0;
    for (const id of (ids || [])) {
      const d = w.divisions.find((x) => x.id === id);
      if (!d || d.tag !== c.tag) continue;
      Army.detach(w, c, d);
      d.armyManual = 1;
      n++;
    }
    return n;
  };
  Army.rename = function (w, c, armyId, name) {
    const a = (c.armies || []).find((x) => x.id === armyId);
    const nm = String(name == null ? '' : name).trim();
    if (!a || !nm) return false;
    a.name = nm.slice(0, 24);
    return true;
  };
  /** 换将（generalId=0 表示无将领） */
  Army.setGeneral = function (w, c, armyId, generalId) {
    const a = (c.armies || []).find((x) => x.id === armyId);
    if (!a) return false;
    const gid = +generalId || 0;
    if (gid && !(c.generals || []).some((g) => g.id === gid)) return false;
    a.generalId = gid;
    return true;
  };
  /** 自动补齐：清掉手动标记，把待编部队按现有集团军轮流编入 */
  Army.autoFill = function (w, c) {
    for (const id of c.divisions) {
      const d = w.divisions.find((x) => x.id === id);
      if (d) delete d.armyManual;
    }
    Army.assign(w, c);
    return (c.armies || []).reduce((s, a) => s + a.divisions.length, 0);
  };
  Army.modifiers = function (c, armyId) {
    const a = (c.armies || []).find((x) => x.id === armyId);
    if (!a) return { softMul: 1, defMul: 1, brkMul: 1, orgMul: 1, speedMul: 1 };
    const g = (c.generals || []).find((x) => x.id === a.generalId);
    const m = { softMul: 1, defMul: 1, brkMul: 1, orgMul: 1, speedMul: 1 };
    if (g) {
      m.softMul += g.attack * 0.01 + g.level * 0.005;
      m.defMul += g.defense * 0.01 + g.level * 0.005;
      for (const t of g.traits) {
        const td = PSE.TRAITS[t];
        if (!td) continue;
        for (const k in td.mods) {
          if (k in m) m[k] += td.mods[k];
        }
      }
    }
    return m;
  };
  Army.xp = function (w, c, armyId, amount) {
    const a = (c.armies || []).find((x) => x.id === armyId);
    if (!a) return;
    const g = (c.generals || []).find((x) => x.id === a.generalId);
    if (!g) return;
    g.xp += amount;
    while (g.xp >= 100) {
      g.xp -= 100;
      g.level += 1;
      if (g.level % 2 === 0) {
        const pool = Object.keys(PSE.TRAITS).filter((t) => g.traits.indexOf(t) < 0);
        if (pool.length) {
          const pick = pool[(g.level + c.tag.length) % pool.length];
          g.traits.push(pick);
          PSE.log(w, g.name + ' 获得特质：' + PSE.TRAITS[pick].name, 'army', c.tag);
        }
      }
    }
  };
  /** 前线计划：hold=原地防守，advance=向敌控邻省推进，blitz=无视损失强攻 */
  Army.tick = function (w) {
    for (const t in w.countries) {
      const c = w.countries[t];
      if (c.capitulated || !c.armies) continue;
      for (const a of c.armies) {
        if (a.order === 'hold' || !a.divisions.length) continue;
        const myDivs = a.divisions.map((id) => w.divisions.find((d) => d.id === id)).filter(Boolean);
        const byLoc = {};
        for (const d of myDivs) (byLoc[d.loc] = byLoc[d.loc] || []).push(d);
        for (const loc in byLoc) {
          const list = byLoc[loc];
          const p = w.provinces[loc];
          if (!p) continue;
          const ready = list.filter((d) => d.battleId == null && d.status === 'idle'
            && d.org > d.orgMax * d.str * (a.order === 'blitz' ? 0.5 : 0.7));
          if (!ready.length) continue;
          let target = null, bestDef = 1e9;
          for (const nb of p.neighbors) {
            const q = w.provinces[nb];
            if (!q) continue;
            if (!PSE.World.areAtWar(w, t, q.controller)) continue;
            const defs = w.divisions.filter((d) => d.loc === nb && PSE.World.areAtWar(w, t, d.tag)).length;
            if (defs < bestDef) { bestDef = defs; target = nb; }
          }
          if (target == null) continue;
          const ratio = ready.length / (bestDef + 0.5);
          const need = a.order === 'blitz' ? 1.0 : 1.4;
          if (ratio >= need) {
            PSE.Sim.orderMove(w, ready, target);
            a.plan = Math.min(100, (a.plan || 0) + 5);
          }
        }
      }
    }
  };

  // ============================================================
  // 4. 学说精通度 + 特种作战路线
  // ============================================================
  PSE.DOCTRINE_TREES = {
    grand: {
      mobile: { name: '机动战争', nodes: [
        { id: 'DOC_mob_1', name: '装甲集群', cost: 100, mods: { brkMul: 0.10 } },
        { id: 'DOC_mob_2', name: '闪电战', cost: 200, req: ['DOC_mob_1'], mods: { speedMul: 0.15, orgMul: 0.05 } },
        { id: 'DOC_mob_3', name: '大纵深作战', cost: 350, req: ['DOC_mob_2'], mods: { brkMul: 0.15, widthMul: 0.10 } },
      ] },
      firepower: { name: '火力战争', nodes: [
        { id: 'DOC_fire_1', name: '炮兵协同', cost: 100, mods: { softMul: 0.10 } },
        { id: 'DOC_fire_2', name: '徐进弹幕', cost: 200, req: ['DOC_fire_1'], mods: { softMul: 0.12, supportMul: 0.5 } },
        { id: 'DOC_fire_3', name: '联合火力', cost: 350, req: ['DOC_fire_2'], mods: { softMul: 0.15, casBonus: 0.15 } },
      ] },
      mass: { name: '人海战争', nodes: [
        { id: 'DOC_mass_1', name: '大规模征兵', cost: 100, mods: { manpowerLoss: -0.15 } },
        { id: 'DOC_mass_2', name: '人海冲锋', cost: 200, req: ['DOC_mass_1'], mods: { widthMul: 0.15, orgMul: 0.05 } },
        { id: 'DOC_mass_3', name: '全民皆兵', cost: 350, req: ['DOC_mass_2'], mods: { manpowerLoss: -0.25, defMul: 0.10 } },
      ] },
      superior: { name: '优质火力', nodes: [
        { id: 'DOC_sup_1', name: '精确射击', cost: 100, mods: { hardMul: 0.10 } },
        { id: 'DOC_sup_2', name: '合成兵种', cost: 200, req: ['DOC_sup_1'], mods: { defMul: 0.12, orgMul: 0.05 } },
        { id: 'DOC_sup_3', name: '诸兵种协同', cost: 350, req: ['DOC_sup_2'], mods: { softMul: 0.10, hardMul: 0.10, planningMul: 0.20 } },
      ] },
    },
    special: {
      mountaineers: { name: '山地兵', nodes: [
        { id: 'SF_mtn_1', name: '山地训练', cost: 80, mods: { defMul: 0.08 } },
        { id: 'SF_mtn_2', name: '高山作战', cost: 160, req: ['SF_mtn_1'], mods: { speedMul: 0.10, orgMul: 0.05 } },
      ] },
      marines: { name: '海军陆战队', nodes: [
        { id: 'SF_mar_1', name: '两栖训练', cost: 80, mods: { navalInvasion: 0.15 } },
        { id: 'SF_mar_2', name: '滩头突破', cost: 160, req: ['SF_mar_1'], mods: { brkMul: 0.10 } },
      ] },
      paratroopers: { name: '伞兵', nodes: [
        { id: 'SF_par_1', name: '空降训练', cost: 90, mods: { orgMul: 0.05 } },
        { id: 'SF_par_2', name: '垂直包围', cost: 180, req: ['SF_par_1'], mods: { brkMul: 0.12, speedMul: 0.10 } },
      ] },
      rangers: { name: '游骑兵', nodes: [
        { id: 'SF_rng_1', name: '突击训练', cost: 80, mods: { softMul: 0.06 } },
        { id: 'SF_rng_2', name: '纵深渗透', cost: 160, req: ['SF_rng_1'], mods: { speedMul: 0.12 } },
      ] },
    },
  };

  const Doctrine = (PSE.Doctrine = {}) as any;
  Doctrine.ensure = function (c) {
    if (!c.mastery) {
      c.mastery = { mobile: 0, firepower: 0, mass: 0, superior: 0, special: { mountaineers: 0, marines: 0, paratroopers: 0, rangers: 0 } };
      c.doctrineNodes = [];
      c.grandDoctrine = null;
    }
  };
  Doctrine.gainMastery = function (w, c, kind, amount) {
    Doctrine.ensure(c);
    if (kind === 'special') return;
    c.mastery[kind] = U.clamp((c.mastery[kind] || 0) + amount, 0, 100);
  };
  Doctrine.gainSpecial = function (w, c, path, amount) {
    Doctrine.ensure(c);
    c.mastery.special[path] = U.clamp((c.mastery.special[path] || 0) + amount, 0, 100);
  };
  Doctrine.available = function (c, node) {
    Doctrine.ensure(c);
    if (c.doctrineNodes.indexOf(node.id) >= 0) return false;
    if (node.req) for (const r of node.req) if (c.doctrineNodes.indexOf(r) < 0) return false;
    return true;
  };
  Doctrine.buy = function (w, c, nodeId) {
    Doctrine.ensure(c);
    let node = null, tree = null;
    for (const tk in PSE.DOCTRINE_TREES) {
      for (const bk in PSE.DOCTRINE_TREES[tk]) {
        const found = PSE.DOCTRINE_TREES[tk][bk].nodes.find((n) => n.id === nodeId);
        if (found) { node = found; tree = { tk, bk }; break; }
      }
      if (node) break;
    }
    if (!node || !Doctrine.available(c, node)) return false;
    // 大战略互斥：选定一条后不能改
    if (tree.tk === 'grand') {
      if (c.grandDoctrine && c.grandDoctrine !== tree.bk) return false;
      c.grandDoctrine = tree.bk;
    }
    const cost = node.cost;
    if ((c.armyXp || 0) < cost) return false;
    c.armyXp -= cost;
    c.doctrineNodes.push(nodeId);
    for (const k in node.mods) PSE.World.execEffect(w, c, { op: 'mod', key: k, v: node.mods[k] }, 'doctrine');
    PSE.log(w, c.name + ' 解锁学说：' + node.name, 'tech', c.tag);
    return true;
  };

  // ============================================================
  // 5. 阵营机制：影响力、倡议点数、联合研究
  // ============================================================
  const Faction = (PSE.Faction = {}) as any;
  Faction.ensure = function (w, id) {
    if (!w.factions[id]) return null;
    w.factionData = w.factionData || {};
    if (!w.factionData[id]) {
      w.factionData[id] = { leader: w.factions[id][0], influence: {}, initiative: 0, jointResearch: 0 };
    }
    return w.factionData[id];
  };
  Faction.daily = function (w) {
    w.factionData = w.factionData || {};
    for (const id in w.factions) {
      const d = Faction.ensure(w, id);
      if (!d) continue;
      const members = w.factions[id];
      if (!members.length) continue;
      d.leader = d.leader && members.indexOf(d.leader) >= 0 ? d.leader : members[0];
      // 影响力：按工业与军力分配
      for (const t of members) {
        const c = w.countries[t];
        if (!c) continue;
        d.influence[t] = (d.influence[t] || 0) + c.factories.civ * 0.02 + c.factories.mil * 0.03 + PSE.AI.armyPower(w, c) * 0.0005;
      }
      d.initiative = (d.initiative || 0) + members.length * 0.2;
      // 联合研究：成员国科研速度加成随阵营规模增长（上限 +8%）
      d.jointResearch = Math.min(0.08, members.length * 0.015);
      for (const t of members) {
        const c = w.countries[t];
        if (!c) continue;
        c.mods.factionResearch = d.jointResearch;
      }
    }
  };
  Faction.influenceOf = function (w, id, tag) {
    const d = w.factionData && w.factionData[id];
    if (!d) return 0;
    const total = Object.keys(d.influence).reduce((s, k) => s + d.influence[k], 0) || 1;
    return (d.influence[tag] || 0) / total;
  };

  // ============================================================
  // 6. 外交行动
  // ============================================================
  PSE.Cmd.improveRelations = function (w, tag) {
    const c = w.countries[w.playerTag];
    const o = w.countries[tag];
    if (!c || !o) return { ok: false, msg: '目标不存在' };
    const cost = 25;
    if (c.pp < cost) return { ok: false, msg: '政治点不足（需要 25）' };
    c.pp -= cost;
    c.relations[tag] = U.clamp((c.relations[tag] || 0) + 20, -200, 200);
    o.relations[c.tag] = U.clamp((o.relations[c.tag] || 0) + 15, -200, 200);
    PSE.log(w, c.name + ' 改善与 ' + o.name + ' 的关系', 'diplo', c.tag);
    return { ok: true, msg: '关系 +20' };
  };
  PSE.Cmd.inviteToFaction = function (w, tag) {
    const c = w.countries[w.playerTag];
    const o = w.countries[tag];
    if (!c || !o) return { ok: false, msg: '目标不存在' };
    if (!c.faction) return { ok: false, msg: '你需要先加入或创建阵营' };
    if (o.faction === c.faction) return { ok: false, msg: '已在同一阵营' };
    const rel = c.relations[tag] || 0;
    const bonus = (c.mods.factionInvite || 0) * 20;
    if (rel + bonus < 30) return { ok: false, msg: '关系不足（需 ≥30，当前 ' + Math.round(rel) + '）' };
    if (o.faction && o.faction !== c.faction) return { ok: false, msg: o.name + ' 已属于其他阵营' };
    o.faction = c.faction;
    (w.factions[c.faction] = w.factions[c.faction] || []).push(tag);
    PSE.log(w, o.name + ' 加入阵营', 'diplo', c.tag);
    return { ok: true, msg: o.name + ' 已加入你的阵营' };
  };
  PSE.Cmd.nonAggression = function (w, tag) {
    const c = w.countries[w.playerTag];
    const o = w.countries[tag];
    if (!c || !o) return { ok: false, msg: '目标不存在' };
    if (PSE.World.isPact(w, c.tag, tag)) return { ok: false, msg: '已有效' };
    if ((c.relations[tag] || 0) < 0) return { ok: false, msg: '关系为负，对方拒绝' };
    c.pacts.push(tag); o.pacts.push(c.tag);
    PSE.log(w, c.name + ' 与 ' + o.name + ' 签订互不侵犯条约', 'diplo', c.tag);
    return { ok: true, msg: '互不侵犯条约已签订' };
  };
  PSE.Cmd.guarantee = function (w, tag) {
    const c = w.countries[w.playerTag];
    if (!c || !w.countries[tag]) return { ok: false, msg: '目标不存在' };
    if (c.guarantees.indexOf(tag) >= 0) return { ok: false, msg: '已提供保护' };
    if (c.pp < 30) return { ok: false, msg: '政治点不足（需要 30）' };
    c.pp -= 30;
    c.guarantees.push(tag);
    PSE.log(w, c.name + ' 保证 ' + w.countries[tag].name + ' 的独立', 'diplo', c.tag);
    return { ok: true, msg: '已提供独立保证' };
  };

  // ============================================================
  // 7. 战后和平会议（简化版：按战争贡献分配处置权）
  // ============================================================
  const Peace = (PSE.Peace = {}) as any;
  Peace.open = function (w, war, defeated) {
    // 参战方按战争贡献排序（用占领的敌国省份数近似）
    const winners = (war.attackers.concat(war.defenders)).filter((t) => t !== defeated && !w.countries[t].capitulated);
    const scored = winners.map((t) => {
      const occ = w.provinces.filter((p) => p.owner === defeated && p.controller === t).length;
      return { t, occ };
    }).sort((a, b) => b.occ - a.occ);
    if (!scored.length) return null;
    const main = scored[0].t;
    w.peaceConference = {
      defeated, main, options: scored, h: w.hour,
      playerChoice: (main === w.playerTag) ? null : 'annex',
    };
    if (main === w.playerTag) w.speed = 0;   // 等待玩家选择
    else {
      // AI 处置：吞并失败（例如已被吞并）就退一步，别让会议卡住
      for (const ch of ['annex', 'puppet', 'liberate']) if (Peace.applyEx(w, ch).ok) break;
      if (w.peaceConference) w.peaceConference = null;   // 三种都不成：清掉，避免悬挂会议
    }
    return w.peaceConference;
  };
  Peace.applyEx = function (w, choice) {
    const pc = w.peaceConference;
    if (!pc) return { ok: false, msg: '当前没有进行中的和平会议' };
    const d = w.countries[pc.defeated];
    const main = w.countries[pc.main];
    if (!d || !main) { w.peaceConference = null; return { ok: false, msg: '会议数据已失效' }; }
    let msg = '';
    if (choice === 'annex') {
      const provs = w.provinces.filter((p) => p.owner === d.tag).length;
      // 关键：检查结果，失败就不要清空会议（返回 false 让弹窗留在原地可重试）
      if (!PSE.Diplo.annexCountry(w, main.tag, d.tag)) {
        return { ok: false, msg: '吞并「' + d.name + '」失败：该国已被吞并过了' };
      }
      msg = '已吞并 ' + d.name + '（' + provs + ' 个省并入 ' + main.name + '）';
    } else if (choice === 'puppet') {
      d.capitulated = false;
      for (const p of w.provinces) if (p.owner === d.tag && p.controller === main.tag) { p.controller = d.tag; p.resistance = 25; p.compliance = 45; }
      d.puppetOf = main.tag;
      if (!main.puppets) main.puppets = [];
      if (main.puppets.indexOf(d.tag) < 0) main.puppets.push(d.tag);
      PSE.log(w, main.name + ' 扶植傀儡政权：' + d.name, 'diplo', main.tag);
      msg = '已扶植傀儡政权：' + d.name;
    } else if (choice === 'liberate') {
      d.capitulated = false;
      for (const p of w.provinces) if (p.owner === d.tag && p.controller === main.tag) { p.controller = d.tag; p.resistance = 10; }
      d.relations[main.tag] = U.clamp((d.relations[main.tag] || 0) + 60, -200, 200);
      main.relations[d.tag] = U.clamp((main.relations[d.tag] || 0) + 60, -200, 200);
      PSE.log(w, main.name + ' 恢复了 ' + d.name + ' 的独立', 'diplo', main.tag);
      msg = '已恢复 ' + d.name + ' 的独立';
    } else {
      return { ok: false, msg: '未知的处置方式：' + choice };
    }
    w.peaceConference = null;
    return { ok: true, msg };
  };
  // 布尔接口保持不变（内部调用方照旧），失败原因走 applyEx
  Peace.apply = function (w, choice) {
    return Peace.applyEx(w, choice).ok;
  };

  // ============================================================
  // 8. 傀儡自制度
  // ============================================================
  PSE.AUTONOMY = {
    puppet: { name: '傀儡国', factoryShare: 0.25, manpowerShare: 0.10 },
    protectorate: { name: '保护国', factoryShare: 0.15, manpowerShare: 0.05 },
    dominion: { name: '自治领', factoryShare: 0.10, manpowerShare: 0.15 },
  };
  PSE.Cmd.setAutonomy = function (w, tag, level) {
    const c = w.countries[w.playerTag];
    const t = w.countries[tag];
    if (!c || !t || t.puppetOf !== c.tag) return false;
    t.puppetType = level;
    PSE.log(w, c.name + ' 调整 ' + t.name + ' 的自制度：' + PSE.AUTONOMY[level].name, 'diplo', c.tag);
    return true;
  };
  const Autonomy = {
    daily: function (w) {
      for (const t in w.countries) {
        const c = w.countries[t];
        if (!c.puppetOf) continue;
        const master = w.countries[c.puppetOf];
        if (!master) continue;
        const lvl = PSE.AUTONOMY[c.puppetType] || PSE.AUTONOMY.puppet;
        // 提取工厂产出与人力
        master.puppetIncome = (master.puppetIncome || 0) + c.factories.civ * lvl.factoryShare * 0.02;
        if (c.manpower > lvl.manpowerShare * 20) {
          const take = c.manpower * lvl.manpowerShare * 0.01;
          c.manpower -= take;
          master.manpower += take;
        }
        // 宗主国参战时傀儡自动参战
        for (const war of PSE.World.warsOf(w, master.tag)) {
          const side = war.attackers.indexOf(master.tag) >= 0 ? 'attackers' : 'defenders';
          if (war[side].indexOf(t) < 0) war[side].push(t);
        }
      }
    },
  };

  // ============================================================
  // 9. 难度与剧本
  // ============================================================
  PSE.DIFFICULTY = {
    recruit: { name: '征召兵（简单）', aiBonus: -0.15, playerBonus: 0.10 },
    standard: { name: '标准', aiBonus: 0, playerBonus: 0 },
    veteran: { name: '老兵（困难）', aiBonus: 0.20, playerBonus: -0.10 },
  };
  PSE.SCENARIOS = {
    s1936: { name: '1936 · 和平的最后一年', year: 1936, month: 1, day: 1,
      desc: '德国重整军备、西班牙内战前夜。你有一整年准备时间。' },
    s1939: { name: '1939 · 战争爆发', year: 1939, month: 9, day: 1,
      desc: '德国已吞并奥地利与捷克，苏德条约已签。战争在欧洲边缘。' },
  };

  /** 1939 剧本的历史开局调整 */
  PSE.applyScenario = function (w, key) {
    if (key !== 's1939') return;
    w.hour = PSE.Time.daysFromStart(1939, 9, 1) * 24;
    // 德国已扩张
    const ger = w.countries.GER;
    if (ger) {
      ger.factories.civ += 8; ger.factories.mil += 8;
      ger.stockpile.infantry_equipment_1 = (ger.stockpile.infantry_equipment_1 || 0) + 40000;
      ger.stockpile.light_tank_1 = (ger.stockpile.light_tank_1 || 0) + 2000;
      ger.stockpile.fighter_1 = (ger.stockpile.fighter_1 || 0) + 1200;
      for (const t of ['AUT', 'CZE']) {
        const c = w.countries[t];
        if (!c) continue;
        for (const p of w.provinces) if (p.owner === t) { p.owner = 'GER'; p.controller = 'GER'; p.resistance = 5; p.compliance = 80; }
        c.capitulated = true;
        c.annexedBy = 'GER';
        c.divisions = [];
      }
      PSE.World.recomputeVP(w);
    }
    const sov = w.countries.SOV;
    if (sov) { sov.factories.civ += 10; sov.factories.mil += 12; sov.manpower *= 1.6; }
    // 苏德互不侵犯
    if (w.countries.GER && sov) { w.countries.GER.pacts.push('SOV'); sov.pacts.push('GER'); }
    // 英法对德宣战准备：保证波兰
    if (w.countries.ENG) w.countries.ENG.guarantees.push('POL');
    if (w.countries.FRA) w.countries.FRA.guarantees.push('POL');
    PSE.log(w, '剧本载入：1939 年 9 月 1 日', 'info', '');
  };

  // ============================================================
  // 10. 控制台（非铁人模式）
  // ============================================================
  const Console = (PSE.Console = {}) as any;
  Console.commands = {
    help: { desc: '列出所有命令', fn: () => ({ ok: true, msg: Object.keys(Console.commands).join(', ') }) },
    pp: { desc: 'pp <数量>：增加政治点', fn: (w, args) => { const c = w.countries[w.playerTag]; c.pp += +(args[0] || 100); return { ok: true, msg: '政治点 +' + (args[0] || 100) }; } },
    manpower: { desc: 'manpower <千>：增加人力', fn: (w, args) => { const c = w.countries[w.playerTag]; c.manpower += +(args[0] || 100); return { ok: true, msg: '人力 +' + (args[0] || 100) + 'k' }; } },
    civil: { desc: 'civil <数量>：增加民用工厂', fn: (w, args) => { const c = w.countries[w.playerTag]; c.factories.civ += +(args[0] || 5); return { ok: true, msg: '民工 +' + (args[0] || 5) }; } },
    military: { desc: 'military <数量>：增加军用工厂', fn: (w, args) => { const c = w.countries[w.playerTag]; c.factories.mil += +(args[0] || 5); return { ok: true, msg: '军工 +' + (args[0] || 5) }; } },
    equip: { desc: 'equip <装备ID> <数量>', fn: (w, args) => { PSE.World.addEquip(w, w.playerTag, args[0] || 'infantry_equipment_1', +(args[1] || 1000)); return { ok: true, msg: '已发放装备' }; } },
    research: { desc: 'research <科技ID>：立即完成', fn: (w, args) => { const c = w.countries[w.playerTag]; if (!PSE.TECHS[args[0]]) return { ok: false, msg: '未知科技' }; if (c.researched.indexOf(args[0]) < 0) { c.researched.push(args[0]); PSE.World.applyTech(w, c, args[0]); } return { ok: true, msg: '已完成 ' + PSE.TECHS[args[0]].name }; } },
    research_all: { desc: 'research_all：完成全部科技', fn: (w) => { const c = w.countries[w.playerTag]; for (const k in PSE.TECHS) if (c.researched.indexOf(k) < 0) { c.researched.push(k); PSE.World.applyTech(w, c, k); } return { ok: true, msg: '全部科技已解锁' }; } },
    instant: { desc: 'instant：瞬间完成所有建造与产线', fn: (w) => { const c = w.countries[w.playerTag]; for (const it of c.construction) it.prog = it.cost; return { ok: true, msg: '建造队列已加速（下个日界完成）' }; } },
    teleport: { desc: 'teleport <省名关键词>：选中部队瞬移', fn: (w, args) => {
      const key = (args.join('') || '').trim();
      const target = w.provinces.find((p) => key && p.name.indexOf(key) >= 0);
      if (!target) return { ok: false, msg: '未找到省份：' + key };
      const c = w.countries[w.playerTag];
      let n = 0;
      for (const id of c.divisions) { const d = w.divisions.find((x) => x.id === id); if (d) { d.loc = target.id; d.path = []; d.moveTo = null; d.status = 'idle'; n++; } }
      return { ok: true, msg: n + ' 个师已瞬移至 ' + target.name };
    } },
    switch: { desc: 'switch <国家代码>：切换玩家国家', fn: (w, args) => {
      const tag = (args[0] || '').toUpperCase();
      if (!w.countries[tag]) return { ok: false, msg: '未知国家：' + tag };
      w.playerTag = tag;
      return { ok: true, msg: '已切换为 ' + PSE.COUNTRY_NAME[tag] };
    } },
    annex: { desc: 'annex <国家代码>：吞并该国', fn: (w, args) => { const tag = (args[0] || '').toUpperCase(); if (!w.countries[tag]) return { ok: false, msg: '未知国家' }; if (tag === w.playerTag) return { ok: false, msg: '不能吞并自己' }; return PSE.Diplo.annexCountry(w, w.playerTag, tag) ? { ok: true, msg: '已吞并 ' + PSE.COUNTRY_NAME[tag] } : { ok: false, msg: PSE.COUNTRY_NAME[tag] + ' 已经被吞并过了' }; } },
    focus: { desc: 'focus <国策ID>：立即完成国策', fn: (w, args) => { const c = w.countries[w.playerTag]; const node = PSE.Sim.focusNode(c, args[0]); if (!node) return { ok: false, msg: '未知国策' }; PSE.Sim.completeFocus(w, c, node); return { ok: true, msg: '已完成 ' + node.name }; } },
    war: { desc: 'war <国家代码>：对其宣战', fn: (w, args) => { const tag = (args[0] || '').toUpperCase(); if (!w.countries[tag]) return { ok: false, msg: '未知国家' }; PSE.Diplo.declareWar(w, w.playerTag, tag, {}); return { ok: true, msg: '已对 ' + PSE.COUNTRY_NAME[tag] + ' 宣战' }; } },
    nuke: { desc: 'nuke：获得 5 枚核弹', fn: (w) => { const c = w.countries[w.playerTag]; c.nukes = (c.nukes || 0) + 5; return { ok: true, msg: '核弹 +5' }; } },
    credits: { desc: 'credits <数量>：增加工业信用点', fn: (w, args) => { const c = w.countries[w.playerTag]; c.credits += +(args[0] || 1000); return { ok: true, msg: '信用点 +' + (args[0] || 1000) }; } },
    xp: { desc: 'xp <数量>：增加陆军经验', fn: (w, args) => { const c = w.countries[w.playerTag]; c.armyXp = (c.armyXp || 0) + (+(args[0]) || 500); return { ok: true, msg: '陆军经验 +' + (+(args[0]) || 500) }; } },
  };
  Console.run = function (w, line) {
    if (w.ironman) return { ok: false, msg: '铁人模式已禁用控制台' };
    const parts = String(line || '').trim().split(/\s+/);
    const cmd = parts.shift();
    const def = Console.commands[cmd];
    if (!def) return { ok: false, msg: '未知命令：' + cmd + '（输入 help 查看）' };
    try {
      const r = def.fn(w, parts);
      return r || { ok: true, msg: '已执行' };
    } catch (e) {
      return { ok: false, msg: '执行出错：' + e.message };
    }
  };

  // ============================================================
  // 11. MOD 数据加载（外部 JSON 定义：国策/装备/事件/决议）
  // ============================================================
  PSE.Mod = {
    apply: function (w, data) {
      let n = 0;
      if (data.focusTrees) {
        for (const tree in data.focusTrees) {
          const t = PSE.FOCUS_TREES[tree] || (PSE.FOCUS_TREES[tree] = { nodes: [] });
          t.nodes = t.nodes.concat(data.focusTrees[tree]);
          n += data.focusTrees[tree].length;
        }
      }
      if (data.equipment) {
        for (const id in data.equipment) { PSE.EQUIPMENT[id] = data.equipment[id]; n++; }
      }
      if (data.events) {
        for (const id in data.events) { PSE.EVENTS[id] = data.events[id]; n++; }
      }
      if (data.decisions) {
        for (const d of data.decisions) { PSE.DECISIONS.push(d); n++; }
      }
      if (data.countries) {
        for (const tag in data.countries) {
          PSE.COUNTRIES[tag] = Object.assign(PSE.COUNTRIES[tag] || { tag }, data.countries[tag]);
          n++;
        }
      }
      w.mods = w.mods || [];
      w.mods.push({ h: w.hour, items: n });
      PSE.log(w, 'MOD 数据已加载：' + n + ' 项定义', 'info', '');
      return n;
    },
  };

  // ============================================================
  // 12. 每日/每小时总入口（由 sim 调用）
  // ============================================================
  PSE.Systems2 = {
    daily: function (w) {
      Decisions.daily(w);
      Decisions.tickSpirits(w);
      Faction.daily(w);
      Autonomy.daily(w);
      // 将领经验与集团军自动编组
      for (const t in w.countries) {
        const c = w.countries[t];
        if (c.capitulated) continue;
        Army.ensure(w, c);
        Army.assign(w, c);
        c.armyXp = (c.armyXp || 0) + c.divisions.length * 0.02 + (PSE.World.inAnyWar(w, t) ? 0.5 : 0.1);
        // 学说精通度：战斗与训练积累
        if (PSE.World.inAnyWar(w, t)) {
          Doctrine.gainMastery(w, c, 'firepower', 0.15);
          Doctrine.gainMastery(w, c, 'mobile', 0.12);
        } else {
          Doctrine.gainMastery(w, c, 'superior', 0.05);
        }
      }
      Army.tick(w);
      // 煤炭的产出/消耗/惩罚已在 sim.dailyProduction 中统一结算（这里只做兜底，避免与世界不同步）
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
