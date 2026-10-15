/* PSE · 世界地图生成器 (tools/build-map.js)
 * 输入：data/countries-110m.json（Natural Earth 110m TopoJSON，真实海岸线与国界，全球）
 * 处理：TopoJSON 解码 → 国家多边形 → 每国内部按城市+采样点做 Voronoi 半平面裁剪
 *       → 不规则省份多边形 → 邻接（几何共享弧段判定陆地边界 vs 跨海通道）
 *       → 沿海/海区/地形/资源/人口
 * 输出：data/map-generated.js（供 src/data-map.js 直接消费）
 *
 * 用法： node tools/build-map.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'countries-110m.json');
const OUT = path.join(ROOT, 'data', 'map-generated.js');

// ============================================================
// 1. 全球归属映射（Natural Earth 名称 → 本作国家代码；1936 年疆域口径）
// ============================================================
const NAME_TO_CODE = {
  // —— 欧洲 ——
  'Germany': 'GER', 'France': 'FRA', 'United Kingdom': 'ENG', 'Italy': 'ITA',
  'Russia': 'SOV', 'Ukraine': 'SOV', 'Belarus': 'SOV', 'Moldova': 'SOV',
  'Georgia': 'SOV', 'Armenia': 'SOV', 'Azerbaijan': 'SOV',
  'Kazakhstan': 'SOV', 'Uzbekistan': 'SOV', 'Turkmenistan': 'SOV',
  'Kyrgyzstan': 'SOV', 'Tajikistan': 'SOV',
  'Poland': 'POL', 'Czechia': 'CZE', 'Slovakia': 'CZE',
  'Austria': 'AUT', 'Hungary': 'HUN', 'Romania': 'ROM',
  'Serbia': 'YUG', 'Bosnia and Herz.': 'YUG', 'Croatia': 'YUG', 'Montenegro': 'YUG',
  'Slovenia': 'YUG', 'Macedonia': 'YUG', 'Kosovo': 'YUG',
  'Bulgaria': 'BUL', 'Greece': 'GRE', 'Turkey': 'TUR',
  'Spain': 'SPA', 'Portugal': 'POR', 'Switzerland': 'SWI',
  'Netherlands': 'LOW', 'Belgium': 'LOW', 'Luxembourg': 'LOW',
  'Denmark': 'DEN', 'Sweden': 'SWE', 'Norway': 'NOR', 'Finland': 'FIN',
  'Estonia': 'BAL', 'Latvia': 'BAL', 'Lithuania': 'BAL',
  'Ireland': 'IRE', 'Iceland': 'ICE',
  // —— 非洲（殖民地 + 独立国）——
  'Algeria': 'FRA', 'Tunisia': 'FRA', 'Morocco': 'FRA', 'W. Sahara': 'SPA',
  'Mauritania': 'FRA', 'Mali': 'FRA', 'Niger': 'FRA', 'Chad': 'FRA',
  'Senegal': 'FRA', 'Guinea': 'FRA', 'Ivory Coast': 'FRA', 'Burkina Faso': 'FRA',
  'Benin': 'FRA', 'Togo': 'FRA', 'Cameroon': 'FRA', 'Central African Rep.': 'FRA',
  'Congo': 'FRA', 'Gabon': 'FRA', 'Madagascar': 'FRA', 'Djibouti': 'FRA',
  'Libya': 'ITA', 'Eritrea': 'ITA', 'Somalia': 'ITA', 'Ethiopia': 'ETH',
  'Egypt': 'ENG', 'Sudan': 'ENG', 'S. Sudan': 'ENG', 'Nigeria': 'ENG',
  'Ghana': 'ENG', 'Kenya': 'ENG', 'Uganda': 'ENG', 'Tanzania': 'ENG',
  'Zambia': 'ENG', 'Zimbabwe': 'ENG', 'Malawi': 'ENG', 'Botswana': 'ENG',
  'Sierra Leone': 'ENG', 'Gambia': 'ENG', 'Guinea-Bissau': 'POR',
  'Angola': 'POR', 'Mozambique': 'POR',
  'South Africa': 'SAF', 'Namibia': 'SAF', 'Lesotho': 'SAF', 'eSwatini': 'SAF',
  'Dem. Rep. Congo': 'LOW', 'Rwanda': 'LOW', 'Burundi': 'LOW',
  'Liberia': 'LIB', 'Somaliland': 'ITA',
  // —— 中东与中亚 ——
  'Iran': 'IRN', 'Iraq': 'IRQ', 'Syria': 'FRA', 'Lebanon': 'FRA',
  'Israel': 'ENG', 'Palestine': 'ENG', 'Jordan': 'ENG', 'Cyprus': 'ENG',
  'Saudi Arabia': 'SAU', 'Yemen': 'SAU', 'Oman': 'SAU',
  'United Arab Emirates': 'SAU', 'Qatar': 'SAU', 'Kuwait': 'SAU',
  'Afghanistan': 'AFG', 'Pakistan': 'IND', 'India': 'IND', 'Bangladesh': 'IND',
  'Sri Lanka': 'IND', 'Nepal': 'IND', 'Bhutan': 'IND', 'Myanmar': 'IND',
  // —— 亚太 ——
  'China': 'CHI', 'Mongolia': 'MON', 'Taiwan': 'JAP', 'Korea': 'JAP',
  'North Korea': 'JAP', 'South Korea': 'JAP', 'Japan': 'JAP',
  'Vietnam': 'FRA', 'Laos': 'FRA', 'Cambodia': 'FRA', 'Thailand': 'SIA',
  'Malaysia': 'ENG', 'Singapore': 'ENG', 'Brunei': 'ENG',
  'Indonesia': 'LOW', 'Timor-Leste': 'POR', 'Philippines': 'USA',
  'Papua New Guinea': 'AUS',
  // —— 美洲 ——
  'United States of America': 'USA', 'Canada': 'CAN', 'Mexico': 'MEX',
  'Greenland': 'DEN', 'Cuba': 'CUB', 'Haiti': 'HAI', 'Dominican Rep.': 'DOM',
  'Jamaica': 'ENG', 'Puerto Rico': 'USA', 'Guatemala': 'GUA', 'Honduras': 'HON',
  'El Salvador': 'GUA', 'Nicaragua': 'NIC', 'Costa Rica': 'GUA', 'Panama': 'GUA',
  'Colombia': 'COL', 'Venezuela': 'VEN', 'Ecuador': 'ECU', 'Peru': 'PER',
  'Bolivia': 'BOL', 'Brazil': 'BRA', 'Paraguay': 'PAR', 'Uruguay': 'URU',
  'Argentina': 'ARG', 'Chile': 'CHL',
  // —— 大洋洲 ——
  'Australia': 'AUS', 'New Zealand': 'NZL',
};
// 1936 年殖民地（非核心领土：产出打折、易生抵抗）
const COLONIAL = {};
for (const n of ['Algeria', 'Tunisia', 'Morocco', 'Mauritania', 'Mali', 'Niger', 'Chad', 'Senegal',
  'Guinea', 'Ivory Coast', 'Burkina Faso', 'Benin', 'Togo', 'Cameroon', 'Central African Rep.',
  'Congo', 'Gabon', 'Madagascar', 'Djibouti', 'Syria', 'Lebanon', 'Vietnam', 'Laos', 'Cambodia',
  'Libya', 'Eritrea', 'Somalia', 'Somaliland', 'Egypt', 'Sudan', 'S. Sudan', 'Nigeria', 'Ghana',
  'Kenya', 'Uganda', 'Tanzania', 'Zambia', 'Zimbabwe', 'Malawi', 'Botswana', 'Sierra Leone',
  'Gambia', 'Israel', 'Palestine', 'Jordan', 'Cyprus', 'Myanmar', 'Pakistan', 'Bangladesh',
  'Sri Lanka', 'Malaysia', 'Singapore', 'Brunei', 'Indonesia', 'Taiwan', 'Korea', 'North Korea',
  'South Korea', 'Philippines', 'Puerto Rico', 'Jamaica', 'W. Sahara', 'Angola', 'Mozambique',
  'Guinea-Bissau', 'Timor-Leste', 'Dem. Rep. Congo', 'Rwanda', 'Burundi', 'Papua New Guinea',
  'Greenland', 'Namibia']) COLONIAL[n] = 1;

const CODE_NAME = {
  GER: '德国', SOV: '苏联', ENG: '英国', FRA: '法国', ITA: '意大利', USA: '美国', JAP: '日本',
  CHI: '中国', POL: '波兰', CZE: '捷克斯洛伐克', AUS: '奥地利', HUN: '匈牙利', ROM: '罗马尼亚',
  YUG: '南斯拉夫', BUL: '保加利亚', GRE: '希腊', TUR: '土耳其', SPA: '西班牙', POR: '葡萄牙',
  SWI: '瑞士', LOW: '荷兰', DEN: '丹麦', SWE: '瑞典', NOR: '挪威', FIN: '芬兰', BAL: '波罗的海三国',
  IRE: '爱尔兰', ICE: '冰岛', CAN: '加拿大', MEX: '墨西哥', BRA: '巴西', ARG: '阿根廷',
  CHL: '智利', PER: '秘鲁', VEN: '委内瑞拉', COL: '哥伦比亚', ECU: '厄瓜多尔', BOL: '玻利维亚',
  PAR: '巴拉圭', URU: '乌拉圭', CUB: '古巴', HAI: '海地', DOM: '多米尼加', GUA: '危地马拉',
  HON: '洪都拉斯', NIC: '尼加拉瓜', IRN: '伊朗', IRQ: '伊拉克', SAU: '沙特阿拉伯',
  AFG: '阿富汗', IND: '英属印度', ETH: '埃塞俄比亚', SIA: '泰国', AUS: '澳大利亚',
  NZL: '新西兰', SAF: '南非', LIB: '利比里亚', MON: '蒙古', NEU: '未定领地',
};

// 世界视图范围（Web Mercator；南北极与过冷地区裁掉）
const BBOX = { lonMin: -180, lonMax: 180, latMin: -55, latMax: 78 };
const TYPE_GRID = 2.0;   // 逻辑网格尺寸（度），供 sim 的空军航程等距离近似

// ============================================================
// 2. 城市（真实经纬度）= Voronoi 种子 + 省份命名
//    [名称, 经度, 纬度, 胜利点, 国家代码, 是否港口, 是否机场]
// ============================================================
const CITIES = [
  // —— 欧洲 ——
  ['柏林', 13.40, 52.52, 50, 'GER', 0, 1], ['汉堡', 10.00, 53.55, 30, 'GER', 1, 0],
  ['鲁尔', 7.00, 51.45, 35, 'GER', 0, 0], ['慕尼黑', 11.58, 48.14, 25, 'GER', 0, 1],
  ['科隆', 6.96, 50.94, 20, 'GER', 0, 0], ['柯尼斯堡', 20.50, 54.70, 15, 'GER', 1, 0],
  ['德累斯顿', 13.74, 51.05, 12, 'GER', 0, 0], ['法兰克福', 8.68, 50.11, 15, 'GER', 0, 0],
  ['巴黎', 2.35, 48.86, 50, 'FRA', 0, 1], ['马赛', 5.37, 43.30, 15, 'FRA', 1, 0],
  ['里昂', 4.83, 45.76, 12, 'FRA', 0, 0], ['波尔多', -0.58, 44.84, 10, 'FRA', 1, 0],
  ['阿尔及尔', 3.06, 36.75, 10, 'FRA', 1, 0], ['卡萨布兰卡', -7.62, 33.60, 8, 'FRA', 1, 0],
  ['突尼斯', 10.17, 36.80, 6, 'FRA', 1, 0], ['达喀尔', -17.45, 14.69, 6, 'FRA', 1, 0],
  ['西贡', 106.70, 10.78, 10, 'FRA', 1, 0], ['河内', 105.83, 21.03, 8, 'FRA', 0, 0],
  ['伦敦', -0.13, 51.50, 50, 'ENG', 1, 1], ['曼彻斯特', -2.24, 53.48, 20, 'ENG', 0, 0],
  ['格拉斯哥', -4.25, 55.86, 15, 'ENG', 1, 0], ['贝尔法斯特', -5.93, 54.60, 8, 'ENG', 1, 0],
  ['开罗', 31.24, 30.04, 15, 'ENG', 1, 0], ['海法', 34.99, 32.79, 6, 'ENG', 1, 0],
  ['孟买', 72.88, 19.08, 12, 'ENG', 1, 0], ['加尔各答', 88.36, 22.57, 12, 'ENG', 1, 0],
  ['德里', 77.21, 28.61, 15, 'ENG', 0, 0], ['马德拉斯', 80.27, 13.08, 8, 'ENG', 1, 0],
  ['新加坡', 103.82, 1.35, 12, 'ENG', 1, 0], ['内罗毕', 36.82, -1.29, 5, 'ENG', 0, 0],
  ['莫斯科', 37.60, 55.75, 60, 'SOV', 0, 1], ['列宁格勒', 30.30, 59.94, 35, 'SOV', 1, 0],
  ['斯大林格勒', 44.50, 48.70, 25, 'SOV', 0, 0], ['基辅', 30.50, 50.45, 20, 'SOV', 0, 0],
  ['明斯克', 27.55, 53.90, 12, 'SOV', 0, 0], ['巴库', 49.87, 40.40, 20, 'SOV', 0, 0],
  ['塞瓦斯托波尔', 33.50, 44.60, 12, 'SOV', 1, 0], ['哈尔科夫', 36.23, 49.99, 15, 'SOV', 0, 0],
  ['罗斯托夫', 39.72, 47.23, 12, 'SOV', 0, 0], ['高尔基', 44.00, 56.33, 12, 'SOV', 0, 0],
  ['摩尔曼斯克', 33.08, 68.97, 8, 'SOV', 1, 0], ['敖德萨', 30.73, 46.48, 10, 'SOV', 1, 0],
  ['新西伯利亚', 82.93, 55.03, 10, 'SOV', 0, 0], ['塔什干', 69.24, 41.30, 8, 'SOV', 0, 0],
  ['符拉迪沃斯托克', 131.89, 43.12, 10, 'SOV', 1, 0], ['伊尔库茨克', 104.28, 52.28, 6, 'SOV', 0, 0],
  ['罗马', 12.50, 41.90, 40, 'ITA', 0, 1], ['米兰', 9.19, 45.46, 25, 'ITA', 0, 0],
  ['那不勒斯', 14.25, 40.85, 18, 'ITA', 1, 0], ['巴勒莫', 13.36, 38.12, 8, 'ITA', 1, 0],
  ['的黎波里', 13.19, 32.90, 10, 'ITA', 1, 0], ['班加西', 20.07, 32.12, 6, 'ITA', 1, 0],
  ['威尼斯', 12.34, 45.44, 12, 'ITA', 1, 0], ['亚的斯亚贝巴', 38.75, 9.03, 8, 'ITA', 0, 0],
  ['华沙', 21.00, 52.23, 30, 'POL', 0, 1], ['克拉科夫', 19.94, 50.06, 15, 'POL', 0, 0],
  ['利沃夫', 24.03, 49.84, 10, 'POL', 0, 0], ['但泽', 18.65, 54.35, 12, 'POL', 1, 0],
  ['罗兹', 19.46, 51.76, 8, 'POL', 0, 0],
  ['布拉格', 14.42, 50.09, 25, 'CZE', 0, 1], ['布尔诺', 16.61, 49.20, 8, 'CZE', 0, 0],
  ['布拉迪斯拉发', 17.11, 48.15, 8, 'CZE', 0, 0],
  ['维也纳', 16.37, 48.21, 25, 'AUS', 0, 0], ['因斯布鲁克', 11.40, 47.27, 6, 'AUS', 0, 0],
  ['布达佩斯', 19.04, 47.50, 20, 'HUN', 0, 0], ['德布勒森', 21.63, 47.53, 6, 'HUN', 0, 0],
  ['布加勒斯特', 26.10, 44.43, 20, 'ROM', 0, 0], ['普洛耶什蒂', 26.03, 44.94, 15, 'ROM', 0, 0],
  ['克卢日', 23.60, 46.77, 6, 'ROM', 0, 0], ['康斯坦察', 28.65, 44.18, 6, 'ROM', 1, 0],
  ['贝尔格莱德', 20.46, 44.79, 15, 'YUG', 0, 0], ['萨格勒布', 15.98, 45.81, 8, 'YUG', 0, 0],
  ['萨拉热窝', 18.41, 43.86, 6, 'YUG', 0, 0], ['斯科普里', 21.43, 41.99, 5, 'YUG', 0, 0],
  ['索菲亚', 23.32, 42.70, 12, 'BUL', 0, 0], ['瓦尔纳', 27.92, 43.21, 5, 'BUL', 1, 0],
  ['雅典', 23.73, 37.98, 15, 'GRE', 1, 0], ['塞萨洛尼基', 22.94, 40.64, 8, 'GRE', 1, 0],
  ['伊斯坦布尔', 28.98, 41.01, 25, 'TUR', 1, 0], ['安卡拉', 32.85, 39.93, 12, 'TUR', 0, 0],
  ['伊兹密尔', 27.14, 38.42, 8, 'TUR', 1, 0], ['阿达纳', 35.32, 37.00, 5, 'TUR', 0, 0],
  ['马德里', -3.70, 40.42, 30, 'SPA', 0, 0], ['巴塞罗那', 2.17, 41.39, 18, 'SPA', 1, 0],
  ['塞维利亚', -5.98, 37.39, 10, 'SPA', 0, 0], ['毕尔巴鄂', -2.93, 43.26, 8, 'SPA', 1, 0],
  ['里斯本', -9.14, 38.72, 15, 'POR', 1, 0], ['波尔图', -8.61, 41.15, 8, 'POR', 1, 0],
  ['阿姆斯特丹', 4.90, 52.37, 15, 'LOW', 1, 0], ['布鲁塞尔', 4.35, 50.85, 15, 'LOW', 0, 0],
  ['鹿特丹', 4.48, 51.92, 10, 'LOW', 1, 0], ['巴达维亚', 106.85, -6.17, 10, 'LOW', 1, 0],
  ['伯尔尼', 7.45, 46.95, 10, 'SWI', 0, 0], ['苏黎世', 8.54, 47.37, 10, 'SWI', 0, 0],
  ['哥本哈根', 12.57, 55.68, 15, 'DEN', 1, 0], ['奥胡斯', 10.20, 56.16, 6, 'DEN', 1, 0],
  ['奥斯陆', 10.75, 59.91, 15, 'NOR', 1, 0], ['卑尔根', 5.32, 60.39, 8, 'NOR', 1, 0],
  ['特隆赫姆', 10.40, 63.43, 6, 'NOR', 1, 0], ['纳尔维克', 17.43, 68.44, 5, 'NOR', 1, 0],
  ['斯德哥尔摩', 18.07, 59.33, 20, 'SWE', 1, 0], ['哥德堡', 11.97, 57.71, 10, 'SWE', 1, 0],
  ['基律纳', 20.23, 67.86, 6, 'SWE', 0, 0],
  ['赫尔辛基', 24.94, 60.17, 15, 'FIN', 1, 0], ['维堡', 28.73, 60.71, 5, 'FIN', 1, 0],
  ['坦佩雷', 23.76, 61.50, 6, 'FIN', 0, 0],
  ['里加', 24.10, 56.95, 10, 'BAL', 1, 0], ['塔林', 24.75, 59.44, 8, 'BAL', 1, 0],
  ['考纳斯', 23.90, 54.90, 6, 'BAL', 0, 0],
  ['都柏林', -6.26, 53.35, 10, 'IRE', 1, 0], ['雷克雅未克', -21.94, 64.15, 4, 'ICE', 1, 0],
  // —— 北美 ——
  ['华盛顿', -77.04, 38.91, 50, 'USA', 0, 1], ['纽约', -74.01, 40.71, 45, 'USA', 1, 0],
  ['芝加哥', -87.63, 41.88, 30, 'USA', 0, 0], ['底特律', -83.05, 42.33, 25, 'USA', 0, 0],
  ['洛杉矶', -118.24, 34.05, 25, 'USA', 1, 0], ['旧金山', -122.42, 37.77, 20, 'USA', 1, 0],
  ['西雅图', -122.33, 47.61, 15, 'USA', 1, 0], ['休斯顿', -95.37, 29.76, 20, 'USA', 0, 0],
  ['亚特兰大', -84.39, 33.75, 15, 'USA', 0, 0], ['丹佛', -104.99, 39.74, 10, 'USA', 0, 0],
  ['迈阿密', -80.19, 25.76, 12, 'USA', 1, 0], ['马尼拉', 120.98, 14.60, 12, 'USA', 1, 0],
  ['珍珠港', -157.86, 21.31, 15, 'USA', 1, 0],
  ['渥太华', -75.70, 45.42, 25, 'CAN', 0, 0], ['多伦多', -79.38, 43.65, 20, 'CAN', 0, 0],
  ['温哥华', -123.12, 49.28, 15, 'CAN', 1, 0], ['蒙特利尔', -73.57, 45.50, 15, 'CAN', 0, 0],
  ['墨西哥城', -99.13, 19.43, 25, 'MEX', 0, 0], ['韦拉克鲁斯', -96.13, 19.17, 8, 'MEX', 1, 0],
  ['哈瓦那', -82.38, 23.13, 10, 'CUB', 1, 0],
  // —— 南美 ——
  ['里约热内卢', -43.17, -22.91, 30, 'BRA', 1, 0], ['圣保罗', -46.63, -23.55, 25, 'BRA', 0, 0],
  ['巴西利亚', -47.88, -15.79, 10, 'BRA', 0, 0], ['累西腓', -34.88, -8.05, 8, 'BRA', 1, 0],
  ['布宜诺斯艾利斯', -58.38, -34.60, 25, 'ARG', 1, 0], ['圣地亚哥', -70.65, -33.46, 15, 'CHL', 0, 0],
  ['利马', -77.04, -12.05, 12, 'PER', 1, 0], ['波哥大', -74.07, 4.71, 12, 'COL', 0, 0],
  ['加拉加斯', -66.90, 10.48, 10, 'VEN', 1, 0], ['拉巴斯', -68.15, -16.50, 6, 'BOL', 0, 0],
  ['蒙得维的亚', -56.19, -34.90, 6, 'URU', 1, 0], ['亚松森', -57.58, -25.28, 5, 'PAR', 0, 0],
  ['基多', -78.47, -0.18, 5, 'ECU', 0, 0],
  // —— 亚太 ——
  ['东京', 139.69, 35.69, 55, 'JAP', 1, 1], ['大阪', 135.50, 34.69, 30, 'JAP', 1, 0],
  ['名古屋', 136.91, 35.18, 20, 'JAP', 1, 0], ['札幌', 141.35, 43.06, 10, 'JAP', 0, 0],
  ['长崎', 129.87, 32.75, 10, 'JAP', 1, 0], ['广岛', 132.46, 34.39, 12, 'JAP', 1, 0],
  ['京城', 126.98, 37.57, 15, 'JAP', 0, 0], ['新京', 125.32, 43.82, 10, 'JAP', 0, 0],
  ['台北', 121.56, 25.03, 8, 'JAP', 1, 0],
  ['北京', 116.41, 39.90, 40, 'CHI', 0, 1], ['上海', 121.47, 31.23, 40, 'CHI', 1, 0],
  ['南京', 118.80, 32.06, 25, 'CHI', 0, 0], ['武汉', 114.31, 30.60, 18, 'CHI', 0, 0],
  ['重庆', 106.55, 29.56, 18, 'CHI', 0, 0], ['广州', 113.26, 23.13, 15, 'CHI', 1, 0],
  ['西安', 108.94, 34.34, 10, 'CHI', 0, 0], ['哈尔滨', 126.63, 45.75, 8, 'CHI', 0, 0],
  ['乌鲁木齐', 87.62, 43.83, 5, 'CHI', 0, 0], ['昆明', 102.71, 25.04, 6, 'CHI', 0, 0],
  ['曼谷', 100.50, 13.75, 12, 'SIA', 1, 0],
  ['乌兰巴托', 106.92, 47.89, 5, 'MON', 0, 0],
  ['堪培拉', 149.13, -35.28, 15, 'AUS', 0, 0], ['悉尼', 151.21, -33.87, 20, 'AUS', 1, 0],
  ['墨尔本', 144.96, -37.81, 15, 'AUS', 1, 0], ['珀斯', 115.86, -31.95, 8, 'AUS', 1, 0],
  ['达尔文', 130.84, -12.46, 6, 'AUS', 1, 0],
  ['惠灵顿', 174.78, -41.29, 8, 'NZL', 1, 0], ['奥克兰', 174.76, -36.85, 8, 'NZL', 1, 0],
  // —— 中东 / 非洲 ——
  ['德黑兰', 51.39, 35.69, 15, 'IRN', 0, 0], ['阿巴丹', 48.29, 30.34, 10, 'IRN', 1, 0],
  ['巴格达', 44.36, 33.31, 12, 'IRQ', 0, 0], ['巴士拉', 47.78, 30.51, 6, 'IRQ', 1, 0],
  ['利雅得', 46.72, 24.71, 8, 'SAU', 0, 0], ['吉达', 39.20, 21.49, 6, 'SAU', 1, 0],
  ['喀布尔', 69.18, 34.53, 6, 'AFG', 0, 0],
  ['约翰内斯堡', 28.05, -26.20, 15, 'SAF', 0, 0], ['开普敦', 18.42, -33.92, 12, 'SAF', 1, 0],
  ['比勒陀利亚', 28.19, -25.75, 8, 'SAF', 0, 0],
  ['亚的斯亚贝巴2', 38.75, 9.03, 0, 'ETH', 0, 0],
  ['蒙罗维亚', -10.80, 6.31, 4, 'LIB', 1, 0],
];

// ============================================================
// 3. 地形判定（经纬盒；覆盖主要山系/森林/沼泽/沙漠）
// ============================================================
const MOUNTAINS = [
  [-1.0, 2.5, 42.0, 43.6], [5.5, 14.5, 45.0, 47.8], [10.5, 15.5, 40.5, 45.0],
  [22.0, 26.5, 45.0, 49.0], [17.0, 24.5, 39.0, 44.5], [4.5, 15.0, 58.0, 71.5],
  [26.0, 45.0, 36.5, 41.5], [40.0, 48.0, 41.0, 44.0], [-10.0, -2.0, 36.0, 43.5],
  [7.0, 12.0, 46.0, 47.5],
  // 亚洲
  [73.0, 105.0, 27.0, 40.0],   // 喜马拉雅与青藏
  [95.0, 110.0, 20.0, 30.0],   // 云贵高原
  [125.0, 130.0, 40.0, 45.0],  // 长白山脉
  [135.0, 142.0, 34.0, 38.0],  // 日本阿尔卑斯
  [-75.0, -70.0, 5.0, 12.0],   // 安第斯北段
  [-80.0, -65.0, -40.0, -10.0],// 安第斯
  [-120.0, -105.0, 35.0, 50.0],// 落基山
  [-100.0, -80.0, 15.0, 25.0], // 墨西哥高原
];
const FORESTS = [
  [4.0, 32.0, 55.0, 78.0], [20.0, 60.0, 50.0, 62.0], [22.0, 30.0, 48.0, 54.0],
  [-90.0, -60.0, 45.0, 60.0], [-140.0, -60.0, 50.0, 70.0], [95.0, 140.0, 45.0, 65.0],
  [-75.0, -45.0, -30.0, 5.0], [10.0, 35.0, -10.0, 5.0], [95.0, 145.0, -10.0, 5.0],
  [-85.0, -55.0, -15.0, 5.0],
];
const MARSH = [[24.0, 31.0, 51.0, 53.5], [3.0, 7.0, 51.0, 53.5], [28.0, 34.0, 5.0, 12.0]];
const DESERTS = [
  [-17.0, 40.0, 15.0, 32.0],   // 撒哈拉与阿拉伯
  [55.0, 78.0, 20.0, 35.0],    // 伊朗/俾路支
  [-120.0, -105.0, 24.0, 38.0],// 北美沙漠
  [-75.0, -60.0, -30.0, -18.0],// 阿塔卡马
  [115.0, 145.0, -33.0, -18.0],// 澳洲内陆
  [40.0, 60.0, 40.0, 48.0],    // 中亚
];
const TUNDRA = [[-180.0, 180.0, 60.0, 78.0]];

// ============================================================
// 4. 资源点（真实产地）
// ============================================================
const RESOURCE_SITES = [
  ['oil', -95.4, 29.8, 40], ['oil', 48.3, 30.3, 26], ['oil', 26.0, 45.0, 12],
  ['oil', 49.9, 40.4, 20], ['oil', -104.0, 31.0, 14], ['oil', 103.8, 1.35, 4],
  ['oil', 31.2, 30.0, 4], ['oil', 46.7, 24.7, 8], ['oil', -63.0, 10.5, 12],
  ['steel', 7.0, 51.4, 16], ['steel', 2.3, 48.9, 8], ['steel', 37.6, 48.0, 18],
  ['steel', 19.0, 50.3, 8], ['steel', -1.5, 53.0, 14], ['steel', 20.2, 67.9, 10],
  ['steel', -5.9, 37.4, 4], ['steel', -87.6, 41.6, 26], ['steel', -80.0, 40.4, 18],
  ['steel', 114.0, 30.5, 10], ['steel', 126.0, 43.0, 10], ['steel', 135.5, 34.7, 8],
  ['steel', 28.0, -26.2, 10], ['steel', 145.0, -38.0, 6], ['steel', -43.2, -22.9, 6],
  ['steel', 78.0, 22.0, 8], ['steel', 85.0, 23.5, 8],
  ['aluminum', 4.8, 45.8, 4], ['aluminum', 9.2, 45.5, 3], ['aluminum', 11.6, 48.1, 5],
  ['aluminum', -75.0, 45.0, 8], ['aluminum', -60.0, -10.0, 5], ['aluminum', 120.0, -3.0, 4],
  ['aluminum', 30.0, -25.0, 3],
  ['tungsten', -5.0, 40.4, 6], ['tungsten', -8.0, 40.5, 3], ['tungsten', 32.9, 39.9, 4],
  ['tungsten', 114.0, 25.0, 14], ['tungsten', 100.0, 22.0, 6], ['tungsten', 130.0, 42.0, 4],
  ['chromium', 32.9, 39.9, 8], ['chromium', 44.0, 42.0, 4], ['chromium', 28.0, -25.0, 10],
  ['chromium', 60.0, 25.0, 3], ['chromium', 125.0, 60.0, 4],
  ['rubber', 3.1, 36.8, 2], ['rubber', 10.2, 36.8, 3], ['rubber', 101.0, 3.0, 20],
  ['rubber', 103.8, 1.35, 14], ['rubber', 106.8, -6.2, 16], ['rubber', -60.0, -3.0, 10],
  ['rubber', -8.0, 5.0, 6], ['rubber', 38.0, 8.0, 3],
];

// ============================================================
// 5. 海区（真实海域；海军任务区/登陆/封锁的基础）
// ============================================================
const SEA_ZONES = [
  { id: 0, name: '北海', cx: 2.5, cy: 56.0, rx: 7.0, ry: 5.0 },
  { id: 1, name: '波罗的海', cx: 19.0, cy: 58.0, rx: 6.0, ry: 4.5 },
  { id: 2, name: '东北大西洋', cx: -12.0, cy: 47.0, rx: 10.0, ry: 9.0 },
  { id: 3, name: '挪威海与北冰洋', cx: 0.0, cy: 68.0, rx: 30.0, ry: 8.0 },
  { id: 4, name: '西地中海', cx: 5.0, cy: 38.5, rx: 8.0, ry: 5.0 },
  { id: 5, name: '东地中海', cx: 24.0, cy: 34.5, rx: 10.0, ry: 5.0 },
  { id: 6, name: '黑海', cx: 34.0, cy: 43.0, rx: 6.0, ry: 3.0 },
  { id: 7, name: '亚得里亚海', cx: 15.5, cy: 42.5, rx: 3.0, ry: 2.5 },
  { id: 8, name: '红海与亚丁湾', cx: 39.0, cy: 18.0, rx: 6.0, ry: 8.0 },
  { id: 9, name: '波斯湾', cx: 51.0, cy: 27.0, rx: 5.0, ry: 3.0 },
  { id: 10, name: '阿拉伯海', cx: 62.0, cy: 15.0, rx: 12.0, ry: 8.0 },
  { id: 11, name: '孟加拉湾', cx: 88.0, cy: 15.0, rx: 8.0, ry: 6.0 },
  { id: 12, name: '南海', cx: 113.0, cy: 13.0, rx: 10.0, ry: 8.0 },
  { id: 13, name: '东海与黄海', cx: 124.0, cy: 30.0, rx: 8.0, ry: 6.0 },
  { id: 14, name: '日本海', cx: 135.0, cy: 40.0, rx: 7.0, ry: 5.0 },
  { id: 15, name: '西北太平洋', cx: 155.0, cy: 30.0, rx: 20.0, ry: 15.0 },
  { id: 16, name: '中西太平洋', cx: -170.0, cy: 10.0, rx: 25.0, ry: 18.0 },
  { id: 17, name: '西南太平洋', cx: 155.0, cy: -20.0, rx: 20.0, ry: 15.0 },
  { id: 18, name: '印度洋', cx: 75.0, cy: -20.0, rx: 25.0, ry: 18.0 },
  { id: 19, name: '南大西洋', cx: -20.0, cy: -25.0, rx: 20.0, ry: 18.0 },
  { id: 20, name: '加勒比海与墨西哥湾', cx: -75.0, cy: 20.0, rx: 12.0, ry: 8.0 },
  { id: 21, name: '西北大西洋', cx: -50.0, cy: 40.0, rx: 18.0, ry: 12.0 },
  { id: 22, name: '南太平洋', cx: -110.0, cy: -30.0, rx: 25.0, ry: 18.0 },
  { id: 23, name: '东南大西洋', cx: 10.0, cy: -35.0, rx: 15.0, ry: 12.0 },
  { id: 24, name: '西非与几内亚湾', cx: 0.0, cy: 0.0, rx: 12.0, ry: 8.0 },
  { id: 25, name: '澳大利亚周边', cx: 135.0, cy: -35.0, rx: 18.0, ry: 12.0 },
];

// ============================================================
// 6. TopoJSON 解码与几何工具
// ============================================================
function decodeTopo(topo) {
  const tr = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map((d) => {
      x += d[0]; y += d[1];
      return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
    });
  });
}
function ringFromArcs(arcs, idxs) {
  const pts = [];
  for (const i of idxs) {
    const arc = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
    for (const p of arc) {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) pts.push(p);
    }
  }
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
  }
  return pts;
}
function geomPolys(arcs, g) {
  if (g.type === 'Polygon') return [g.arcs.map((r) => ringFromArcs(arcs, r))];
  if (g.type === 'MultiPolygon') return g.arcs.map((poly) => poly.map((r) => ringFromArcs(arcs, r)));
  return [];
}
function bboxOf(poly) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}
function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p[0]; sy += p[1]; }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}
function clipHalf(poly, nx, ny, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const A = poly[i], B = poly[(i + 1) % n];
    const da = nx * A[0] + ny * A[1] - c, db = nx * B[0] + ny * B[1] - c;
    if (da <= 1e-12) out.push(A);
    if ((da < -1e-12 && db > 1e-12) || (da > 1e-12 && db < -1e-12)) {
      const t = da / (da - db);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  return out;
}
function clipBox(poly, b) {
  let p = clipHalf(poly, -1, 0, -b.lonMin);
  p = clipHalf(p, 1, 0, b.lonMax);
  p = clipHalf(p, 0, -1, -b.latMin);
  p = clipHalf(p, 0, 1, b.latMax);
  return p;
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function bboxOverlap(a, b, pad) {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}
// 反经线拆分：Natural Earth 有整环跨 ±180 相接（如俄罗斯楚科奇），
// 直接把这种环当平面环用，会让 pointInPoly 把"绕远路"的整条北极纬带算作环内、
// 让 Voronoi 裁剪产出横跨半个地球的长条省（红色横带）、并让本应在此的格子落空。
// 做法：先把经度解绕成连续值，再按 ±360 平移后裁回 [-180,180]，得到 1~2 个正常环。
function splitAntimeridian(ring) {
  if (ring.length < 4) return [ring];
  const un = [ring[0].slice()];
  let off = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) off -= 360;
    else if (d < -180) off += 360;
    un.push([ring[i][0] + off, ring[i][1]]);
  }
  const parts = [];
  for (const shift of [-360, 0, 360]) {
    const moved = un.map((p) => [p[0] + shift, p[1]]);
    const bb = bboxOf(moved);
    if (bb[2] < -180 || bb[0] > 180) continue;
    const west = clipHalf(moved, -1, 0, 180);   // 保留 lon >= -180
    const safe = clipHalf(west, 1, 0, 180);     // 保留 lon <=  180
    if (safe.length >= 3 && area(safe) > 1e-6) parts.push(safe);
  }
  return parts.length ? parts : [ring];
}

// ============================================================
// 7. 主流程
// ============================================================
const topo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const arcs = decodeTopo(topo);

const countryPolys = {};
const geomArcs = {};
for (const g of topo.objects.countries.geometries) {
  const name = g.properties && g.properties.name;
  const code = NAME_TO_CODE[name] || 'NEU';
  const usedArcs = (geomArcs[name] = geomArcs[name] || new Set());
  const walk = (arr) => {
    if (typeof arr === 'number') { usedArcs.add(Math.abs(arr)); return; }
    for (const x of arr) walk(x);
  };
  walk(g.arcs);
  const polys = geomPolys(arcs, g);
  let blockIdx = 0;
  for (const poly of polys) {
    const outer = poly[0];
    const bi = blockIdx++;
    if (!outer || outer.length < 4) continue;
    const bb = bboxOf(outer);
    if (!bboxOverlap(bb, [BBOX.lonMin, BBOX.latMin, BBOX.lonMax, BBOX.latMax], 0)) continue;
    // 先按反经线拆环，再夹到 BBOX：跨 ±180 的环必须拆成两块，否则后续平面运算全部失效
    const pieces = splitAntimeridian(outer);
    for (let k = 0; k < pieces.length; k++) {
      const clipped = clipBox(pieces[k], BBOX);
      if (clipped.length < 3 || area(clipped) < 0.12) continue;
      (countryPolys[code] = countryPolys[code] || []).push({
        ring: clipped, name, colonial: !!COLONIAL[name], blockIdx: bi,
        blockKey: name + '#' + bi + (pieces.length > 1 ? '.' + k : ''),
      });
    }
  }
}
function geomsShareBorder(a, b) {
  if (a === b) return true;
  const A = geomArcs[a], B = geomArcs[b];
  if (!A || !B) return false;
  const [small, big] = A.size < B.size ? [A, B] : [B, A];
  for (const k of small) if (big.has(k)) return true;
  return false;
}

const provinces = [];
let pid = 0;

function terrainAt(lon, lat) {
  for (const [x0, x1, y0, y1] of MOUNTAINS) if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return 'mountain';
  for (const [x0, x1, y0, y1] of DESERTS) if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return 'desert';
  for (const [x0, x1, y0, y1] of MARSH) if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return 'marsh';
  for (const [x0, x1, y0, y1] of FORESTS) if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return 'forest';
  for (const [x0, x1, y0, y1] of TUNDRA) if (lat >= y0 && lat <= y1) return 'tundra';
  const h = Math.abs(Math.sin((lon * 12.9898 + lat * 78.233) * 43758.5453) % 1);
  if (h < 0.16) return 'hills';
  if (h < 0.28) return 'forest';
  return 'plain';
}

// 各国目标省份数：面积开方缩放 + 国家重要性下限（保证小国也有可玩的省份数）
const MIN_PROV = {
  USA: 70, SOV: 70, CHI: 60, CAN: 55, BRA: 45, IND: 45, AUS: 40, ENG: 40, FRA: 40,
  GER: 34, ITA: 34, JAP: 26, TUR: 24, SPA: 24, POL: 16, SWE: 16, NOR: 14, FIN: 14,
  ROM: 12, YUG: 12, IRN: 14, SAU: 12, MEX: 14, ARG: 16, SAF: 12, ETH: 10, SIA: 8,
  CZE: 10, HUN: 8, AUS_AT: 10, AUS2: 10, BAL: 9, DEN: 8, POR: 8, BUL: 8, GRE: 10,
  SWI: 6, IRE: 4, LOW: 12, IRQ: 8, AFG: 8, EGY: 0,
};
function targetFor(code, totalArea) {
  const base = Math.round(Math.sqrt(totalArea) * 1.15) + 6;
  const floor = MIN_PROV[code] || 6;
  return Math.max(floor, Math.min(72, base));
}

for (const code of Object.keys(countryPolys)) {
  const land = countryPolys[code];
  const landmark = 0.3;
  let mainBlocks = land.filter((b) => area(b.ring) > landmark);
  if (!mainBlocks.length) mainBlocks = land.slice();          // 小国全体块参与剖分
  const mainSet = new Set(mainBlocks);
  const smallBlocks = land.filter((b) => area(b.ring) <= landmark && !mainSet.has(b));
  const totalArea = land.reduce((s, b) => s + area(b.ring), 0);
  const target = targetFor(code, totalArea);

  const seeds = [];
  const cityOfSeed = [];
  for (const c of CITIES) {
    if (c[4] !== code) continue;
    if (seeds.some((s) => s[0] === c[1] && s[1] === c[2])) continue;
    for (const b of mainBlocks) {
      if (pointInPoly([c[1], c[2]], b.ring)) { seeds.push([c[1], c[2]]); cityOfSeed.push(c); break; }
    }
  }
  // 候选点：按每块独立采样。旧版用全球 bbox 步长 → 大国候选稀少时
  // 索引公式反复命中同一点 → 相同种子 → 产出整块克隆省（415 个重叠省的根因）。
  const cand = [];
  const candSeen = new Set();
  const mainArea = mainBlocks.reduce((s, b) => s + area(b.ring), 0) || 1;
  for (const b of mainBlocks) {
    const bb = bboxOf(b.ring);
    const bA = area(b.ring);
    const bTarget = Math.max(1, target * (bA / mainArea));
    const bStep = Math.max(0.4, Math.sqrt(Math.max(0.01, bA / bTarget)) * 0.62);
    for (let lon = bb[0]; lon <= bb[2]; lon += bStep) {
      for (let lat = bb[1]; lat <= bb[3]; lat += bStep) {
        if (!pointInPoly([lon, lat], b.ring)) continue;
        const k = lon.toFixed(3) + ',' + lat.toFixed(3);
        if (candSeen.has(k)) continue;
        candSeen.add(k);
        cand.push([lon, lat]);
      }
    }
  }
  const need = Math.max(0, target - seeds.length);
  const taken = new Set();
  for (let i = 0; i < need && cand.length; i++) {
    let idx = Math.floor((cand.length * (i + 0.5)) / need) % cand.length;
    let g = 0;
    while (taken.has(idx) && g++ < cand.length) idx = (idx + 1) % cand.length;
    if (taken.has(idx)) break;   // 候选用尽：宁缺毋滥，不再产生重复种子
    taken.add(idx);
    const pick = cand[idx];
    if (seeds.some((s) => Math.abs(s[0] - pick[0]) < 0.08 && Math.abs(s[1] - pick[1]) < 0.08)) continue;
    seeds.push(pick); cityOfSeed.push(null);
  }
  if (!seeds.length) continue;

  const cells = [];
  const seenCells = new Set();
  for (let i = 0; i < seeds.length; i++) {
    const si = seeds[i];
    let bestBlock = null;
    for (const b of mainBlocks) if (pointInPoly(si, b.ring)) { bestBlock = b; break; }
    if (!bestBlock) continue;   // 种子不属于任何主块 → 丢弃（否则会克隆 mainBlocks[0]）
    let cell = bestBlock.ring;
    for (let j = 0; j < seeds.length && cell.length >= 3; j++) {
      if (i === j) continue;
      const sj = seeds[j];
      // 只与同一地块内的种子做 Voronoi（不同岛屿互不裁剪）
      if (bestBlock.ring !== (pointInPoly(sj, bestBlock.ring) ? bestBlock.ring : null)) continue;
      const nx = 2 * (sj[0] - si[0]), ny = 2 * (sj[1] - si[1]);
      const c = (sj[0] * sj[0] + sj[1] * sj[1]) - (si[0] * si[0] + si[1] * si[1]);
      cell = clipHalf(cell, nx, ny, c);
    }
    if (cell.length >= 3 && area(cell) > 0.02) {
      const [gx, gy] = centroid(cell);
      const ck = bestBlock.blockKey + '|' + cell.length + '|' + area(cell).toFixed(6) + '|' + gx.toFixed(3) + ',' + gy.toFixed(3);
      if (seenCells.has(ck)) continue;   // 同形状细胞只计一次（兜底防克隆省）
      seenCells.add(ck);
      cells.push({ ring: cell, city: cityOfSeed[i], geomName: bestBlock.name, blockKey: bestBlock.blockKey, colonial: bestBlock.colonial });
    }
  }
  for (const b of smallBlocks) {
    if (area(b.ring) < 0.03) continue;
    cells.push({ ring: b.ring, city: null, island: true, geomName: b.name, blockKey: b.blockKey, colonial: b.colonial });
  }

  for (const cell of cells) {
    const [cx, cy] = centroid(cell.ring);
    const terr = terrainAt(cx, cy);
    const name = cell.city ? cell.city[0] : (CODE_NAME[code] || code) + (cell.island ? '岛' : '') +
      '第' + (provinces.filter((p) => p.owner === code).length + 1) + '区';
    provinces.push({
      id: pid++, owner: code, name, terrain: terr,
      cx: Math.round(cx * 1000) / 1000, cy: Math.round(cy * 1000) / 1000,
      poly: cell.ring.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]),
      vp: cell.city ? cell.city[3] : 0,
      isPort: cell.city ? !!cell.city[5] : false,
      hasAirbase: cell.city ? !!cell.city[6] : false,
      colonial: !!cell.colonial,
      pop: 0,
      resource: { oil: 0, rubber: 0, steel: 0, aluminum: 0, tungsten: 0, chromium: 0 },
      isIsland: !!cell.island,
      geomName: cell.geomName, blockKey: cell.blockKey,
    });
  }
}

// 资源点吸附
for (const [res, lon, lat, v] of RESOURCE_SITES) {
  let best = null, bestD = 1e9;
  for (const p of provinces) {
    const d = Math.hypot(p.cx - lon, p.cy - lat);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) best.resource[res] += v;
}

// 邻接
const EPS = 0.06;
for (const p of provinces) p._bb = bboxOf(p.poly);
let pairs = 0;
function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
for (let i = 0; i < provinces.length; i++) {
  const A = provinces[i];
  for (let j = i + 1; j < provinces.length; j++) {
    const B = provinces[j];
    if (!bboxOverlap(A._bb, B._bb, EPS)) continue;
    let adjacent = false;
    for (const v of A.poly) {
      if (v[0] < B._bb[0] - EPS || v[0] > B._bb[2] + EPS || v[1] < B._bb[1] - EPS || v[1] > B._bb[3] + EPS) continue;
      for (let k = 0; k < B.poly.length; k++) {
        if (distPointSeg(v, B.poly[k], B.poly[(k + 1) % B.poly.length]) < EPS) { adjacent = true; break; }
      }
      if (adjacent) break;
    }
    if (!adjacent) {
      for (const v of B.poly) {
        if (v[0] < A._bb[0] - EPS || v[0] > A._bb[2] + EPS || v[1] < A._bb[1] - EPS || v[1] > A._bb[3] + EPS) continue;
        for (let k = 0; k < A.poly.length; k++) {
          if (distPointSeg(v, A.poly[k], A.poly[(k + 1) % A.poly.length]) < EPS) { adjacent = true; break; }
        }
        if (adjacent) break;
      }
    }
    if (adjacent) {
      (A.neighbors = A.neighbors || []).push(B.id);
      (B.neighbors = B.neighbors || []).push(A.id);
      pairs++;
    }
  }
}

// 海区归属
function distToZoneBox(p, z) {
  const dx = Math.max(0, Math.abs(p.cx - z.cx) - z.rx);
  const dy = Math.max(0, Math.abs(p.cy - z.cy) - z.ry);
  return Math.hypot(dx, dy);
}
for (const p of provinces) {
  const list = SEA_ZONES.map((z) => ({ z, d: distToZoneBox(p, z) })).sort((a, b) => a.d - b.d);
  p.seaZones = list.filter((x) => x.d < 1.5).map((x) => x.z.id);
  p.coastal = p.seaZones.length > 0;
  if (p.coastal && !p.isPort && p.vp > 0) p.isPort = true;
}
for (const p of provinces) if (p.isIsland) { p.coastal = true; if (!p.seaZones.length) p.seaZones = [2]; }

// 跨海通道：同块同几何体或两国共享弧段 → 陆地边界，否则 → 跨海
const straits = [];
const landEdges = [];
for (const A of provinces) {
  const keep = [];
  for (const nid of (A.neighbors || [])) {
    const B = provinces[nid];
    if (!B || B.id < A.id) { keep.push(nid); continue; }
    const sameBlock = A.blockKey && A.blockKey === B.blockKey;
    const landBorder = sameBlock || geomsShareBorder(A.geomName, B.geomName);
    if (landBorder) keep.push(nid);
    else straits.push([A.id, B.id]);
  }
  A.neighbors = keep;
}
// 孤立省（岛屿/飞地）→ 连最近沿海省作为跨海通道
for (const A of provinces) {
  if ((A.neighbors || []).length) continue;
  let best = null, bestD = 1e9;
  for (const B of provinces) {
    if (B.id === A.id || !B.coastal) continue;
    const d = Math.hypot(A.cx - B.cx, A.cy - B.cy);
    if (d < bestD) { bestD = d; best = B; }
  }
  if (best && bestD < 12.0) {
    straits.push([A.id, best.id]);
    A.neighbors = [best.id];
    best.neighbors = (best.neighbors || []).concat([A.id]);
  }
}

// 逻辑网格坐标
const GW = Math.ceil((BBOX.lonMax - BBOX.lonMin) / TYPE_GRID);
const GH = Math.ceil((BBOX.latMax - BBOX.latMin) / TYPE_GRID);
for (const p of provinces) {
  p.x = Math.max(0, Math.min(GW - 1, Math.floor((p.cx - BBOX.lonMin) / TYPE_GRID)));
  p.y = Math.max(0, Math.min(GH - 1, Math.floor((BBOX.latMax - p.cy) / TYPE_GRID)));
  delete p._bb;
}

// 人口（1936 年口径，单位百万；殖民地按低密度折算）
const POP = {
  GER: 69, SOV: 169, ENG: 47, FRA: 41, ITA: 43, USA: 128, JAP: 71, CHI: 450, POL: 34,
  SPA: 25, ROM: 19, YUG: 15, HUN: 9, CZE: 15, AUS: 7, TUR: 17, POR: 7, SWI: 4, LOW: 8.7,
  DEN: 3.7, SWE: 6.2, NOR: 2.9, FIN: 3.7, BAL: 5.5, BUL: 6.3, GRE: 7, IRE: 3, ICE: 0.12,
  CAN: 11, MEX: 18, BRA: 41, ARG: 13, CHL: 5, PER: 6.5, VEN: 3.4, COL: 8, ECU: 2.5,
  BOL: 3, PAR: 1, URU: 2, CUB: 4.2, HAI: 2.6, DOM: 1.5, GUA: 5, HON: 1, NIC: 0.8,
  IRN: 15, IRQ: 3.7, SAU: 3, AFG: 6, IND: 390, ETH: 17, SIA: 15, AUS: 6.8, NZL: 1.6,
  SAF: 9.6, LIB: 1, MON: 0.8, NEU: 8,
};
// 殖民地人口按真实规模粗略折算（百万）
const COLONY_POP = { IND: 390, ENG: 60, FRA: 45, ITA: 12, LOW: 60, POR: 12, USA: 16, SPA: 1, JAP: 30, DEN: 0.02 };
for (const code in POP) {
  const list = provinces.filter((p) => p.owner === code && !p.colonial);
  const per = POP[code] / Math.max(1, list.length);
  for (const p of list) {
    const f = p.terrain === 'desert' ? 0.15 : p.terrain === 'tundra' ? 0.2 : p.terrain === 'mountain' ? 0.5 : p.terrain === 'forest' ? 0.75 : 1.0;
    p.pop = Math.round(per * f * 100) / 100;
  }
}
for (const p of provinces) {
  if (!p.colonial) continue;
  const total = COLONY_POP[p.owner] || 5;
  const list = provinces.filter((q) => q.owner === p.owner && q.colonial);
  p.pop = Math.round(total / Math.max(1, list.length) * 100) / 100;
}

// 记录"国界边"：相邻两省多边形共享的那段边界（顶点索引对），供渲染层精确描粗国界
for (const A of provinces) {
  A.borderEdges = [];
  for (const nid of (A.neighbors || [])) {
    const B = provinces[nid];
    if (!B || B.owner === A.owner) continue;
    for (let i = 0; i < A.poly.length; i++) {
      const a = A.poly[i], b = A.poly[(i + 1) % A.poly.length];
      for (let j = 0; j < B.poly.length; j++) {
        const c = B.poly[j], d = B.poly[(j + 1) % B.poly.length];
        const near = (p, q) => Math.abs(p[0] - q[0]) < 0.08 && Math.abs(p[1] - q[1]) < 0.08;
        if ((near(a, c) && near(b, d)) || (near(a, d) && near(b, c))) {
          A.borderEdges.push([i, (i + 1) % A.poly.length]);
          break;
        }
      }
    }
  }
}

// 统计
const byCode = {};
for (const p of provinces) byCode[p.owner] = (byCode[p.owner] || 0) + 1;
console.log('省份总数: ' + provinces.length + '，陆地邻接: ' + pairs + '，跨海通道: ' + straits.length);
console.log('国家数: ' + Object.keys(byCode).length + '  各国省份数: ' +
  Object.keys(byCode).sort().map((c) => c + ':' + byCode[c]).join(' '));
const isolated = provinces.filter((p) => !(p.neighbors || []).length);
console.log('孤立省: ' + isolated.length + (isolated.length ? ' → ' + isolated.map((p) => p.name).slice(0, 6).join(',') : ''));
console.log('沿海: ' + provinces.filter((p) => p.coastal).length + '，港口: ' + provinces.filter((p) => p.isPort).length +
  '，城市: ' + provinces.filter((p) => p.vp > 0).length);

const out = {
  bbox: BBOX, gridW: GW, gridH: GH,
  seaZones: SEA_ZONES, straits,
  provinces: provinces.map((p) => ({
    id: p.id, owner: p.owner, name: p.name, terrain: p.terrain,
    cx: p.cx, cy: p.cy, x: p.x, y: p.y, poly: p.poly,
    vp: p.vp, isPort: p.isPort, hasAirbase: p.hasAirbase,
    colonial: p.colonial, coastal: p.coastal, seaZones: p.seaZones,
    pop: p.pop, resource: p.resource, neighbors: p.neighbors || [],
    borderEdges: p.borderEdges || [],
  })),
};
const js = '/* 自动生成，请勿手改：node tools/build-map.js\n' +
  ' * 数据来源：Natural Earth 110m（world-atlas countries-110m.json）+ Voronoi 省份剖分\n' +
  ' */\n(function (root) {\n  var PSE = (root.PSE = root.PSE || {});\n  PSE.MAP_GEO = ' +
  JSON.stringify(out) + ';\n})(typeof window !== \'undefined\' ? window : globalThis);\n';
fs.writeFileSync(OUT, js);
console.log('已写出 ' + OUT + '（' + (js.length / 1024).toFixed(1) + ' KB）');
