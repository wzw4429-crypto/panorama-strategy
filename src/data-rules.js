/* PSE · 规则数据 (data-rules.js)
 * 国家 / 营制 / 师团模板 / 装备 / 科技 / 国策树 / 事件
 * 加载顺序：core.js → data-rules.js → data-map.js
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});

  // ============================================================
  // 0. 全局平衡常量（改这里 = 改平衡）
  // ============================================================
  PSE.BAL = {
    BASE_CIV_OUTPUT: 5.0,      // 每民工每日建造点
    BASE_MIL_OUTPUT: 4.5,      // 每军工每日装备点
    BASE_DOCK_OUTPUT: 2.5,     // 每船坞每日造舰点
    EQUIP_EFFICIENCY_GROWTH: 0.02,
    EQUIP_EFFICIENCY_BASE: 0.10,
    EQUIP_EFFICIENCY_CAP: 1.00,
    CONSUMER_GOODS: { 0: 0.40, 1: 0.35, 2: 0.30, 3: 0.20, 4: 0.10, 5: 0.00 }, // 经济法档位
    CONSCRIPTION: { 0: 0.005, 1: 0.015, 2: 0.025, 3: 0.05, 4: 0.10 },
    PP_BASE: 1.0,              // 每日基础政治点
    MANPOWER_REGEN: 0.00035,   // 每月人口增长系数
    DIV_MANPOWER_UNIT: 1.0,    // 1.0 = 1000 人
    ORG_REGEN: 0.05,           // 每小时组织度恢复（非交战）
    ORG_REGEN_SUPPLIED: 0.06,
    HP_REGEN: 0.02,            // 每小时 HP 恢复（有装备补充时）
    SUPPLY_RANGE: 14,          // 补给传播最大跳数
    SUPPLY_DECAY: 0.94,        // 每跳衰减
    SUPPLY_FULL: 0.90, SUPPLY_PENALTY: 0.60,
    ENTRENCH_MAX: 0.30,
    TENSION_DECAY: 0.04,
    CAPITULATION_VP: 0.75,     // 丢失 75% 胜利点 → 投降
    TRAINING_DAYS: 90,
    RESISTANCE_GROWTH: 0.35,
    COMPLIANCE_GROWTH: 0.10,
  };

  // ============================================================
  // 1. 国家
  // ============================================================
  PSE.COUNTRY_NAME = {
    GER: '德国', SOV: '苏联', ENG: '英国', FRA: '法国', ITA: '意大利', POL: '波兰',
    CZE: '捷克斯洛伐克', AUS: '奥地利', HUN: '匈牙利', ROM: '罗马尼亚', YUG: '南斯拉夫',
    BUL: '保加利亚', GRE: '希腊', TUR: '土耳其', SPA: '西班牙', POR: '葡萄牙',
    SWI: '瑞士', LOW: '低地国家', DEN: '丹麦', SWE: '瑞典', NOR: '挪威', FIN: '芬兰',
    BAL: '波罗的海三国', NEU: '中立区',
  };
  PSE.IDEOLOGY_NAME = { democratic: '民主', fascist: '法西斯', communist: '共产', neutral: '中立' };
  PSE.REGIME_NAME = {
    monarchy: '君主专制', theocracy: '神权政治', military_dictatorship: '军事独裁',
    council_republic: '委员会共和', parliamentary: '议会民主', one_party: '一党专政',
    junta: '临时军政府', regency: '摄政',
  };

  function C(tag, o) {
    return Object.assign({
      tag, name: PSE.COUNTRY_NAME[tag], ideology: 'neutral', regime: 'parliamentary',
      color: '#888', capital: null, factories: { civ: 2, mil: 1, dock: 0 },
      pp: 50, stability: 0.6, warSupport: 0.4, laws: { conscription: 1, economy: 1, trade: 1, training: 1 },
      researchSlots: 3, army: [], focusTree: 'generic', ai: { aggression: 0.3, expand: 0.3 },
      faction: null, isMajor: false, tensionWeight: 1,
      templates: ['inf_9_1', 'garrison'],
    }, o);
  }

  PSE.COUNTRIES = {
    GER: C('GER', {
      ideology: 'fascist', regime: 'military_dictatorship', color: '#5b6e8c', isMajor: true,
      factories: { civ: 24, mil: 8, dock: 4 }, pp: 60, stability: 0.65, warSupport: 0.55,
      researchSlots: 4, focusTree: 'GER', tensionWeight: 2.0,
      ai: { aggression: 0.85, expand: 0.9, target: ['POL', 'FRA', 'SOV', 'CZE', 'AUS'] },
      templates: ['inf_9_1', 'inf_7_2', 'armor', 'mot', 'garrison', 'mount'],
      army: [['inf_9_1', 18], ['mot', 2], ['armor', 3], ['garrison', 2]],
    }),
    SOV: C('SOV', {
      ideology: 'communist', regime: 'one_party', color: '#a33b3b', isMajor: true,
      factories: { civ: 30, mil: 12, dock: 4 }, pp: 70, stability: 0.55, warSupport: 0.5,
      researchSlots: 4, focusTree: 'SOV', tensionWeight: 2.0,
      ai: { aggression: 0.5, expand: 0.6, target: ['FIN', 'BAL', 'POL', 'ROM'] },
      templates: ['inf_9_1', 'inf_7_2', 'armor', 'mot', 'garrison', 'mount'],
      army: [['inf_9_1', 40], ['armor', 6], ['mot', 4], ['garrison', 6], ['mount', 2]],
    }),
    ENG: C('ENG', {
      ideology: 'democratic', regime: 'parliamentary', color: '#7d5fa8', isMajor: true,
      factories: { civ: 22, mil: 7, dock: 9 }, pp: 60, stability: 0.7, warSupport: 0.35,
      researchSlots: 4, focusTree: 'ENG', tensionWeight: 1.8,
      ai: { aggression: 0.35, expand: 0.4, target: ['ITA', 'GER'] },
      templates: ['inf_9_1', 'inf_7_2', 'armor', 'mot', 'garrison', 'marine'],
      army: [['inf_9_1', 12], ['armor', 2], ['mot', 2], ['garrison', 8]],
    }),
    FRA: C('FRA', {
      ideology: 'democratic', regime: 'parliamentary', color: '#4a7fb5', isMajor: true,
      factories: { civ: 18, mil: 6, dock: 4 }, pp: 50, stability: 0.55, warSupport: 0.35,
      researchSlots: 3, focusTree: 'FRA', tensionWeight: 1.6,
      ai: { aggression: 0.25, expand: 0.3, target: ['GER', 'ITA'] },
      templates: ['inf_9_1', 'inf_7_2', 'armor', 'garrison', 'mount'],
      army: [['inf_9_1', 22], ['armor', 3], ['garrison', 6], ['mount', 2]],
    }),
    ITA: C('ITA', {
      ideology: 'fascist', regime: 'military_dictatorship', color: '#6f9e5a', isMajor: true,
      factories: { civ: 12, mil: 5, dock: 4 }, pp: 55, stability: 0.6, warSupport: 0.5,
      researchSlots: 3, focusTree: 'ITA', tensionWeight: 1.4,
      ai: { aggression: 0.7, expand: 0.75, target: ['GRE', 'YUG', 'FRA'] },
      templates: ['inf_9_1', 'inf_7_2', 'armor', 'garrison', 'mount', 'marine'],
      army: [['inf_9_1', 16], ['armor', 2], ['garrison', 4], ['mount', 3]],
    }),
    POL: C('POL', {
      ideology: 'neutral', regime: 'junta', color: '#c9c9c9', factories: { civ: 6, mil: 2, dock: 1 },
      pp: 35, stability: 0.55, warSupport: 0.5, researchSlots: 3,
      ai: { aggression: 0.2, expand: 0.2 }, templates: ['inf_9_1', 'cav', 'garrison'],
      army: [['inf_9_1', 14], ['cav', 4], ['garrison', 2]],
    }),
    CZE: C('CZE', { color: '#d9c07a', factories: { civ: 6, mil: 3, dock: 0 }, stability: 0.6, researchSlots: 3, templates: ['inf_9_1', 'garrison', 'armor'], army: [['inf_9_1', 10], ['armor', 2], ['garrison', 4]] }),
    AUT: C('AUT', { color: '#e0b0b0', regime: 'regency', factories: { civ: 3, mil: 1 }, templates: ['inf_9_1', 'mount'], army: [['inf_9_1', 4], ['mount', 2]] }),
    HUN: C('HUN', { color: '#b98f5a', regime: 'regency', factories: { civ: 3, mil: 1 }, templates: ['inf_9_1', 'cav'], army: [['inf_9_1', 5], ['cav', 2]] }),
    ROM: C('ROM', { color: '#c2a04a', regime: 'monarchy', factories: { civ: 4, mil: 1, dock: 1 }, templates: ['inf_9_1', 'mount'], army: [['inf_9_1', 9], ['mount', 3]] }),
    YUG: C('YUG', { color: '#8fa8d0', regime: 'monarchy', factories: { civ: 3, mil: 1 }, templates: ['inf_9_1', 'mount'], army: [['inf_9_1', 8], ['mount', 4]] }),
    BUL: C('BUL', { color: '#9dbf8a', regime: 'monarchy', factories: { civ: 2, mil: 1 }, templates: ['inf_9_1'], army: [['inf_9_1', 5]] }),
    GRE: C('GRE', { color: '#6fb0c0', regime: 'monarchy', factories: { civ: 2, mil: 1, dock: 1 }, templates: ['inf_9_1', 'mount'], army: [['inf_9_1', 6], ['mount', 2]] }),
    TUR: C('TUR', { color: '#b06a6a', regime: 'parliamentary', factories: { civ: 4, mil: 2, dock: 1 }, templates: ['inf_9_1', 'cav'], army: [['inf_9_1', 10], ['cav', 3]] }),
    SPA: C('SPA', { color: '#d0a050', regime: 'junta', factories: { civ: 5, mil: 2, dock: 2 }, stability: 0.4, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 8], ['garrison', 4]] }),
    POR: C('POR', { color: '#7f9e6a', regime: 'military_dictatorship', factories: { civ: 2, mil: 1, dock: 1 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 3], ['garrison', 2]] }),
    SWI: C('SWI', { color: '#e8e0c0', factories: { civ: 3, mil: 1 }, templates: ['inf_9_1', 'mount'], army: [['inf_9_1', 4], ['mount', 3]] }),
    LOW: C('LOW', { color: '#9ad0c0', factories: { civ: 6, mil: 1, dock: 2 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 5], ['garrison', 4]] }),
    DEN: C('DEN', { color: '#e0a0a0', factories: { civ: 2, mil: 1, dock: 1 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 2], ['garrison', 2]] }),
    SWE: C('SWE', { color: '#6a9ec0', factories: { civ: 6, mil: 2, dock: 2 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 6], ['garrison', 4]] }),
    NOR: C('NOR', { color: '#a8c8e0', factories: { civ: 2, mil: 1, dock: 1 }, templates: ['inf_9_1', 'garrison', 'mount'], army: [['inf_9_1', 3], ['garrison', 3], ['mount', 2]] }),
    FIN: C('FIN', { color: '#c0d8e8', factories: { civ: 3, mil: 1, dock: 1 }, stability: 0.65, templates: ['inf_9_1', 'garrison', 'mount'], army: [['inf_9_1', 5], ['garrison', 3], ['mount', 3]] }),
    BAL: C('BAL', { color: '#cfcf9f', factories: { civ: 2, mil: 1 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 4], ['garrison', 2]] }),
  };

  // ============================================================
  // 1b. 世界诸国（1936 年历史口径：工业/兵力/政体/战略倾向）
  // ============================================================
  Object.assign(PSE.COUNTRY_NAME, {
    USA: '美国', JAP: '日本', CHI: '中国', AUT: '奥地利', IRE: '爱尔兰', ICE: '冰岛',
    CAN: '加拿大', MEX: '墨西哥', BRA: '巴西', ARG: '阿根廷', CHL: '智利', PER: '秘鲁',
    VEN: '委内瑞拉', COL: '哥伦比亚', ECU: '厄瓜多尔', BOL: '玻利维亚', PAR: '巴拉圭',
    URU: '乌拉圭', CUB: '古巴', HAI: '海地', DOM: '多米尼加', GUA: '危地马拉',
    HON: '洪都拉斯', NIC: '尼加拉瓜', IRN: '伊朗', IRQ: '伊拉克', SAU: '沙特阿拉伯',
    AFG: '阿富汗', IND: '英属印度', ETH: '埃塞俄比亚', SIA: '泰国', NZL: '新西兰',
    SAF: '南非', LIB: '利比里亚', MON: '蒙古', NEU: '未定领地',
  });

  Object.assign(PSE.COUNTRIES, {
    // —— 世界主要强国 ——
    USA: C('USA', {
      ideology: 'democratic', regime: 'parliamentary', color: '#4f8f6a', isMajor: true,
      factories: { civ: 62, mil: 20, dock: 20 }, pp: 80, stability: 0.7, warSupport: 0.15,
      researchSlots: 5, focusTree: 'USA', tensionWeight: 2.4,
      ai: { aggression: 0.2, expand: 0.25, target: ['JAP', 'GER'] },
      templates: ['inf_9_1', 'inf_7_2', 'armor', 'mot', 'marine', 'garrison'],
      army: [['inf_9_1', 10], ['garrison', 6], ['marine', 2]],
    }),
    JAP: C('JAP', {
      ideology: 'fascist', regime: 'military_dictatorship', color: '#c05a6a', isMajor: true,
      factories: { civ: 18, mil: 8, dock: 9 }, pp: 65, stability: 0.6, warSupport: 0.7,
      researchSlots: 4, focusTree: 'JAP', tensionWeight: 2.0,
      ai: { aggression: 0.9, expand: 0.95, target: ['CHI', 'SOV', 'USA', 'ENG'] },
      templates: ['inf_9_1', 'inf_7_2', 'marine', 'garrison', 'mount'],
      army: [['inf_9_1', 22], ['marine', 4], ['garrison', 6], ['mount', 2]],
    }),
    CHI: C('CHI', {
      ideology: 'neutral', regime: 'one_party', color: '#d8c86a', isMajor: true,
      factories: { civ: 8, mil: 3, dock: 1 }, pp: 45, stability: 0.35, warSupport: 0.6,
      researchSlots: 2, focusTree: 'CHI', tensionWeight: 1.6,
      ai: { aggression: 0.3, expand: 0.3, target: ['JAP'] },
      templates: ['inf_9_1', 'garrison', 'mount', 'cav'],
      army: [['inf_9_1', 30], ['garrison', 12], ['cav', 4], ['mount', 3]],
    }),
    // —— 欧洲其余 ——
    IRE: C('IRE', { color: '#7fb08a', factories: { civ: 2, mil: 1 }, army: [['inf_9_1', 3], ['garrison', 1]], templates: ['inf_9_1', 'garrison'] }),
    ICE: C('ICE', { color: '#cfe0e8', factories: { civ: 1, mil: 0 }, army: [['garrison', 1]], templates: ['garrison'] }),
    // —— 美洲 ——
    CAN: C('CAN', { color: '#9a6f5a', factories: { civ: 8, mil: 2, dock: 2 }, researchSlots: 3, templates: ['inf_9_1', 'garrison', 'armor'], army: [['inf_9_1', 6], ['garrison', 4]] }),
    MEX: C('MEX', { color: '#8aa85a', regime: 'junta', factories: { civ: 4, mil: 1, dock: 1 }, stability: 0.45, templates: ['inf_9_1', 'cav', 'garrison'], army: [['inf_9_1', 6], ['cav', 3], ['garrison', 3]] }),
    BRA: C('BRA', { color: '#a8c05a', regime: 'junta', factories: { civ: 5, mil: 1, dock: 2 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 7], ['garrison', 4]] }),
    ARG: C('ARG', { color: '#7fa8c0', regime: 'junta', factories: { civ: 4, mil: 1, dock: 2 }, templates: ['inf_9_1', 'garrison', 'cav'], army: [['inf_9_1', 6], ['cav', 2], ['garrison', 2]] }),
    CHL: C('CHL', { color: '#b08a6a', factories: { civ: 2, mil: 1, dock: 1 }, army: [['inf_9_1', 4], ['garrison', 2]], templates: ['inf_9_1', 'mount', 'garrison'] }),
    PER: C('PER', { color: '#c0a05a', factories: { civ: 2, mil: 1, dock: 1 }, army: [['inf_9_1', 3], ['garrison', 2]], templates: ['inf_9_1', 'mount', 'garrison'] }),
    VEN: C('VEN', { color: '#c0b05a', regime: 'junta', factories: { civ: 2, mil: 1, dock: 1 }, army: [['inf_9_1', 3], ['garrison', 1]], templates: ['inf_9_1', 'garrison'] }),
    COL: C('COL', { color: '#c0c07a', factories: { civ: 2, mil: 1, dock: 1 }, army: [['inf_9_1', 3], ['garrison', 2]], templates: ['inf_9_1', 'garrison'] }),
    ECU: C('ECU', { color: '#a0c0a0', factories: { civ: 1, mil: 1 }, army: [['garrison', 1], ['inf_9_1', 1]], templates: ['inf_9_1', 'garrison'] }),
    BOL: C('BOL', { color: '#9a8a5a', factories: { civ: 1, mil: 1 }, army: [['inf_9_1', 2], ['garrison', 1]], templates: ['inf_9_1', 'mount', 'garrison'] }),
    PAR: C('PAR', { color: '#8a9a6a', factories: { civ: 1, mil: 1 }, army: [['inf_9_1', 1], ['garrison', 1]], templates: ['inf_9_1', 'garrison'] }),
    URU: C('URU', { color: '#8aa0b0', factories: { civ: 1, mil: 1, dock: 1 }, army: [['inf_9_1', 1], ['garrison', 1]], templates: ['inf_9_1', 'garrison'] }),
    CUB: C('CUB', { color: '#b0a05a', regime: 'junta', factories: { civ: 2, mil: 1, dock: 1 }, army: [['inf_9_1', 2], ['garrison', 1]], templates: ['inf_9_1', 'garrison'] }),
    HAI: C('HAI', { color: '#a08a7a', factories: { civ: 1, mil: 0 }, army: [['garrison', 1]], templates: ['garrison'] }),
    DOM: C('DOM', { color: '#b09a6a', factories: { civ: 1, mil: 1 }, army: [['garrison', 1]], templates: ['garrison'] }),
    GUA: C('GUA', { color: '#a8b07a', regime: 'junta', factories: { civ: 1, mil: 1 }, army: [['inf_9_1', 1], ['garrison', 1]], templates: ['inf_9_1', 'garrison'] }),
    HON: C('HON', { color: '#98a87a', regime: 'junta', factories: { civ: 1, mil: 1 }, army: [['garrison', 1]], templates: ['inf_9_1', 'garrison'] }),
    NIC: C('NIC', { color: '#88a06a', regime: 'junta', factories: { civ: 1, mil: 1 }, army: [['garrison', 1]], templates: ['garrison'] }),
    // —— 中东与南亚 ——
    IRN: C('IRN', { color: '#c0a07a', regime: 'monarchy', factories: { civ: 3, mil: 1 }, templates: ['inf_9_1', 'cav', 'mount'], army: [['inf_9_1', 6], ['cav', 2], ['mount', 2]] }),
    IRQ: C('IRQ', { color: '#b0a080', regime: 'monarchy', factories: { civ: 2, mil: 1 }, templates: ['inf_9_1', 'cav'], army: [['inf_9_1', 4], ['cav', 2]] }),
    SAU: C('SAU', { color: '#c8b070', regime: 'monarchy', factories: { civ: 1, mil: 0 }, templates: ['inf_9_1', 'cav'], army: [['inf_9_1', 3], ['cav', 2]] }),
    AFG: C('AFG', { color: '#a8a080', regime: 'monarchy', factories: { civ: 1, mil: 1 }, templates: ['inf_9_1', 'mount', 'cav'], army: [['inf_9_1', 4], ['mount', 2]] }),
    IND: C('IND', { color: '#c08a5a', factories: { civ: 9, mil: 2, dock: 2 }, pp: 40, stability: 0.45, researchSlots: 2, templates: ['inf_9_1', 'garrison', 'mount', 'cav'], army: [['inf_9_1', 12], ['garrison', 8], ['mount', 3], ['cav', 2]] }),
    // —— 亚太与非洲 ——
    ETH: C('ETH', { color: '#8aa05a', regime: 'monarchy', factories: { civ: 2, mil: 1 }, stability: 0.4, templates: ['inf_9_1', 'garrison', 'mount'], army: [['inf_9_1', 6], ['garrison', 4], ['mount', 2]] }),
    SIA: C('SIA', { color: '#a0b07a', regime: 'military_dictatorship', factories: { civ: 2, mil: 1 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 4], ['garrison', 2]] }),
    AUS: C('AUS', { color: '#c0a870', factories: { civ: 5, mil: 1, dock: 2 }, researchSlots: 3, templates: ['inf_9_1', 'garrison', 'marine'], army: [['inf_9_1', 4], ['garrison', 4]] }),
    NZL: C('NZL', { color: '#9ab0c0', factories: { civ: 2, mil: 1, dock: 1 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 2], ['garrison', 2]] }),
    SAF: C('SAF', { color: '#b09a5a', factories: { civ: 4, mil: 1, dock: 1 }, templates: ['inf_9_1', 'garrison'], army: [['inf_9_1', 4], ['garrison', 3]] }),
    LIB: C('LIB', { color: '#90a070', factories: { civ: 1, mil: 0 }, army: [['garrison', 1]], templates: ['garrison'] }),
    MON: C('MON', { color: '#b0a878', ideology: 'communist', regime: 'one_party', factories: { civ: 1, mil: 0 }, templates: ['cav', 'garrison'], army: [['cav', 3], ['garrison', 1]] }),
    // —— 未定领地（数据集中未映射到具体国家的区域，游戏中保持中立不参战）——
    NEU: C('NEU', { color: '#6a6a6a', stability: 0.9, warSupport: 0, factories: { civ: 1, mil: 0 }, templates: ['garrison'], army: [['garrison', 1]] }),
  });

  // ============================================================
  // 2. 营制（师团模板的原子单位）
  // ============================================================
  function B(id, name, o) { return Object.assign({ id, name, width: 2, soft: 6, hard: 1, def: 12, brk: 3, org: 30, hp: 25, speed: 4, supply: 1.0, equip: {}, manpower: 1.0 }, o); }

  PSE.BATTALIONS = {
    inf: B('inf', '步兵营', { equip: { infantry_equipment_1: 100 } }),
    inf_2: B('inf_2', '步兵营(改进)', { soft: 8, def: 15, equip: { infantry_equipment_2: 100 } }),
    inf_3: B('inf_3', '步兵营(现代)', { soft: 10, def: 18, equip: { infantry_equipment_3: 100 } }),
    mot: B('mot', '摩托化营', { soft: 7, def: 12, org: 32, speed: 12, supply: 1.6, equip: { infantry_equipment_1: 100, motorized_equipment: 60 } }),
    mech: B('mech', '机械化营', { soft: 9, hard: 4, def: 16, brk: 6, org: 34, hp: 28, speed: 10, supply: 2.0, equip: { infantry_equipment_1: 100, mechanized_equipment: 60 } }),
    cav: B('cav', '骑兵营', { soft: 5, def: 8, org: 28, speed: 8, supply: 1.4, equip: { infantry_equipment_1: 80 } }),
    mount: B('mount', '山地营', { soft: 6, def: 14, org: 32, speed: 5, supply: 1.2, equip: { infantry_equipment_1: 100 } }),
    marine: B('marine', '海军陆战营', { soft: 7, def: 13, org: 32, speed: 5, supply: 1.2, equip: { infantry_equipment_1: 100 } }),
    para: B('para', '伞兵营', { soft: 7, def: 11, org: 30, speed: 4, supply: 1.3, equip: { infantry_equipment_1: 100 } }),
    lar: B('lar', '轻型装甲营', { width: 2, soft: 8, hard: 12, def: 6, brk: 18, org: 30, hp: 22, speed: 10, supply: 2.0, equip: { light_tank_1: 60 } }),
    mar: B('mar', '中型装甲营', { width: 2, soft: 12, hard: 22, def: 7, brk: 28, org: 30, hp: 24, speed: 9, supply: 2.4, equip: { medium_tank_1: 60 } }),
    har: B('har', '重型装甲营', { width: 3, soft: 14, hard: 32, def: 8, brk: 34, org: 28, hp: 28, speed: 7, supply: 3.0, equip: { heavy_tank_1: 50 } }),
    art: B('art', '炮兵营', { width: 3, soft: 15, hard: 2, def: 8, brk: 4, org: 10, hp: 2, speed: 3, supply: 1.4, equip: { artillery_1: 36 } }),
    art_2: B('art_2', '炮兵营(重)', { width: 3, soft: 22, hard: 3, def: 10, brk: 5, org: 10, hp: 2, speed: 3, supply: 1.6, equip: { artillery_2: 36 } }),
    at: B('at', '反坦克营', { width: 2, soft: 3, hard: 16, def: 10, brk: 6, org: 12, hp: 2, speed: 3, supply: 1.2, equip: { anti_tank_1: 30 } }),
    aa: B('aa', '防空营', { width: 2, soft: 2, hard: 4, def: 12, brk: 2, org: 14, hp: 2, speed: 3, supply: 1.2, equip: { anti_air_1: 30 } }),
    // 支援连（不占宽度）
    sup_eng: B('sup_eng', '工兵连', { width: 0, soft: 0, hard: 0, def: 4, brk: 2, org: 2, hp: 5, speed: 0, supply: 0.2, equip: { support_equipment: 30 }, isSupport: true }),
    sup_rec: B('sup_rec', '侦察连', { width: 0, soft: 1, def: 2, brk: 3, org: 2, hp: 4, supply: 0.15, equip: { support_equipment: 20 }, isSupport: true }),
    sup_art: B('sup_art', '支援炮连', { width: 0, soft: 6, hard: 1, def: 1, brk: 1, org: 0, hp: 1, supply: 0.2, equip: { support_equipment: 20, artillery_1: 12 }, isSupport: true }),
    sup_mp: B('sup_mp', '宪兵连', { width: 0, def: 3, org: 2, hp: 4, supply: 0.15, equip: { support_equipment: 15 }, isSupport: true, suppression: 3 }),
    sup_hosp: B('sup_hosp', '战地医院', { width: 0, def: 1, org: 1, hp: 6, supply: 0.2, equip: { support_equipment: 15 }, isSupport: true }),
  };

  // ============================================================
  // 3. 师团模板
  // ============================================================
  function T(id, name, comp, support, o) {
    return Object.assign({ id, name, comp, support: support || [], unlocked: true }, o || {});
  }
  PSE.TEMPLATES = {
    inf_9_1: T('inf_9_1', '步兵师 (9步1炮)', { inf: 9, art: 1 }, ['sup_eng']),
    inf_7_2: T('inf_7_2', '加强步兵师 (7步2炮)', { inf: 7, art: 2 }, ['sup_eng', 'sup_art']),
    garrison: T('garrison', '卫戍师 (6步)', { inf: 6 }, ['sup_mp']),
    mot: T('mot', '摩托化师 (6摩2炮)', { mot: 6, art: 2 }, ['sup_eng', 'sup_rec']),
    armor: T('armor', '装甲师 (6轻坦4摩)', { lar: 6, mot: 4 }, ['sup_eng', 'sup_rec']),
    armor_med: T('armor_med', '中型装甲师 (6中坦4机)', { mar: 6, mech: 4 }, ['sup_eng', 'sup_rec']),
    mount: T('mount', '山地师 (6山2炮)', { mount: 6, art: 2 }, ['sup_eng']),
    marine: T('marine', '海军陆战师 (6陆2炮)', { marine: 6, art: 2 }, ['sup_eng']),
    para: T('para', '伞兵师 (6伞2炮)', { para: 6, art: 2 }, ['sup_eng']),
    cav: T('cav', '骑兵师 (6骑1炮)', { cav: 6, art: 1 }, []),
    inf_at: T('inf_at', '反坦克步兵师 (8步2反)', { inf: 8, at: 2 }, ['sup_eng']),
  };

  // 模板属性计算（唯一入口，UI 与战斗共用）
  PSE.computeTemplate = function (tplId, modifiers) {
    const tpl = PSE.TEMPLATES[tplId];
    if (!tpl) return null;
    const m = modifiers || {};
    const st = { id: tplId, name: tpl.name, width: 0, soft: 0, hard: 0, def: 0, brk: 0, hp: 0,
      org: 0, orgSum: 0, orgWeight: 0, speed: 99, supply: 0, manpower: 0, equip: {}, suppression: 0 };
    let count = 0;
    const add = (b, n) => {
      count += n;
      st.width += b.width * n;
      st.soft += (b.soft || 0) * n * (m.softMul || 1);
      st.hard += (b.hard || 0) * n * (m.hardMul || 1);
      st.def += (b.def || 0) * n * (m.defMul || 1);
      st.brk += (b.brk || 0) * n * (m.brkMul || 1);
      st.hp += (b.hp || 0) * n;
      st.orgSum += (b.org || 0) * n * (m.orgMul || 1);
      st.orgWeight += n;
      if (!b.isSupport) st.speed = Math.min(st.speed, b.speed);
      st.supply += (b.supply || 0) * n;
      st.manpower += (b.manpower || 0) * n;
      st.suppression += (b.suppression || 0) * n;
      for (const e in b.equip) st.equip[e] = (st.equip[e] || 0) + b.equip[e] * n;
    };
    const comp = tpl.comp;
    for (const k in comp) { const b = PSE.BATTALIONS[k]; if (b) add(b, comp[k]); }
    for (const s of tpl.support) { const b = PSE.BATTALIONS[s]; if (b) add(b, 1); }
    st.org = st.orgWeight > 0 ? st.orgSum / st.orgWeight : 30;
    st.orgMax = st.org;
    if (st.speed === 99) st.speed = 4;
    // 支援连不影响机动
    return st;
  };

  // ============================================================
  // 4. 装备
  // ============================================================
  function E(id, name, type, cost, res, year) {
    return { id, name, type, cost, res, year: year || 1936, stock: 0 };
  }
  PSE.EQUIPMENT = {
    infantry_equipment_1: E('infantry_equipment_1', '步兵装备 I', 'infantry', 0.50, { steel: 1.5 }, 1936),
    infantry_equipment_2: E('infantry_equipment_2', '步兵装备 II', 'infantry', 0.70, { steel: 2.2 }, 1939),
    infantry_equipment_3: E('infantry_equipment_3', '步兵装备 III', 'infantry', 1.00, { steel: 3 }, 1942),
    support_equipment: E('support_equipment', '支援装备', 'infantry', 0.60, { steel: 1.5 }, 1936),
    motorized_equipment: E('motorized_equipment', '卡车', 'infantry', 2.00, { steel: 3, rubber: 1.5 }, 1936),
    mechanized_equipment: E('mechanized_equipment', '半履带车', 'infantry', 5.00, { steel: 6, rubber: 1.5 }, 1940),
    artillery_1: E('artillery_1', '牵引火炮 I', 'artillery', 4.00, { steel: 5, tungsten: 0.5 }, 1936),
    artillery_2: E('artillery_2', '牵引火炮 II', 'artillery', 6.50, { steel: 7, tungsten: 1 }, 1940),
    anti_tank_1: E('anti_tank_1', '反坦克炮 I', 'artillery', 5.00, { steel: 5, tungsten: 2 }, 1936),
    anti_air_1: E('anti_air_1', '高射炮 I', 'artillery', 5.00, { steel: 5, tungsten: 1 }, 1936),
    light_tank_1: E('light_tank_1', '轻型坦克 I', 'tank', 6.00, { steel: 8, rubber: 1 }, 1936),
    medium_tank_1: E('medium_tank_1', '中型坦克 I', 'tank', 12.00, { steel: 14, tungsten: 2, rubber: 1 }, 1939),
    medium_tank_2: E('medium_tank_2', '中型坦克 II', 'tank', 16.00, { steel: 18, tungsten: 3, rubber: 1.5 }, 1942),
    heavy_tank_1: E('heavy_tank_1', '重型坦克 I', 'tank', 20.00, { steel: 24, tungsten: 4, rubber: 1 }, 1940),
    fighter_1: E('fighter_1', '战斗机 I', 'air', 24.00, { aluminum: 8, rubber: 2 }, 1936),
    fighter_2: E('fighter_2', '战斗机 II', 'air', 30.00, { aluminum: 11, rubber: 3 }, 1940),
    cas_1: E('cas_1', '近距离支援机 I', 'air', 22.00, { aluminum: 8, rubber: 1.5 }, 1936),
    tactical_bomber_1: E('tactical_bomber_1', '战术轰炸机 I', 'air', 30.00, { aluminum: 12, rubber: 2 }, 1936),
    strategic_bomber_1: E('strategic_bomber_1', '战略轰炸机 I', 'air', 60.00, { aluminum: 20, rubber: 3 }, 1939),
    transport_plane: E('transport_plane', '运输机', 'air', 20.00, { aluminum: 8, rubber: 1.5 }, 1936),
    destroyer: E('destroyer', '驱逐舰', 'naval', 400.00, { steel: 200, tungsten: 10 }, 1936),
    cruiser: E('cruiser', '巡洋舰', 'naval', 1200.00, { steel: 600, tungsten: 30 }, 1936),
    battleship: E('battleship', '战列舰', 'naval', 4000.00, { steel: 2000, tungsten: 100, chromium: 60 }, 1936),
    submarine: E('submarine', '潜艇', 'naval', 300.00, { steel: 120, tungsten: 10 }, 1936),
    convoy: E('convoy', '运输船', 'naval', 120.00, { steel: 60 }, 1936),
  };
  PSE.EQUIP_NAME = (id) => (PSE.EQUIPMENT[id] ? PSE.EQUIPMENT[id].name : id);

  // ============================================================
  // 5. 科技树
  // ============================================================
  function K(id, name, area, cost, year, prereq, effects, o) {
    return Object.assign({ id, name, area, cost, year, prereq: prereq || [], effects: effects || {} }, o || {});
  }
  PSE.TECHS = {
    // --- 工业 ---
    ind_civ_1: K('ind_civ_1', '民用工业 I', 'industry', 100, 1936, [], { civOutput: 0.10 }),
    ind_civ_2: K('ind_civ_2', '民用工业 II', 'industry', 140, 1937, ['ind_civ_1'], { civOutput: 0.10 }),
    ind_civ_3: K('ind_civ_3', '民用工业 III', 'industry', 190, 1939, ['ind_civ_2'], { civOutput: 0.10 }),
    ind_civ_4: K('ind_civ_4', '民用工业 IV', 'industry', 250, 1941, ['ind_civ_3'], { civOutput: 0.10 }),
    ind_civ_5: K('ind_civ_5', '民用工业 V', 'industry', 320, 1943, ['ind_civ_4'], { civOutput: 0.10 }),
    ind_mil_1: K('ind_mil_1', '军用工业 I', 'industry', 100, 1936, [], { milOutput: 0.10 }, { exclusiveWith: 'ind_civ_1' }),
    ind_mil_2: K('ind_mil_2', '军用工业 II', 'industry', 140, 1937, ['ind_mil_1'], { milOutput: 0.10 }),
    ind_mil_3: K('ind_mil_3', '军用工业 III', 'industry', 190, 1939, ['ind_mil_2'], { milOutput: 0.10 }),
    ind_mil_4: K('ind_mil_4', '军用工业 IV', 'industry', 250, 1941, ['ind_mil_3'], { milOutput: 0.10 }),
    ind_mil_5: K('ind_mil_5', '军用工业 V', 'industry', 320, 1943, ['ind_mil_4'], { milOutput: 0.10 }),
    con_1: K('con_1', '建造技术 I', 'industry', 110, 1936, [], { buildSpeed: 0.10 }),
    con_2: K('con_2', '建造技术 II', 'industry', 150, 1938, ['con_1'], { buildSpeed: 0.10 }),
    con_3: K('con_3', '建造技术 III', 'industry', 200, 1940, ['con_2'], { buildSpeed: 0.10 }),
    con_4: K('con_4', '建造技术 IV', 'industry', 260, 1942, ['con_3'], { buildSpeed: 0.10 }),
    res_1: K('res_1', '科研机构 I', 'industry', 120, 1936, [], { researchSpeed: 0.05 }),
    res_2: K('res_2', '科研机构 II', 'industry', 160, 1938, ['res_1'], { researchSpeed: 0.05 }),
    res_3: K('res_3', '科研机构 III', 'industry', 210, 1940, ['res_2'], { researchSpeed: 0.05 }),
    res_4: K('res_4', '科研机构 IV', 'industry', 280, 1942, ['res_3'], { researchSpeed: 0.05 }),
    synth_1: K('synth_1', '合成精炼 I', 'industry', 160, 1937, [], { synthRatio: 0.20 }),
    synth_2: K('synth_2', '合成精炼 II', 'industry', 220, 1940, ['synth_1'], { synthRatio: 0.20 }),
    // --- 陆军 ---
    inf_weap_1: K('inf_weap_1', '步兵武器 I', 'army', 90, 1936, [], { softMul: 0.08, defMul: 0.05 }),
    inf_weap_2: K('inf_weap_2', '步兵武器 II', 'army', 150, 1939, ['inf_weap_1'], { softMul: 0.10, defMul: 0.05 }),
    inf_weap_3: K('inf_weap_3', '步兵武器 III', 'army', 240, 1942, ['inf_weap_2'], { softMul: 0.12, defMul: 0.05 }),
    art_1: K('art_1', '火炮 I', 'army', 110, 1936, [], { softMul: 0.08 }),
    art_2: K('art_2', '火炮 II', 'army', 180, 1939, ['art_1'], { softMul: 0.10 }),
    art_3: K('art_3', '火炮 III', 'army', 260, 1942, ['art_2'], { softMul: 0.12 }),
    armor_1: K('armor_1', '装甲 I', 'army', 130, 1936, [], { brkMul: 0.08, orgMul: 0.03 }),
    armor_2: K('armor_2', '装甲 II', 'army', 200, 1939, ['armor_1'], { brkMul: 0.10, orgMul: 0.03 }),
    at_1: K('at_1', '反坦克 I', 'army', 100, 1936, [], { hardMul: 0.10 }),
    at_2: K('at_2', '反坦克 II', 'army', 180, 1940, ['at_1'], { hardMul: 0.15 }),
    aa_1: K('aa_1', '防空 I', 'army', 90, 1936, [], { aaMul: 0.15 }),
    mot_1: K('mot_1', '摩托化', 'army', 120, 1936, [], { speedMul: 0.10, unlockEquip: ['motorized_equipment'] }),
    mech_1: K('mech_1', '机械化', 'army', 220, 1940, ['mot_1'], { speedMul: 0.10, unlockEquip: ['mechanized_equipment'] }),
    sup_1: K('sup_1', '支援连 I', 'army', 100, 1936, [], { orgMul: 0.03, defMul: 0.05 }),
    sup_2: K('sup_2', '支援连 II', 'army', 170, 1939, ['sup_1'], { orgMul: 0.03, defMul: 0.05 }),
    // --- 学说（互斥四条） ---
    doc_mobile: K('doc_mobile', '学说：机动优势', 'doctrine', 200, 1936, [], { brkMul: 0.20, speedMul: 0.15, orgMul: 0.10 }),
    doc_fire: K('doc_fire', '学说：火力优势', 'doctrine', 200, 1936, [], { softMul: 0.15, supportMul: 0.50 }),
    doc_mass: K('doc_mass', '学说：人海战术', 'doctrine', 200, 1936, [], { widthMul: 0.20, manpowerLoss: -0.20 }),
    doc_quality: K('doc_quality', '学说：优质火力', 'doctrine', 200, 1936, [], { defMul: 0.25, brkMul: 0.15, planningMul: 0.30 }),
    // --- 空军 ---
    ftr_1: K('ftr_1', '战斗机 I', 'air', 130, 1936, [], { airAtk: 0.10, unlockEquip: ['fighter_1'] }),
    ftr_2: K('ftr_2', '战斗机 II', 'air', 210, 1940, ['ftr_1'], { airAtk: 0.15, unlockEquip: ['fighter_2'] }),
    cas_1: K('cas_1', '近距离支援', 'air', 140, 1936, [], { casBonus: 0.15, unlockEquip: ['cas_1'] }),
    cas_2: K('cas_2', '近距支援 II', 'air', 220, 1940, ['cas_1'], { casBonus: 0.20 }),
    str_1: K('str_1', '战略轰炸', 'air', 200, 1939, [], { stratDamage: 0.20, unlockEquip: ['strategic_bomber_1'] }),
    tra_1: K('tra_1', '运输机', 'air', 120, 1936, [], { unlockEquip: ['transport_plane'] }),
    // --- 海军 ---
    nav_1: K('nav_1', '海军理论', 'navy', 130, 1936, [], { navalAtk: 0.10 }),
    nav_2: K('nav_2', '海军理论 II', 'navy', 210, 1940, ['nav_1'], { navalAtk: 0.15 }),
    sub_1: K('sub_1', '潜艇战', 'navy', 140, 1936, [], { subAtk: 0.20 }),
    asw_1: K('asw_1', '反潜战', 'navy', 140, 1936, [], { asw: 0.25 }),
    // --- 核与火箭 ---
    nuc_theory: K('nuc_theory', '原子能理论', 'nuclear', 300, 1939, [], { unlockBuilding: ['reactor'] }),
    nuc_bomb: K('nuc_bomb', '核弹', 'nuclear', 600, 1943, ['nuc_theory'], { unlockNuke: true }),
    rocket_1: K('rocket_1', '火箭理论', 'rocket', 280, 1940, [], { unlockBuilding: ['rocket_site'] }),
    jet_1: K('jet_1', '喷气发动机', 'rocket', 400, 1943, ['rocket_1', 'ftr_2'], { airAtk: 0.20 }),
  };

  // ============================================================
  // 6. 国策树
  //    DSL: F(id, name, days, prereq[], effects[], {x,y,excl[],hidden})
  //    effect op: pp/stab/ws/factory/slot/mod/tension/claim/wargoal/troops/tech/template/spirit/event
  // ============================================================
  function F(id, name, days, prereq, effects, o) { return Object.assign({ id, name, days, prereq: prereq || [], effects: effects || [] }, o || {}); }

  PSE.FOCUS_TREES = {
    GER: {
      nodes: [
        F('GER_rearm', '重整军备', 35, [], [{ op: 'ws', v: 0.10 }, { op: 'equip', id: 'infantry_equipment_1', n: 6000 }, { op: 'pp', v: 20 }], { x: 1, y: 0 }),
        F('GER_rhineland', '莱茵兰再军事化', 28, ['GER_rearm'], [{ op: 'tension', v: 5 }, { op: 'pp', v: 15 }, { op: 'event', id: 'EVT_rhineland' }], { x: 2, y: 0 }),
        F('GER_anschluss', '合并奥地利', 42, ['GER_rhineland'], [{ op: 'tension', v: 8 }, { op: 'annex', tag: 'AUS' }, { op: 'event', id: 'EVT_anschluss' }], { x: 3, y: 0, hidden: { date: [1938, 1, 1] } }),
        F('GER_sudeten', '苏台德危机', 35, ['GER_anschluss'], [{ op: 'tension', v: 10 }, { op: 'event', id: 'EVT_munich' }], { x: 4, y: 0 }),
        F('GER_danzig', '但泽或战争', 42, ['GER_sudeten'], [{ op: 'tension', v: 15 }, { op: 'wargoal', tag: 'POL' }, { op: 'event', id: 'EVT_danzig' }], { x: 5, y: 0 }),
        F('GER_four_year', '四年计划', 210, ['GER_rearm'], [{ op: 'factory', kind: 'civ', n: 4 }, { op: 'mod', key: 'milOutput', v: 0.05 }], { x: 1, y: 1 }),
        F('GER_autarky', '自给自足经济', 140, ['GER_four_year'], [{ op: 'mod', key: 'resourceFactor', v: 0.10 }, { op: 'res', key: 'oil', v: 6 }], { x: 2, y: 1 }),
        F('GER_grossraum', '大区经济', 140, ['GER_autarky'], [{ op: 'mod', key: 'consumerGoods', v: -0.05 }, { op: 'factory', kind: 'mil', n: 3 }], { x: 3, y: 1 }),
        F('GER_armor_doc', '装甲学说', 100, ['GER_rearm'], [{ op: 'tech', id: 'armor_1' }, { op: 'mod', key: 'brkMul', v: 0.10 }], { x: 2, y: 2 }),
        F('GER_blitz', '闪电战理论', 120, ['GER_armor_doc'], [{ op: 'tech', id: 'doc_mobile' }, { op: 'mod', key: 'speedMul', v: 0.10 }], { x: 3, y: 2 }),
        F('GER_luftwaffe', '空军扩张', 100, ['GER_rearm'], [{ op: 'tech', id: 'ftr_1' }, { op: 'equip', id: 'fighter_1', n: 400 }], { x: 1, y: 2 }),
        F('GER_kriegsmarine', 'Z 计划', 180, ['GER_rearm'], [{ op: 'factory', kind: 'dock', n: 3 }, { op: 'mod', key: 'navalAtk', v: 0.10 }], { x: 4, y: 2 }),
        F('GER_molotov', '苏德条约', 70, ['GER_danzig'], [{ op: 'pp', v: 30 }, { op: 'tension', v: -10 }, { op: 'relation', tag: 'SOV', v: 40 }, { op: 'event', id: 'EVT_molotov' }], { x: 6, y: 0 }),
        F('GER_barbarossa', '巴巴罗萨计划', 90, ['GER_molotov'], [{ op: 'wargoal', tag: 'SOV' }, { op: 'mod', key: 'brkMul', v: 0.10 }], { x: 7, y: 0 }),
      ],
    },
    SOV: {
      nodes: [
        F('SOV_five_year', '第二个五年计划', 180, [], [{ op: 'factory', kind: 'civ', n: 5 }, { op: 'pp', v: 20 }], { x: 1, y: 0 }),
        F('SOV_industry_east', '工业东迁', 150, ['SOV_five_year'], [{ op: 'factory', kind: 'mil', n: 4 }, { op: 'mod', key: 'milOutput', v: 0.05 }], { x: 2, y: 0 }),
        F('SOV_purge', '大清洗', 90, [], [{ op: 'stab', v: -0.10 }, { op: 'pp', v: 60 }, { op: 'mod', key: 'orgMul', v: -0.05 }], { x: 1, y: 1 }),
        F('SOV_reform', '军队改革', 120, ['SOV_purge'], [{ op: 'mod', key: 'orgMul', v: 0.10 }, { op: 'tech', id: 'sup_1' }], { x: 2, y: 1 }),
        F('SOV_tank_corps', '坦克军', 150, ['SOV_reform'], [{ op: 'tech', id: 'armor_1' }, { op: 'mod', key: 'brkMul', v: 0.10 }], { x: 3, y: 1 }),
        F('SOV_mass', '人海战术', 130, ['SOV_reform'], [{ op: 'tech', id: 'doc_mass' }, { op: 'mod', key: 'widthMul', v: 0.10 }], { x: 3, y: 0 }),
        F('SOV_finland', '卡累利阿问题', 70, [], [{ op: 'wargoal', tag: 'FIN' }], { x: 1, y: 2 }),
        F('SOV_baltic', '波罗的海基地', 60, ['SOV_finland'], [{ op: 'claim', tag: 'BAL' }], { x: 2, y: 2 }),
        F('SOV_molotov', '与德国谈判', 70, [], [{ op: 'relation', tag: 'GER', v: 30 }, { op: 'pp', v: 25 }], { x: 4, y: 2 }),
        F('SOV_air', '空军现代化', 140, ['SOV_industry_east'], [{ op: 'tech', id: 'ftr_1' }, { op: 'equip', id: 'fighter_1', n: 300 }], { x: 3, y: 3 }),
        F('SOV_rocket', '火箭计划', 200, ['SOV_industry_east'], [{ op: 'tech', id: 'rocket_1' }], { x: 4, y: 3 }),
        F('SOV_lend', '争取租借', 90, [], [{ op: 'relation', tag: 'ENG', v: 30 }, { op: 'relation', tag: 'FRA', v: 20 }, { op: 'pp', v: 15 }], { x: 5, y: 3, hidden: { date: [1941, 1, 1] } }),
      ],
    },
    ENG: {
      nodes: [
        F('ENG_rearm', '有限重整军备', 45, [], [{ op: 'factory', kind: 'mil', n: 2 }, { op: 'ws', v: 0.05 }], { x: 1, y: 0 }),
        F('ENG_navy', '皇家海军优先', 120, ['ENG_rearm'], [{ op: 'factory', kind: 'dock', n: 3 }, { op: 'tech', id: 'nav_1' }], { x: 2, y: 0 }),
        F('ENG_raf', '皇家空军扩张', 110, ['ENG_rearm'], [{ op: 'tech', id: 'ftr_1' }, { op: 'equip', id: 'fighter_1', n: 500 }], { x: 2, y: 1 }),
        F('ENG_empire', '帝国资源整合', 140, [], [{ op: 'res', key: 'steel', v: 8 }, { op: 'res', key: 'rubber', v: 6 }, { op: 'factory', kind: 'civ', n: 3 }], { x: 1, y: 1 }),
        F('ENG_appease', '绥靖政策', 100, [], [{ op: 'tension', v: -8 }, { op: 'pp', v: 25 }, { op: 'relation', tag: 'GER', v: 20 }], { x: 1, y: 2 }),
        F('ENG_guarantee_pol', '保证波兰独立', 60, ['ENG_appease'], [{ op: 'tension', v: 5 }, { op: 'relation', tag: 'POL', v: 40 }, { op: 'guarantee', tag: 'POL' }], { x: 2, y: 2 }),
        F('ENG_wake', '唤醒沉睡的巨人', 180, ['ENG_rearm'], [{ op: 'factory', kind: 'civ', n: 5 }, { op: 'mod', key: 'buildSpeed', v: 0.10 }], { x: 3, y: 2 }),
        F('ENG_lend', '租借法案', 150, ['ENG_wake'], [{ op: 'mod', key: 'lendLease', v: 0.20 }, { op: 'relation', tag: 'SOV', v: 30 }], { x: 4, y: 2, hidden: { date: [1941, 3, 1] } }),
        F('ENG_second_front', '第二战场准备', 200, ['ENG_wake'], [{ op: 'mod', key: 'navalInvasion', v: 0.20 }, { op: 'tech', id: 'mech_1' }], { x: 4, y: 1, hidden: { date: [1943, 1, 1] } }),
        F('ENG_bomber', '战略轰炸攻势', 160, ['ENG_raf'], [{ op: 'tech', id: 'str_1' }, { op: 'equip', id: 'strategic_bomber_1', n: 60 }], { x: 3, y: 1 }),
      ],
    },
    FRA: {
      nodes: [
        F('FRA_maginot', '加强马奇诺防线', 120, [], [{ op: 'fort', v: 2 }, { op: 'mod', key: 'defMul', v: 0.10 }], { x: 1, y: 0 }),
        F('FRA_rearm', '重整军备', 60, [], [{ op: 'factory', kind: 'mil', n: 2 }, { op: 'ws', v: 0.05 }], { x: 1, y: 1 }),
        F('FRA_popular_front', '人民阵线', 90, [], [{ op: 'stab', v: 0.10 }, { op: 'pp', v: 30 }, { op: 'mod', key: 'civOutput', v: -0.05 }], { x: 2, y: 1 }),
        F('FRA_armor', '装甲部队改革', 140, ['FRA_rearm'], [{ op: 'tech', id: 'armor_1' }, { op: 'template', id: 'armor' }], { x: 2, y: 0 }),
        F('FRA_quality', '优质火力学说', 150, ['FRA_maginot'], [{ op: 'tech', id: 'doc_quality' }], { x: 3, y: 0 }),
        F('FRA_ally_eng', '英法同盟', 70, [], [{ op: 'relation', tag: 'ENG', v: 40 }, { op: 'faction' }], { x: 1, y: 2 }),
        F('FRA_ally_pol', '东欧盟友', 90, ['FRA_ally_eng'], [{ op: 'relation', tag: 'POL', v: 40 }, { op: 'guarantee', tag: 'POL' }, { op: 'relation', tag: 'CZE', v: 30 }], { x: 2, y: 2 }),
        F('FRA_colonial', '殖民地动员', 120, [], [{ op: 'manpower', v: 60 }, { op: 'res', key: 'rubber', v: 4 }], { x: 3, y: 2 }),
        F('FRA_navy', '海军扩充', 130, ['FRA_rearm'], [{ op: 'factory', kind: 'dock', n: 2 }, { op: 'tech', id: 'nav_1' }], { x: 3, y: 1 }),
        F('FRA_reequip', '美援装备', 150, ['FRA_rearm'], [{ op: 'equip', id: 'infantry_equipment_2', n: 4000 }, { op: 'relation', tag: 'ENG', v: 20 }], { x: 4, y: 1, hidden: { date: [1940, 1, 1] } }),
      ],
    },
    ITA: {
      nodes: [
        F('ITA_ethiopia', '巩固东非', 80, [], [{ op: 'pp', v: 20 }, { op: 'tension', v: 4 }], { x: 1, y: 0 }),
        F('ITA_rearm', '重整军备', 70, [], [{ op: 'factory', kind: 'mil', n: 2 }], { x: 1, y: 1 }),
        F('ITA_navy', '地中海舰队', 130, ['ITA_rearm'], [{ op: 'factory', kind: 'dock', n: 3 }, { op: 'tech', id: 'nav_1' }], { x: 2, y: 0 }),
        F('ITA_alps', '阿尔卑斯防线', 100, [], [{ op: 'fort', v: 1 }, { op: 'mod', key: 'defMul', v: 0.08 }], { x: 2, y: 1 }),
        F('ITA_armor', '装甲部队', 130, ['ITA_rearm'], [{ op: 'tech', id: 'armor_1' }, { op: 'template', id: 'armor' }], { x: 2, y: 2 }),
        F('ITA_air', '空军扩张', 120, ['ITA_rearm'], [{ op: 'tech', id: 'ftr_1' }, { op: 'equip', id: 'fighter_1', n: 250 }], { x: 3, y: 1 }),
        F('ITA_greece', '希腊冒险', 80, ['ITA_alps'], [{ op: 'wargoal', tag: 'GRE' }, { op: 'tension', v: 8 }], { x: 3, y: 0 }),
        F('ITA_axis', '加入轴心', 60, ['ITA_rearm'], [{ op: 'relation', tag: 'GER', v: 50 }, { op: 'faction_join', tag: 'GER' }], { x: 4, y: 0 }),
        F('ITA_africa', '北非攻势', 110, ['ITA_navy'], [{ op: 'mod', key: 'supplyRange', v: 2 }, { op: 'equip', id: 'infantry_equipment_1', n: 3000 }], { x: 4, y: 1 }),
        F('ITA_industry', '工业扩张', 160, [], [{ op: 'factory', kind: 'civ', n: 3 }, { op: 'mod', key: 'civOutput', v: 0.05 }], { x: 3, y: 2 }),
      ],
    },
    generic: {
      nodes: [
        F('GEN_industry', '工业发展', 120, [], [{ op: 'factory', kind: 'civ', n: 2 }], { x: 1, y: 0 }),
        F('GEN_military', '军事现代化', 100, [], [{ op: 'factory', kind: 'mil', n: 1 }, { op: 'ws', v: 0.05 }], { x: 1, y: 1 }),
        F('GEN_research', '科研投入', 110, [], [{ op: 'mod', key: 'researchSpeed', v: 0.05 }], { x: 2, y: 0 }),
        F('GEN_army', '陆军扩充', 90, ['GEN_military'], [{ op: 'troops', id: 'inf_9_1', n: 3 }, { op: 'manpower', v: 20 }], { x: 2, y: 1 }),
        F('GEN_fort', '边境筑垒', 100, [], [{ op: 'fort', v: 1 }, { op: 'mod', key: 'defMul', v: 0.05 }], { x: 3, y: 0 }),
        F('GEN_diplo', '外交平衡', 80, [], [{ op: 'pp', v: 30 }, { op: 'tension', v: -3 }], { x: 3, y: 1 }),
        F('GEN_mobilize', '总动员准备', 130, ['GEN_army'], [{ op: 'mod', key: 'conscription', v: 1 }, { op: 'manpower', v: 40 }], { x: 4, y: 0 }),
        F('GEN_economy', '战时经济', 150, ['GEN_industry'], [{ op: 'mod', key: 'consumerGoods', v: -0.10 }], { x: 4, y: 1 }),
      ],
    },
  };

  // ============================================================
  // 6b. 历史路线补全：各国国策树（按 1936–1945 真实决策分支设计）
  //     分支用 excl 互斥；时间门槛用 hidden.date；效果复用 Trigger/Effect IR
  // ============================================================
  (function () {
    const T = PSE.FOCUS_TREES;
    const push = (tree, nodes) => {
      const t = T[tree] || (T[tree] = { nodes: [] });
      t.nodes = t.nodes.concat(nodes);
    };

    // ---------- 德国：1940 后的西线/东线抉择与奇迹武器 ----------
    push('GER', [
      F('GER_rome_berlin', '罗马—柏林轴心', 70, ['GER_rhineland'],
        [{ op: 'faction_with', tag: 'ITA' }, { op: 'relation', tag: 'ITA', v: 60 }, { op: 'tension', v: 3 }], { x: 1, y: 3 }),
      F('GER_westwall', '齐格菲防线', 100, ['GER_rearm'],
        [{ op: 'fort', v: 2 }, { op: 'mod', key: 'defMul', v: 0.08 }], { x: 2, y: 3 }),
      F('GER_sealion', '海狮计划', 130, ['GER_luftwaffe'],        // 与巴巴罗萨互斥：历史上正是这两条路线之争
        [{ op: 'mod', key: 'navalInvasion', v: 0.25 }, { op: 'tech', id: 'ftr_2' }, { op: 'equip', id: 'transport_plane', n: 200 }], { x: 5, y: 1, excl: ['GER_barbarossa'] }),
      F('GER_atlantic_wall', '大西洋壁垒', 150, ['GER_sealion'],
        [{ op: 'fort', v: 3 }, { op: 'mod', key: 'defMul', v: 0.10 }], { x: 5, y: 2 }),
      F('GER_total_war', '总体战', 180, ['GER_grossraum'],
        [{ op: 'mod', key: 'milOutput', v: 0.15 }, { op: 'mod', key: 'consumerGoods', v: -0.05 }, { op: 'manpower', v: 200 }], { x: 4, y: 1, hidden: { date: [1943, 1, 1] } }),
      F('GER_wunderwaffe', '奇迹武器', 200, ['GER_luftwaffe'],
        [{ op: 'tech', id: 'rocket_1' }, { op: 'tech', id: 'jet_1' }, { op: 'mod', key: 'airAtk', v: 0.15 }], { x: 1, y: 4, hidden: { date: [1943, 1, 1] } }),
      F('GER_oil_ploesti', '罗马尼亚油田保护', 90, ['GER_autarky'],
        [{ op: 'relation', tag: 'ROM', v: 40 }, { op: 'res', key: 'oil', v: 10 }], { x: 3, y: 4 }),
      F('GER_volkssturm', '国民突击队', 120, ['GER_total_war'],
        [{ op: 'manpower', v: 400 }, { op: 'mod', key: 'defMul', v: 0.10 }, { op: 'stab', v: -0.05 }], { x: 5, y: 4, hidden: { date: [1944, 7, 1] } }),
    ]);

    // ---------- 苏联：大清洗 vs 军队改革的分岔、工业东迁、原子计划 ----------
    push('SOV', [
      F('SOV_deep_battle', '大纵深战役理论', 140, ['SOV_tank_corps'],
        [{ op: 'mod', key: 'brkMul', v: 0.12 }, { op: 'mod', key: 'orgMul', v: 0.05 }], { x: 4, y: 1 }),
      F('SOV_stakhanov', '斯达汉诺夫运动', 120, [],
        [{ op: 'mod', key: 'milOutput', v: 0.08 }, { op: 'stab', v: 0.05 }], { x: 2, y: 3 }),
      F('SOV_ural', '乌拉尔工业带', 160, ['SOV_industry_east'],
        [{ op: 'factory', kind: 'civ', n: 6 }, { op: 'factory', kind: 'mil', n: 4 }], { x: 3, y: 4, hidden: { date: [1941, 7, 1] } }),
      F('SOV_katyusha', '喀秋莎火箭炮', 120, ['SOV_tank_corps'],
        [{ op: 'equip', id: 'artillery_2', n: 3000 }, { op: 'mod', key: 'softMul', v: 0.08 }], { x: 4, y: 4 }),
      F('SOV_atomic', '苏联原子弹计划', 300, ['SOV_rocket'],
        [{ op: 'tech', id: 'nuc_theory' }, { op: 'pp', v: 30 }], { x: 5, y: 1, hidden: { date: [1943, 1, 1] } }),
      F('SOV_deep_defense', '纵深防御体系', 130, ['SOV_reform'],
        [{ op: 'mod', key: 'defMul', v: 0.15 }, { op: 'fort', v: 2 }], { x: 2, y: 4 }),
    ]);

    // ---------- 英国：绥靖与强硬的岔路、丘吉尔、特别行动处、轰炸机司令部 ----------
    push('ENG', [
      F('ENG_churchill', '丘吉尔政府', 80, ['ENG_appease'],
        [{ op: 'ws', v: 0.15 }, { op: 'stab', v: 0.05 }, { op: 'pp', v: 20 }], { x: 3, y: 0, hidden: { date: [1940, 5, 10] } }),
      F('ENG_soe', '特别行动处（SOE）', 130, ['ENG_churchill'],
        [{ op: 'mod', key: 'researchSpeed', v: 0.05 }, { op: 'pp', v: 20 }, { op: 'event', id: 'EVT_soe' }], { x: 4, y: 0 }),
      F('ENG_bomber_cmd', '轰炸机司令部', 150, ['ENG_raf'],
        [{ op: 'tech', id: 'str_1' }, { op: 'mod', key: 'stratDamage', v: 0.25 }, { op: 'equip', id: 'strategic_bomber_1', n: 100 }], { x: 4, y: 1 }),
      F('ENG_monty', '蒙哥马利与第 8 集团军', 130, ['ENG_churchill'],
        [{ op: 'mod', key: 'orgMul', v: 0.08 }, { op: 'mod', key: 'planningMul', v: 0.20 }, { op: 'equip', id: 'infantry_equipment_2', n: 6000 }], { x: 5, y: 0, hidden: { date: [1942, 8, 1] } }),
      F('ENG_commonwealth', '自治领动员', 140, ['ENG_empire'],
        [{ op: 'manpower', v: 250 }, { op: 'relation', tag: 'CAN', v: 40 }, { op: 'relation', tag: 'AUS', v: 40 }, { op: 'relation', tag: 'IND', v: 30 }], { x: 2, y: 3 }),
      F('ENG_home_guard', '本土防卫与国民自卫军', 100, ['ENG_rearm'],
        [{ op: 'manpower', v: 150 }, { op: 'mod', key: 'defMul', v: 0.10 }], { x: 1, y: 3 }),
    ]);

    // ---------- 法国：装甲改革、维希与自由法国的岔路 ----------
    push('FRA', [
      F('FRA_de_gaulle', '戴高乐装甲理论', 130, ['FRA_armor'],
        [{ op: 'mod', key: 'brkMul', v: 0.15 }, { op: 'tech', id: 'armor_2' }, { op: 'template', id: 'armor_med' }], { x: 4, y: 0 }),
      F('FRA_vichy', '维希路线', 120, ['FRA_popular_front'],
        [{ op: 'stab', v: 0.10 }, { op: 'relation', tag: 'GER', v: 40 }, { op: 'ws', v: -0.15 }], { x: 3, y: 3, excl: ['FRA_free_france'], hidden: { date: [1940, 6, 22] } }),
      F('FRA_free_france', '自由法国', 120, ['FRA_colonial'],
        [{ op: 'ws', v: 0.15 }, { op: 'manpower', v: 120 }, { op: 'relation', tag: 'ENG', v: 50 }, { op: 'mod', key: 'orgMul', v: 0.05 }], { x: 4, y: 3, excl: ['FRA_vichy'], hidden: { date: [1940, 6, 18] } }),
      F('FRA_maginot_ext', '马奇诺延伸', 110, ['FRA_maginot'],
        [{ op: 'fort', v: 3 }, { op: 'mod', key: 'defMul', v: 0.10 }], { x: 2, y: 0 }),
      F('FRA_popular_front2', '人民阵线重整', 100, ['FRA_popular_front'],
        [{ op: 'stab', v: 0.10 }, { op: 'factory', kind: 'mil', n: 3 }, { op: 'mod', key: 'civOutput', v: 0.05 }], { x: 3, y: 2 }),
    ]);

    // ---------- 意大利：地中海帝国的两难 ----------
    push('ITA', [
      F('ITA_spain', '干涉西班牙', 100, ['ITA_rearm'],
        [{ op: 'relation', tag: 'SPA', v: 40 }, { op: 'mod', key: 'orgMul', v: 0.05 }, { op: 'pp', v: 20 }], { x: 2, y: 3 }),
      F('ITA_albania', '吞并阿尔巴尼亚', 80, ['ITA_spain'],
        [{ op: 'tension', v: 6 }, { op: 'manpower', v: 30 }, { op: 'pp', v: 15 }], { x: 3, y: 3 }),
      F('ITA_med_empire', '地中海帝国', 160, ['ITA_navy'],
        [{ op: 'mod', key: 'navalAtk', v: 0.15 }, { op: 'factory', kind: 'dock', n: 3 }, { op: 'mod', key: 'navalInvasion', v: 0.15 }], { x: 4, y: 2, excl: ['ITA_alps'] }),
      F('ITA_folgore', '闪电伞兵师', 120, ['ITA_armor'],
        [{ op: 'template', id: 'para' }, { op: 'troops', id: 'para', n: 2 }], { x: 3, y: 4 }),
      F('ITA_armistice', '停战与南部王国', 140, ['ITA_greece'],
        [{ op: 'stab', v: -0.10 }, { op: 'relation', tag: 'ENG', v: 40 }, { op: 'ws', v: -0.20 }], { x: 5, y: 3, hidden: { date: [1943, 9, 1] } }),
    ]);

    // ---------- 美国：孤立 → 租借 → 民主兵工厂 → 两洋战争 ----------
    T.USA = {
      nodes: [
        F('USA_new_deal', '罗斯福新政', 110, [], [{ op: 'factory', kind: 'civ', n: 6 }, { op: 'stab', v: 0.05 }], { x: 1, y: 0 }),
        F('USA_good_neighbor', '睦邻政策', 90, [], [{ op: 'relation', tag: 'BRA', v: 30 }, { op: 'relation', tag: 'MEX', v: 30 }, { op: 'pp', v: 20 }], { x: 1, y: 1 }),
        F('USA_neutrality', '中立法案', 80, [], [{ op: 'tension', v: -6 }, { op: 'stab', v: 0.05 }, { op: 'ws', v: -0.05 }], { x: 2, y: 1 }),
        F('USA_cash_carry', '现购自运', 90, ['USA_neutrality'], [{ op: 'relation', tag: 'ENG', v: 40 }, { op: 'relation', tag: 'FRA', v: 30 }, { op: 'pp', v: 15 }], { x: 3, y: 1, hidden: { date: [1939, 11, 1] } }),
        F('USA_lend_lease', '租借法案', 120, ['USA_cash_carry'], [{ op: 'mod', key: 'lendLease', v: 0.25 }, { op: 'tension', v: 8 }, { op: 'event', id: 'EVT_usa_enters' }], { x: 4, y: 1 }),
        F('USA_isolation_forever', '严守孤立', 100, ['USA_neutrality'], [{ op: 'tension', v: -10 }, { op: 'stab', v: 0.10 }, { op: 'ws', v: -0.10 }], { x: 3, y: 0, excl: ['USA_lend_lease'] }),
        F('USA_two_ocean_navy', '两洋海军法案', 150, ['USA_new_deal'], [{ op: 'factory', kind: 'dock', n: 6 }, { op: 'tech', id: 'nav_1' }], { x: 2, y: 2 }),
        F('USA_draft', '选征兵役法', 110, ['USA_new_deal'], [{ op: 'manpower', v: 300 }, { op: 'mod', key: 'conscription', v: 1 }], { x: 2, y: 3, hidden: { date: [1940, 9, 1] } }),
        F('USA_arsenal', '民主兵工厂', 180, ['USA_lend_lease'], [{ op: 'factory', kind: 'mil', n: 10 }, { op: 'factory', kind: 'civ', n: 8 }, { op: 'mod', key: 'milOutput', v: 0.10 }], { x: 5, y: 2 }),
        F('USA_manhattan', '曼哈顿计划', 300, ['USA_arsenal'], [{ op: 'tech', id: 'nuc_theory' }, { op: 'mod', key: 'researchSpeed', v: 0.08 }], { x: 6, y: 2, hidden: { date: [1941, 12, 1] } }),
        F('USA_strat_bombing', '战略轰炸攻势', 160, ['USA_arsenal'], [{ op: 'tech', id: 'str_1' }, { op: 'mod', key: 'stratDamage', v: 0.30 }, { op: 'equip', id: 'strategic_bomber_1', n: 150 }], { x: 6, y: 1 }),
        F('USA_torch', '火炬行动', 140, ['USA_arsenal'], [{ op: 'mod', key: 'navalInvasion', v: 0.20 }, { op: 'equip', id: 'infantry_equipment_2', n: 8000 }], { x: 5, y: 3, hidden: { date: [1942, 11, 1] } }),
        F('USA_overlord', '霸王行动', 200, ['USA_torch'], [{ op: 'mod', key: 'navalInvasion', v: 0.30 }, { op: 'tech', id: 'mech_1' }, { op: 'troops', id: 'armor_med', n: 3 }], { x: 6, y: 3, hidden: { date: [1944, 6, 1] } }),
        F('USA_pacific', '太平洋反攻', 150, ['USA_two_ocean_navy'], [{ op: 'mod', key: 'navalAtk', v: 0.20 }, { op: 'template', id: 'marine' }, { op: 'troops', id: 'marine', n: 4 }], { x: 4, y: 4, hidden: { date: [1942, 6, 1] } }),
        F('USA_air_superiority', '制空权战略', 140, ['USA_arsenal'], [{ op: 'tech', id: 'ftr_2' }, { op: 'equip', id: 'fighter_2', n: 800 }], { x: 5, y: 4 }),
        F('USA_research_boom', '国家实验室体系', 130, ['USA_new_deal'], [{ op: 'mod', key: 'researchSpeed', v: 0.10 }, { op: 'slot', v: 1 }], { x: 3, y: 4 }),
      ],
    };

    // ---------- 日本：北进 vs 南进、珍珠港、大东亚 ----------
    T.JAP = {
      nodes: [
        F('JAP_kokutai', '国体明征', 70, [], [{ op: 'stab', v: 0.10 }, { op: 'ws', v: 0.05 }], { x: 1, y: 0 }),
        F('JAP_manchukuo', '满洲经营', 110, ['JAP_kokutai'], [{ op: 'res', key: 'steel', v: 10 }, { op: 'factory', kind: 'mil', n: 3 }, { op: 'res', key: 'tungsten', v: 6 }], { x: 2, y: 0 }),
        F('JAP_china_war', '支那事变扩大', 100, ['JAP_manchukuo'], [{ op: 'wargoal', tag: 'CHI' }, { op: 'tension', v: 10 }, { op: 'ws', v: 0.10 }], { x: 3, y: 0 }),
        F('JAP_north', '北进论', 120, ['JAP_manchukuo'], [{ op: 'wargoal', tag: 'SOV' }, { op: 'mod', key: 'brkMul', v: 0.10 }], { x: 3, y: 1, excl: ['JAP_south'] }),
        F('JAP_south', '南进论', 120, ['JAP_manchukuo'], [{ op: 'res', key: 'oil', v: 10 }, { op: 'res', key: 'rubber', v: 8 }, { op: 'wargoal', tag: 'ENG' }], { x: 3, y: 2, excl: ['JAP_north'] }),
        F('JAP_combined_fleet', '联合舰队扩张', 140, ['JAP_kokutai'], [{ op: 'factory', kind: 'dock', n: 5 }, { op: 'tech', id: 'nav_1' }, { op: 'equip', id: 'battleship', n: 4 }], { x: 2, y: 3 }),
        F('JAP_zero', '零式战斗机', 130, ['JAP_kokutai'], [{ op: 'tech', id: 'ftr_2' }, { op: 'equip', id: 'fighter_2', n: 500 }], { x: 2, y: 4 }),
        F('JAP_tripartite', '三国同盟', 80, ['JAP_kokutai'], [{ op: 'faction_join', tag: 'GER' }, { op: 'tension', v: 8 }], { x: 4, y: 3 }),
        F('JAP_pearl', '珍珠港奇袭', 150, ['JAP_south', 'JAP_combined_fleet'], [{ op: 'declare_war', tag: 'USA' }, { op: 'tension', v: 30 }, { op: 'mod', key: 'navalAtk', v: 0.20 }], { x: 5, y: 2, hidden: { date: [1941, 12, 1] } }),
        F('JAP_greater_asia', '大东亚共荣圈', 160, ['JAP_south'], [{ op: 'relation', tag: 'SIA', v: 40 }, { op: 'manpower', v: 150 }, { op: 'res', key: 'oil', v: 8 }], { x: 5, y: 1 }),
        F('JAP_industry', '军需工业扩张', 130, ['JAP_china_war'], [{ op: 'factory', kind: 'mil', n: 5 }, { op: 'mod', key: 'milOutput', v: 0.08 }], { x: 4, y: 0 }),
        F('JAP_kamikaze', '神风特攻', 140, ['JAP_pearl'], [{ op: 'mod', key: 'casBonus', v: 0.20 }, { op: 'mod', key: 'navalAtk', v: 0.15 }, { op: 'stab', v: -0.05 }], { x: 6, y: 2, hidden: { date: [1944, 10, 1] } }),
      ],
    };

    // ---------- 中国：剿共 vs 统一战线，持久战与美援 ----------
    T.CHI = {
      nodes: [
        F('CHI_golden_decade', '黄金十年', 110, [], [{ op: 'factory', kind: 'civ', n: 4 }, { op: 'stab', v: 0.08 }], { x: 1, y: 0 }),
        F('CHI_encircle', '攘外必先安内', 100, [], [{ op: 'pp', v: 40 }, { op: 'stab', v: 0.05 }, { op: 'ws', v: -0.05 }], { x: 1, y: 1, excl: ['CHI_united_front'] }),
        F('CHI_united_front', '抗日民族统一战线', 100, ['CHI_golden_decade'], [{ op: 'ws', v: 0.15 }, { op: 'relation', tag: 'SOV', v: 40 }, { op: 'manpower', v: 200 }], { x: 2, y: 1, excl: ['CHI_encircle'], hidden: { date: [1937, 7, 7] } }),
        F('CHI_attrition', '持久战', 140, ['CHI_united_front'], [{ op: 'mod', key: 'defMul', v: 0.15 }, { op: 'mod', key: 'orgMul', v: 0.05 }, { op: 'manpower', v: 300 }], { x: 3, y: 1 }),
        F('CHI_scorched', '焦土抗战', 90, ['CHI_united_front'], [{ op: 'mod', key: 'defMul', v: 0.10 }, { op: 'stab', v: -0.05 }, { op: 'mod', key: 'consumerGoods', v: 0.05 }], { x: 3, y: 0 }),
        F('CHI_industry_move', '工业内迁', 130, ['CHI_golden_decade'], [{ op: 'factory', kind: 'mil', n: 3 }, { op: 'factory', kind: 'civ', n: 3 }], { x: 2, y: 2, hidden: { date: [1938, 1, 1] } }),
        F('CHI_burma_road', '滇缅公路', 120, ['CHI_industry_move'], [{ op: 'mod', key: 'supplyRange', v: 4 }, { op: 'equip', id: 'infantry_equipment_2', n: 4000 }], { x: 3, y: 2 }),
        F('CHI_us_aid', '争取美援', 110, ['CHI_golden_decade'], [{ op: 'relation', tag: 'USA', v: 50 }, { op: 'equip', id: 'infantry_equipment_1', n: 8000 }], { x: 2, y: 3, hidden: { date: [1941, 1, 1] } }),
        F('CHI_hump', '驼峰航线', 130, ['CHI_us_aid'], [{ op: 'mod', key: 'supplyRange', v: 3 }, { op: 'mod', key: 'lendLease', v: 0.20 }], { x: 3, y: 3, hidden: { date: [1942, 5, 1] } }),
        F('CHI_expedition', '中国远征军', 140, ['CHI_burma_road'], [{ op: 'template', id: 'mount' }, { op: 'troops', id: 'mount', n: 4 }, { op: 'mod', key: 'orgMul', v: 0.05 }], { x: 4, y: 2, hidden: { date: [1942, 3, 1] } }),
        F('CHI_air_force', '空军重建', 120, ['CHI_us_aid'], [{ op: 'tech', id: 'ftr_1' }, { op: 'equip', id: 'fighter_1', n: 200 }], { x: 4, y: 3 }),
      ],
    };

    // ---------- 波兰：骑兵传统与英法同盟 ----------
    T.POL = {
      nodes: [
        F('POL_central_industry', '中央工业区', 120, [], [{ op: 'factory', kind: 'civ', n: 3 }, { op: 'factory', kind: 'mil', n: 2 }], { x: 1, y: 0 }),
        F('POL_cavalry', '骑兵传统', 90, [], [{ op: 'mod', key: 'speedMul', v: 0.10 }, { op: 'template', id: 'cav' }], { x: 1, y: 1 }),
        F('POL_west_army', '西方军', 110, ['POL_central_industry'], [{ op: 'troops', id: 'inf_9_1', n: 5 }, { op: 'manpower', v: 100 }], { x: 2, y: 0 }),
        F('POL_ally_eng', '英波同盟', 90, ['POL_central_industry'], [{ op: 'relation', tag: 'ENG', v: 50 }, { op: 'guarantee', tag: 'POL' }], { x: 2, y: 1 }),
        F('POL_ally_fra', '法波军事协定', 90, ['POL_ally_eng'], [{ op: 'relation', tag: 'FRA', v: 50 }, { op: 'tech', id: 'at_1' }], { x: 3, y: 1 }),
        F('POL_plan_zachod', '西方计划', 120, ['POL_ally_fra'], [{ op: 'mod', key: 'defMul', v: 0.15 }, { op: 'fort', v: 1 }], { x: 4, y: 1 }),
        F('POL_romania_bridge', '罗马尼亚桥头堡', 100, [], [{ op: 'relation', tag: 'ROM', v: 40 }, { op: 'guarantee', tag: 'ROM' }], { x: 1, y: 2 }),
      ],
    };

    // ---------- 土耳其：凯末尔主义与中立外交 ----------
    T.TUR = {
      nodes: [
        F('TUR_kemalist', '凯末尔主义改革', 120, [], [{ op: 'stab', v: 0.10 }, { op: 'factory', kind: 'civ', n: 3 }], { x: 1, y: 0 }),
        F('TUR_straits', '海峡公约', 90, [], [{ op: 'pp', v: 25 }, { op: 'tension', v: -3 }], { x: 1, y: 1 }),
        F('TUR_army_modern', '陆军现代化', 120, ['TUR_kemalist'], [{ op: 'troops', id: 'inf_9_1', n: 6 }, { op: 'tech', id: 'inf_weap_1' }], { x: 2, y: 0 }),
        F('TUR_chromium_deal', '铬矿外交', 100, ['TUR_kemalist'], [{ op: 'res', key: 'chromium', v: 8 }, { op: 'pp', v: 20 }], { x: 2, y: 1 }),
        F('TUR_axis_leaning', '亲轴心倾向', 110, ['TUR_chromium_deal'], [{ op: 'relation', tag: 'GER', v: 40 }, { op: 'res', key: 'chromium', v: 6 }], { x: 3, y: 1, excl: ['TUR_allied_leaning'] }),
        F('TUR_allied_leaning', '亲盟国倾向', 110, ['TUR_chromium_deal'], [{ op: 'relation', tag: 'ENG', v: 40 }, { op: 'equip', id: 'infantry_equipment_1', n: 4000 }], { x: 3, y: 0, excl: ['TUR_axis_leaning'] }),
        F('TUR_neutrality', '武装中立', 130, ['TUR_straits'], [{ op: 'mod', key: 'defMul', v: 0.15 }, { op: 'stab', v: 0.05 }], { x: 3, y: 2 }),
      ],
    };

    // ---------- 西班牙：国民军与共和派的岔路 ----------
    T.SPA = {
      nodes: [
        F('SPA_nationalists', '国民军起义', 90, [], [{ op: 'stab', v: -0.10 }, { op: 'ws', v: 0.15 }, { op: 'mod', key: 'orgMul', v: 0.05 }], { x: 1, y: 0, excl: ['SPA_republic'] }),
        F('SPA_republic', '共和派抵抗', 90, [], [{ op: 'stab', v: 0.05 }, { op: 'relation', tag: 'SOV', v: 40 }, { op: 'pp', v: 20 }], { x: 1, y: 1, excl: ['SPA_nationalists'] }),
        F('SPA_rebuild', '战后重建', 140, ['SPA_nationalists'], [{ op: 'factory', kind: 'civ', n: 3 }, { op: 'stab', v: 0.10 }], { x: 2, y: 0 }),
        F('SPA_blue_division', '蓝色师', 120, ['SPA_rebuild'], [{ op: 'relation', tag: 'GER', v: 40 }, { op: 'troops', id: 'inf_9_1', n: 2 }], { x: 3, y: 0 }),
        F('SPA_autarky', '自给自足经济', 130, ['SPA_rebuild'], [{ op: 'mod', key: 'resourceFactor', v: 0.10 }, { op: 'res', key: 'tungsten', v: 4 }], { x: 3, y: 1 }),
        F('SPA_neutrality', '严守中立', 110, [], [{ op: 'tension', v: -5 }, { op: 'stab', v: 0.05 }], { x: 2, y: 2 }),
      ],
    };

    // ---------- 罗马尼亚：亲轴心 vs 亲盟国的石油外交 ----------
    T.ROM = {
      nodes: [
        F('ROM_oil_industry', '普洛耶什蒂油田扩建', 120, [], [{ op: 'res', key: 'oil', v: 10 }, { op: 'factory', kind: 'civ', n: 2 }], { x: 1, y: 0 }),
        F('ROM_army_modern', '陆军现代化', 110, [], [{ op: 'troops', id: 'inf_9_1', n: 4 }, { op: 'tech', id: 'inf_weap_1' }], { x: 1, y: 1 }),
        F('ROM_axis', '加入轴心', 100, ['ROM_oil_industry'], [{ op: 'faction_join', tag: 'GER' }, { op: 'relation', tag: 'GER', v: 50 }], { x: 2, y: 0, excl: ['ROM_allies'] }),
        F('ROM_allies', '小协约国', 100, ['ROM_army_modern'], [{ op: 'relation', tag: 'FRA', v: 40 }, { op: 'relation', tag: 'ENG', v: 30 }, { op: 'guarantee', tag: 'CZE' }], { x: 2, y: 1, excl: ['ROM_axis'] }),
        F('ROM_bessarabia', '比萨拉比亚防务', 110, ['ROM_army_modern'], [{ op: 'fort', v: 2 }, { op: 'mod', key: 'defMul', v: 0.10 }], { x: 2, y: 2 }),
        F('ROM_ploesti_defense', '油田防空', 120, ['ROM_oil_industry'], [{ op: 'mod', key: 'aaMul', v: 0.30 }, { op: 'res', key: 'oil', v: 4 }], { x: 3, y: 0 }),
      ],
    };

    // ---------- 南斯拉夫 / 芬兰 / 加拿大 / 印度：区域性历史路线 ----------
    T.YUG = {
      nodes: [
        F('YUG_unity', '南斯拉夫统一', 110, [], [{ op: 'stab', v: 0.08 }, { op: 'manpower', v: 80 }], { x: 1, y: 0 }),
        F('YUG_army', '陆军扩充', 110, [], [{ op: 'troops', id: 'inf_9_1', n: 5 }, { op: 'tech', id: 'inf_weap_1' }], { x: 1, y: 1 }),
        F('YUG_axis_pact', '加入三国同盟', 100, ['YUG_unity'], [{ op: 'relation', tag: 'GER', v: 50 }, { op: 'tension', v: -5 }], { x: 2, y: 1, excl: ['YUG_coup'] }),
        F('YUG_coup', '三月政变', 90, ['YUG_army'], [{ op: 'relation', tag: 'ENG', v: 50 }, { op: 'ws', v: 0.15 }, { op: 'stab', v: -0.05 }], { x: 2, y: 0, excl: ['YUG_axis_pact'], hidden: { date: [1941, 3, 27] } }),
        F('YUG_partisans', '游击队抵抗', 130, ['YUG_coup'], [{ op: 'mod', key: 'defMul', v: 0.15 }, { op: 'manpower', v: 120 }], { x: 3, y: 0, hidden: { date: [1941, 6, 1] } }),
      ],
    };
    T.FIN = {
      nodes: [
        F('FIN_defense', '曼纳海姆防线', 120, [], [{ op: 'fort', v: 3 }, { op: 'mod', key: 'defMul', v: 0.15 }], { x: 1, y: 0 }),
        F('FIN_winter', '冬季战争准备', 110, [], [{ op: 'manpower', v: 60 }, { op: 'mod', key: 'speedMul', v: 0.10 }], { x: 1, y: 1 }),
        F('FIN_continuation', '继续战争', 120, ['FIN_winter'], [{ op: 'relation', tag: 'GER', v: 40 }, { op: 'wargoal', tag: 'SOV' }], { x: 2, y: 1 }),
        F('FIN_industry', '森林工业', 100, [], [{ op: 'factory', kind: 'civ', n: 2 }, { op: 'res', key: 'steel', v: 3 }], { x: 2, y: 0 }),
      ],
    };
    T.CAN = {
      nodes: [
        F('CAN_mobilize', '自治领动员', 120, [], [{ op: 'manpower', v: 150 }, { op: 'troops', id: 'inf_9_1', n: 4 }], { x: 1, y: 0 }),
        F('CAN_industry', '战时工业', 130, [], [{ op: 'factory', kind: 'civ', n: 3 }, { op: 'factory', kind: 'mil', n: 2 }], { x: 1, y: 1 }),
        F('CAN_navy', '大西洋护航', 120, ['CAN_mobilize'], [{ op: 'factory', kind: 'dock', n: 3 }, { op: 'mod', key: 'asw', v: 0.30 }], { x: 2, y: 0 }),
        F('CAN_commonwealth_air', '英联邦航空训练计划', 130, ['CAN_industry'], [{ op: 'tech', id: 'ftr_1' }, { op: 'equip', id: 'fighter_1', n: 300 }], { x: 2, y: 1 }),
      ],
    };
    T.IND = {
      nodes: [
        F('IND_industry', '印度工业发展', 130, [], [{ op: 'factory', kind: 'civ', n: 4 }, { op: 'factory', kind: 'mil', n: 2 }], { x: 1, y: 0 }),
        F('IND_army', '英印军扩充', 120, [], [{ op: 'manpower', v: 300 }, { op: 'troops', id: 'inf_9_1', n: 6 }], { x: 1, y: 1 }),
        F('IND_congress', '国大党运动', 110, [], [{ op: 'stab', v: -0.05 }, { op: 'pp', v: 40 }], { x: 2, y: 0, excl: ['IND_loyalists'] }),
        F('IND_loyalists', '效忠帝国', 110, [], [{ op: 'relation', tag: 'ENG', v: 40 }, { op: 'equip', id: 'infantry_equipment_1', n: 6000 }], { x: 2, y: 1, excl: ['IND_congress'] }),
        F('IND_burma_front', '缅甸战线', 130, ['IND_army'], [{ op: 'mod', key: 'defMul', v: 0.10 }, { op: 'troops', id: 'mount', n: 3 }], { x: 3, y: 1 }),
      ],
    };
    T.BRA = {
      nodes: [
        F('BRA_vargas', '瓦加斯新政', 120, [], [{ op: 'factory', kind: 'civ', n: 3 }, { op: 'stab', v: 0.08 }], { x: 1, y: 0 }),
        F('BRA_army', '陆军现代化', 110, [], [{ op: 'troops', id: 'inf_9_1', n: 4 }, { op: 'tech', id: 'inf_weap_1' }], { x: 1, y: 1 }),
        F('BRA_pro_usa', '亲美路线', 110, ['BRA_vargas'], [{ op: 'relation', tag: 'USA', v: 50 }, { op: 'res', key: 'rubber', v: 6 }], { x: 2, y: 0, excl: ['BRA_axis_sympathy'] }),
        F('BRA_axis_sympathy', '轴心同情', 110, ['BRA_army'], [{ op: 'relation', tag: 'GER', v: 30 }, { op: 'pp', v: 20 }], { x: 2, y: 1, excl: ['BRA_pro_usa'] }),
        F('BRA_expedition', '巴西远征军', 140, ['BRA_pro_usa'], [{ op: 'troops', id: 'inf_9_1', n: 3 }, { op: 'relation', tag: 'USA', v: 30 }], { x: 3, y: 0, hidden: { date: [1943, 1, 1] } }),
      ],
    };

    // ---------- 通用树（未单列国家）：工业/军事/外交三线 ----------
    push('generic', [
      F('GEN_air', '空军建设', 120, [], [{ op: 'tech', id: 'ftr_1' }, { op: 'equip', id: 'fighter_1', n: 150 }], { x: 2, y: 2 }),
      F('GEN_navy', '海军建设', 130, [], [{ op: 'factory', kind: 'dock', n: 2 }, { op: 'tech', id: 'nav_1' }], { x: 3, y: 2 }),
      F('GEN_neutrality', '严守中立', 100, [], [{ op: 'tension', v: -4 }, { op: 'stab', v: 0.06 }], { x: 4, y: 2 }),
      F('GEN_join_allies', '加入同盟国', 110, ['GEN_neutrality'], [{ op: 'faction_join', tag: 'ENG' }, { op: 'relation', tag: 'ENG', v: 40 }], { x: 5, y: 2, excl: ['GEN_join_axis'] }),
      F('GEN_join_axis', '加入轴心', 110, ['GEN_neutrality'], [{ op: 'faction_join', tag: 'GER' }, { op: 'relation', tag: 'GER', v: 40 }], { x: 5, y: 1, excl: ['GEN_join_allies'] }),
    ]);
  })();

  // ============================================================
  PSE.EVENTS = {
    EVT_rhineland: {
      id: 'EVT_rhineland', title: '莱茵兰再军事化', tag: 'GER',
      desc: '德军开进莱茵兰非军事区。英法会作何反应？',
      trigger: { op: 'focus', id: 'GER_rhineland' }, once: true, fireDelayH: 24,
      options: [
        { name: '试探性推进', effects: [{ op: 'tension', v: 3 }, { op: 'ws', v: 0.03 }] },
        { name: '全力进驻', effects: [{ op: 'tension', v: 8 }, { op: 'ws', v: 0.06 }, { op: 'pp', v: -10 }] },
      ],
    },
    EVT_anschluss: {
      id: 'EVT_anschluss', title: '德奥合并', tag: 'GER',
      desc: '奥地利并入德意志帝国，未遭抵抗。',
      trigger: { op: 'focus', id: 'GER_anschluss' }, once: true,
      options: [{ name: '欢呼', effects: [{ op: 'tension', v: 5 }, { op: 'manpower', v: 15 }] }],
    },
    EVT_munich: {
      id: 'EVT_munich', title: '慕尼黑协定', tag: 'GER',
      desc: '四国会议决定将苏台德割让给德国。捷克被牺牲。',
      trigger: { op: 'focus', id: 'GER_sudeten' }, once: true,
      options: [
        { name: '接受苏台德', effects: [{ op: 'annex_state', tag: 'CZE', frac: 0.5 }, { op: 'tension', v: 6 }] },
        { name: '要求全部', effects: [{ op: 'annex', tag: 'CZE' }, { op: 'tension', v: 14 }, { op: 'relation', tag: 'ENG', v: -30 }, { op: 'relation', tag: 'FRA', v: -30 }] },
      ],
    },
    EVT_danzig: {
      id: 'EVT_danzig', title: '但泽危机', tag: 'GER',
      desc: '波兰拒绝交出但泽走廊。战争一触即发。',
      trigger: { op: 'focus', id: 'GER_danzig' }, once: true,
      options: [
        { name: '立即进攻波兰', effects: [{ op: 'declare_war', tag: 'POL' }, { op: 'tension', v: 25 }] },
        { name: '再等一年', effects: [{ op: 'stab', v: -0.05 }, { op: 'ws', v: 0.05 }, { op: 'delay_war', tag: 'POL', days: 180 }] },
      ],
    },
    EVT_molotov: {
      id: 'EVT_molotov', title: '苏德互不侵犯条约', tag: 'GER',
      desc: '两国划分东欧势力范围。',
      trigger: { op: 'focus', id: 'GER_molotov' }, once: true,
      options: [{ name: '签署秘密议定书', effects: [{ op: 'relation', tag: 'SOV', v: 50 }, { op: 'tension', v: -5 }, { op: 'pact', tag: 'SOV' }] }],
    },
    EVT_spanish_civil_war: {
      id: 'EVT_spanish_civil_war', title: '西班牙内战', tag: '*',
      desc: '西班牙爆发内战，各方势力蠢蠢欲动。',
      trigger: { op: 'date_after', y: 1936, m: 7, d: 17 }, once: true, randomPct: 60,
      options: [
        { name: '支持国民军', effects: [{ op: 'target_stab', tag: 'SPA', v: -0.25 }, { op: 'tension', v: 4 }] },
        { name: '保持中立', effects: [{ op: 'target_stab', tag: 'SPA', v: -0.30 }] },
      ],
    },
    EVT_winter_war: {
      id: 'EVT_winter_war', title: '冬季战争', tag: 'SOV',
      desc: '苏联向芬兰提出领土要求，遭拒后发动进攻。',
      trigger: { op: 'and', ts: [{ op: 'date_after', y: 1939, m: 10, d: 1 }, { op: 'tag_is', tag: 'SOV' }] }, once: true, randomPct: 30,
      options: [
        { name: '发动冬季战争', effects: [{ op: 'declare_war', tag: 'FIN' }, { op: 'tension', v: 10 }] },
        { name: '继续谈判', effects: [{ op: 'pp', v: -10 }] },
      ],
    },
    EVT_barbarossa: {
      id: 'EVT_barbarossa', title: '巴巴罗萨行动', tag: 'GER',
      desc: '三百万轴心国军队沿整个东线发起进攻。',
      trigger: { op: 'focus', id: 'GER_barbarossa' }, once: true,
      options: [{ name: '全线进攻', effects: [{ op: 'declare_war', tag: 'SOV' }, { op: 'tension', v: 30 }, { op: 'mod_self', key: 'brkMul', v: 0.10 }] }],
    },
    EVT_poland_falls: {
      id: 'EVT_poland_falls', title: '波兰陷落', tag: '*',
      desc: '波兰政府流亡伦敦，本土被瓜分。',
      trigger: { op: 'captured', tag: 'POL' }, once: true,
      options: [{ name: '局势既定', effects: [{ op: 'tension', v: 10 }] }],
    },
    EVT_france_falls: {
      id: 'EVT_france_falls', title: '法国投降', tag: '*',
      desc: '巴黎陷落，法国签署停战协定，自由法国在伦敦继续抗争。',
      trigger: { op: 'captured', tag: 'FRA' }, once: true,
      options: [{ name: '维希政府成立', effects: [{ op: 'tension', v: 20 }] }],
    },
    EVT_battle_of_britain: {
      id: 'EVT_battle_of_britain', title: '不列颠空战', tag: 'ENG',
      desc: '德国空军对英国本土发动大规模空袭。',
      trigger: { op: 'and', ts: [{ op: 'at_war', a: 'GER', b: 'ENG' }, { op: 'date_after', y: 1940, m: 7, d: 1 }] }, once: true,
      options: [{ name: '坚持抵抗', effects: [{ op: 'ws', v: 0.10 }, { op: 'stab', v: 0.05 }] }],
    },
    EVT_usa_enters: {
      id: 'EVT_usa_enters', title: '美国租借与参战倾向', tag: '*',
      desc: '大洋彼岸的工业巨人开始倾斜天平。',
      trigger: { op: 'and', ts: [{ op: 'date_after', y: 1941, m: 1, d: 1 }, { op: 'tension_above', v: 40 }] }, once: true,
      options: [{ name: '租借法案通过', effects: [{ op: 'mod_all_allies', key: 'lendLease', v: 0.15 }, { op: 'tension', v: 5 }] }],
    },
    EVT_soviet_industry: {
      id: 'EVT_soviet_industry', title: '工业东迁', tag: 'SOV',
      desc: '上千家工厂被拆解运往乌拉尔以东。',
      trigger: { op: 'and', ts: [{ op: 'at_war', a: 'GER', b: 'SOV' }, { op: 'date_after', y: 1941, m: 8, d: 1 }] }, once: true,
      options: [{ name: '执行东迁', effects: [{ op: 'factory', kind: 'mil', n: 5 }, { op: 'stab', v: -0.05 }] }],
    },
    EVT_nuke_ready: {
      id: 'EVT_nuke_ready', title: '核装置就绪', tag: '*',
      desc: '第一枚核装置组装完成，人类进入原子时代。',
      trigger: { op: 'has_tech_any', id: 'nuc_bomb' }, once: true,
      options: [{ name: '记录在案', effects: [{ op: 'tension', v: 15 }, { op: 'pp', v: 50 }] }],
    },
  };

  // ============================================================
  // 8. 内阁顾问（消耗政治点，提供持续修正）
  // ============================================================
  PSE.ADVISORS = [
    { id: 'adv_prop', name: '宣传部长', cost: 75, pp: 0.5, desc: '每日政治点 +0.5' },
    { id: 'adv_order', name: '内政部长', cost: 75, mods: { consumerGoods: -0.05 }, desc: '消费品 −5%' },
    { id: 'adv_sci', name: '工业规划师', cost: 90, mods: { researchSpeed: 0.05 }, desc: '科研速度 +5%' },
    { id: 'adv_chief', name: '总参谋长', cost: 100, mods: { orgMul: 0.05 }, desc: '组织度 +5%' },
    { id: 'adv_armor', name: '装甲兵总监', cost: 100, mods: { brkMul: 0.08 }, desc: '突破 +8%' },
    { id: 'adv_art', name: '炮兵总监', cost: 100, mods: { softMul: 0.06 }, desc: '软攻 +6%' },
    { id: 'adv_eco', name: '经济部长', cost: 90, mods: { civOutput: 0.05, buildSpeed: 0.05 }, desc: '民用产出与建造 +5%' },
    { id: 'adv_air', name: '空军总监', cost: 90, mods: { airAtk: 0.10, casBonus: 0.10 }, desc: '空军攻击与近距支援 +10%' },
    { id: 'adv_navy', name: '海军总监', cost: 90, mods: { navalAtk: 0.10 }, desc: '海军攻击 +10%' },
    { id: 'adv_supply', name: '后勤总监', cost: 90, mods: { supplyRange: 3 }, desc: '补给范围 +3 跳' },
  ];

  // ============================================================
  // 9. 建筑成本
  // ============================================================
  PSE.BUILDINGS = {
    civ: { name: '民用工厂', cost: 10800, perSlot: 2, output: 'build' },
    mil: { name: '军用工厂', cost: 7200, perSlot: 2, output: 'equip' },
    dock: { name: '海军船坞', cost: 6400, perSlot: 2, output: 'ship', coastal: true },
    infra: { name: '基础设施', cost: 3000, maxLevel: 5 },
    rail: { name: '铁路', cost: 4000, maxLevel: 5 },
    fort: { name: '要塞', cost: 3000, maxLevel: 10 },
    airbase: { name: '机场', cost: 2500, maxLevel: 4 },
    reactor: { name: '核反应堆', cost: 25000, maxLevel: 1 },
    rocket_site: { name: '火箭基地', cost: 12000, maxLevel: 1 },
  };

  // 剧本起始日期
  PSE.START = { year: 1936, month: 1, day: 1 };
})(typeof window !== 'undefined' ? window : globalThis);
