"use strict";
/* PSE · AI 系统 (ai.js)
 * 行为树式 utility AI：国策选择 / 生产线再平衡 / 建造 / 征兵 / 战线填补 / 宣战 / 空军前移。
 * 只对国家（非玩家）生效；全部决策转为普通命令，不作弊（不读隐藏信息）。
 */
(function (root) {
    'use strict';
    const PSE = (root.PSE = root.PSE || {});
    const U = PSE.U, BAL = PSE.BAL;
    const AI = (PSE.AI = {});
    // ============================================================
    // 国策选择
    // ============================================================
    const EFFECT_WEIGHT = {
        factory: 3.0, slot: 3.0, tech: 2.0, mod: 2.0, equip: 1.5, troops: 1.5,
        manpower: 1.0, pp: 1.0, stab: 1.2, ws: 1.0, res: 1.2, template: 1.5,
        fort: 0.8, claim: 1.5, wargoal: 2.5, annex: 3.0, annex_state: 2.5,
        relation: 1.0, guarantee: 0.8, pact: 0.8, faction: 1.5, faction_with: 1.5,
        faction_join: 1.5, declare_war: 2.0, tension: -0.5, event: 0.5, delay_war: 0.2,
        target_stab: 0.3, mod_all_allies: 0.5,
    };
    AI.pickFocus = function (w, c) {
        const tree = PSE.FOCUS_TREES[c.focusTree] || PSE.FOCUS_TREES.generic;
        if (!tree)
            return null;
        const atWar = PSE.World.inAnyWar(w, c.tag);
        const aggr = (c.ai && c.ai.aggression) || 0.3;
        let best = null, bestScore = -1e9;
        for (const node of tree.nodes) {
            if (!PSE.Sim.focusAvailable(w, c, node))
                continue;
            let score = 0;
            for (const e of node.effects) {
                let w0 = EFFECT_WEIGHT[e.op];
                if (w0 === undefined)
                    w0 = 0.5;
                // 战时偏好军事，和平时偏好经济
                if (!atWar) {
                    if (e.op === 'factory' && (e.kind === 'mil' || e.kind === 'dock'))
                        w0 *= 0.6;
                    if (e.op === 'wargoal' || e.op === 'declare_war')
                        w0 *= (0.3 + aggr);
                }
                else {
                    if (e.op === 'factory' && (e.kind === 'mil'))
                        w0 *= 1.5;
                    if (e.op === 'tech' || e.op === 'equip' || e.op === 'troops')
                        w0 *= 1.4;
                }
                score += w0 * (1 + (e.v || e.n || 0) * 0.02);
            }
            // 归一：越短越好（每周收益）
            score = score * 30 / Math.max(7, node.days);
            // 轻微随机（确定性：用 tag + node id 派生）
            const rng = PSE.RNG.seeded(w.rngSeed + c.tag.length, node.id);
            score *= 0.9 + rng.next01() * 0.2;
            if (score > bestScore) {
                bestScore = score;
                best = node.id;
            }
        }
        return best;
    };
    // ============================================================
    // 建造队列
    // ============================================================
    function manageConstruction(w, c) {
        const atWar = PSE.World.inAnyWar(w, c.tag);
        const target = Math.max(1, Math.floor(c.factories.civ / 6) + (atWar ? 2 : 1));
        if (c.construction.length >= target)
            return;
        const cap = c.capital;
        const want = atWar && c.factories.mil < c.factories.civ * 0.8 ? 'mil' : 'civ';
        const def = PSE.BUILDINGS[want];
        c.construction.push({ kind: want, prov: cap, prog: 0, cost: def.cost });
    }
    // ============================================================
    // 生产线再平衡（每 30 天 + 紧急情况）
    // ============================================================
    function manageProduction(w, c) {
        const atWar = PSE.World.inAnyWar(w, c.tag);
        const st = c.stockpile;
        const infStock = st.infantry_equipment_1 || 0;
        const lines = c.production.filter((l) => !l.dock);
        if (!lines.length)
            return;
        // 紧急：步兵装备告罄 → 从其他线抽调
        if (infStock < 3000) {
            const donor = lines.filter((l) => l.equipId !== 'infantry_equipment_1' && l.factories > 1)
                .sort((a, b) => a.factories - b.factories)[0];
            if (donor) {
                donor.factories -= 1;
            }
            let line = c.production.find((l) => l.equipId === 'infantry_equipment_1' && !l.dock);
            if (!line) {
                line = { id: w.nextId.prod++, equipId: 'infantry_equipment_1', factories: 0, eff: BAL.EQUIP_EFFICIENCY_BASE, active: true };
                c.production.push(line);
            }
            line.factories += 1;
            return;
        }
        // 战时：确保有坦克/飞机产线
        if (atWar && (c.factories.mil >= 8)) {
            const hasTank = c.production.some((l) => l.equipId === 'light_tank_1' || l.equipId === 'medium_tank_1');
            const hasFighter = c.production.some((l) => l.equipId === 'fighter_1');
            const infLine = c.production.find((l) => l.equipId === 'infantry_equipment_1' && !l.dock);
            if (!hasTank && infLine && infLine.factories > 3) {
                infLine.factories -= 1;
                c.production.push({ id: w.nextId.prod++, equipId: 'light_tank_1', factories: 1, eff: BAL.EQUIP_EFFICIENCY_BASE, active: true });
            }
            else if (!hasFighter && infLine && infLine.factories > 3) {
                infLine.factories -= 1;
                c.production.push({ id: w.nextId.prod++, equipId: 'fighter_1', factories: 1, eff: BAL.EQUIP_EFFICIENCY_BASE, active: true });
            }
        }
        // 库存过剩 → 减 1 工厂（避免爆仓浪费）
        for (const line of c.production) {
            if (line.dock || line.factories <= 1)
                continue;
            const eq = PSE.EQUIPMENT[line.equipId];
            if (!eq)
                continue;
            const stock = c.stockpile[line.equipId] || 0;
            if (stock > 40000)
                line.factories -= 1;
        }
    }
    // ============================================================
    // 征兵
    // ============================================================
    function manageArmy(w, c) {
        const atWar = PSE.World.inAnyWar(w, c.tag);
        const tension = w.tension;
        const divCount = c.divisions.length;
        // 目标规模：工业基础 × 战争状态（和平期也随紧张度扩军）
        const wanted = atWar
            ? 22 + c.factories.mil * 3.5 + c.factories.civ * 0.8
            : 12 + c.factories.civ * 0.7 + c.factories.mil * 2.0 * (0.5 + tension / 100) + tension * 0.6;
        if (divCount >= wanted)
            return;
        if (c.manpower < 12)
            return;
        const stock = c.stockpile.infantry_equipment_1 || 0;
        if (stock < 900)
            return;
        // 选模板：装甲富余时造装甲师，否则步兵师
        let tplId = 'inf_9_1';
        if (c.templates.indexOf('inf_9_1') < 0)
            tplId = c.templates[0];
        if (atWar && c.templates.indexOf('armor') >= 0 && (c.stockpile.light_tank_1 || 0) > 400)
            tplId = 'armor';
        const cap = w.provinces[c.capital];
        if (!cap)
            return;
        // 批量征兵：和平每次 2 个 / 战时 3 个（装备见底时 createDivision 自动降为部分满员师）
        const batch = atWar ? 3 : 2;
        for (let i = 0; i < batch; i++) {
            if (c.divisions.length >= wanted)
                break;
            if ((c.stockpile.infantry_equipment_1 || 0) < 300)
                break;
            const d = PSE.World.createDivision(w, c.tag, tplId, cap.id, {});
            if (!d)
                break;
            if (c.ai)
                c.ai.lastRecruit = w.hour;
        }
    }
    // ============================================================
    // 战线管理（填线与进攻）
    // ============================================================
    function frontProvinces(w, c) {
        // 己方（含盟友）控制、且邻接敌控或敌国领土的省份
        const out = [];
        const enemies = new Set(PSE.World.enemiesOf(w, c.tag));
        for (const m of PSE.World.alliesOf(w, c.tag))
            for (const e of PSE.World.enemiesOf(w, m))
                enemies.add(e);
        if (!enemies.size) {
            // 未开战：把邻接"潜在敌国"（关系 < -20）的边省当防线
            for (const p of w.provinces) {
                if (p.controller !== c.tag)
                    continue;
                for (const nb of p.neighbors) {
                    const q = w.provinces[nb];
                    if (!q)
                        continue;
                    if (q.owner !== c.tag && (c.relations[q.owner] || 0) < -20) {
                        out.push(p);
                        break;
                    }
                }
            }
            return { fronts: out, enemies: [] };
        }
        for (const p of w.provinces) {
            if (p.controller !== c.tag && !PSE.World.isAllied(w, c.tag, p.controller))
                continue;
            let isFront = false;
            for (const nb of p.neighbors) {
                const q = w.provinces[nb];
                if (!q)
                    continue;
                if (enemies.has(q.controller) || enemies.has(q.owner)) {
                    isFront = true;
                    break;
                }
            }
            if (isFront)
                out.push(p);
        }
        return { fronts: out, enemies: Array.from(enemies) };
    }
    function bfsDistanceFrom(w, tag, sources, limit) {
        const dist = {};
        const queue = [];
        for (const s of sources) {
            dist[s] = 0;
            queue.push(s);
        }
        let qi = 0;
        while (qi < queue.length) {
            const id = queue[qi++];
            const d = dist[id];
            if (d >= limit)
                continue;
            const p = w.provinces[id];
            for (const nb of p.neighbors) {
                const q = w.provinces[nb];
                if (!q)
                    continue;
                if (dist[nb] !== undefined)
                    continue;
                if (!PSE.Sim.passable(w, q, tag))
                    continue;
                dist[nb] = d + 1;
                queue.push(nb);
            }
        }
        return dist;
    }
    function manageFront(w, c) {
        const info = frontProvinces(w, c);
        if (!info.fronts.length)
            return;
        const atWar = info.enemies.length > 0;
        const myDivs = c.divisions.map((id) => w.divisions.find((d) => d.id === id)).filter(Boolean);
        if (!myDivs.length)
            return;
        // 各区驻军统计
        const byLoc = {};
        for (const d of myDivs)
            (byLoc[d.loc] = byLoc[d.loc] || []).push(d);
        const frontIds = new Set(info.fronts.map((p) => p.id));
        const dist = bfsDistanceFrom(w, c.tag, info.fronts.map((p) => p.id), 12);
        const perFront = Math.max(1, Math.ceil(myDivs.length / Math.max(1, info.fronts.length)));
        // 1) 进攻判定（在战线省，兵力优势则打邻接敌省）
        if (atWar) {
            for (const fp of info.fronts) {
                const here = byLoc[fp.id] || [];
                if (!here.length)
                    continue;
                const ready = here.filter((d) => d.battleId == null && d.org > d.orgMax * d.str * 0.65 && d.supply >= BAL.SUPPLY_PENALTY);
                if (ready.length < 1)
                    continue;
                // 找最弱敌省
                let bestTarget = null, bestRatio = 0;
                for (const nb of fp.neighbors) {
                    const q = w.provinces[nb];
                    if (!q)
                        continue;
                    const hostile = info.enemies.indexOf(q.controller) >= 0 || info.enemies.indexOf(q.owner) >= 0;
                    if (!hostile)
                        continue;
                    if (!PSE.Sim.passable(w, q, c.tag))
                        continue;
                    const defs = w.divisions.filter((d) => d.loc === nb && info.enemies.indexOf(d.tag) >= 0).length;
                    const ratio = ready.length / (defs + 0.5);
                    // 地形恶劣需要更多优势
                    const terr = PSE.Sim.TERRAIN[q.terrain] || PSE.Sim.TERRAIN.plain;
                    const needRatio = 1.0 / Math.max(0.35, terr.atk);
                    if (defs === 0 && ready.length >= 1) {
                        bestTarget = nb;
                        bestRatio = 99;
                        break;
                    }
                    if (ratio >= needRatio * 1.1 && ratio > bestRatio) {
                        bestTarget = nb;
                        bestRatio = ratio;
                    }
                }
                if (bestTarget != null) {
                    PSE.Sim.orderMove(w, ready, bestTarget);
                }
            }
        }
        // 2) 填线：空闲师向最近战线移动（多源 BFS 梯度）
        for (const d of myDivs) {
            if (d.battleId != null || d.status === 'moving')
                continue;
            if (frontIds.has(d.loc)) {
                // 已在战线：若该省兵力过剩 → 不动（留作预备）
                const here = byLoc[d.loc] || [];
                if (here.length > perFront + 2 && !atWar)
                    continue;
                continue;
            }
            const cur = dist[d.loc];
            if (cur === undefined) {
                // 孤立/被围：向首都方向或任意友方省移动
                continue;
            }
            // 选 dist 更小的邻省，且避免过度堆叠
            let best = null, bestScore = 1e9;
            for (const nb of w.provinces[d.loc].neighbors) {
                const q = w.provinces[nb];
                if (!q)
                    continue;
                const nd = dist[nb];
                if (nd === undefined)
                    continue;
                if (nd >= cur)
                    continue;
                if (!PSE.Sim.passable(w, q, c.tag))
                    continue;
                const stack = (byLoc[nb] || []).length;
                if (stack >= perFront + 3)
                    continue;
                const score = nd + stack * 0.5;
                if (score < bestScore) {
                    bestScore = score;
                    best = nb;
                }
            }
            if (best != null)
                PSE.Sim.orderMove(w, [d], best);
        }
        // 3) 后方留守：首都与主要港口保留 1~2 个师
        if (atWar && myDivs.length > 20) {
            const cap = w.provinces[c.capital];
            if (cap) {
                const guard = (byLoc[cap.id] || []).length;
                if (guard < 1) {
                    const spare = myDivs.filter((d) => d.battleId == null && d.status !== 'moving' && !frontIds.has(d.loc))[0];
                    if (spare)
                        PSE.Sim.orderMove(w, [spare], cap.id);
                }
            }
        }
    }
    // ============================================================
    // 空军：把联队前移到有战斗的空域附近
    // ============================================================
    function manageAir(w, c) {
        if (!c.airWings.length)
            return;
        let target = null;
        const myBattles = w.battles.filter((b) => b.atkTag === c.tag || b.defTag === c.tag);
        if (myBattles.length) {
            target = w.provinces[myBattles[0].prov];
        }
        else {
            const own = w.provinces.filter((p) => p.controller === c.tag && p.airbase > 0);
            if (own.length)
                target = own[0];
        }
        if (!target)
            return;
        for (const wing of c.airWings) {
            const cur = w.provinces[wing.loc];
            if (!cur) {
                wing.loc = target.id;
                continue;
            }
            const d = Math.abs(cur.x - target.x) + Math.abs(cur.y - target.y);
            if (d <= 2)
                continue;
            // 找一个靠近 target 的己方有机场省份
            let best = null, bestD = 1e9;
            for (const p of w.provinces) {
                if (p.controller !== c.tag || (p.airbase || 0) <= 0)
                    continue;
                const dist = Math.abs(p.x - target.x) + Math.abs(p.y - target.y);
                if (dist < bestD) {
                    bestD = dist;
                    best = p;
                }
            }
            if (best)
                wing.loc = best.id;
        }
    }
    // ============================================================
    // 外交与战争
    // ============================================================
    function shareBorder(w, a, b) {
        // 两国领土（含占领）是否有省份相邻——决定能否真的打起来
        for (const p of w.provinces) {
            if (p.owner !== a && p.controller !== a)
                continue;
            for (const nb of p.neighbors) {
                const q = w.provinces[nb];
                if (q && (q.owner === b || q.controller === b))
                    return true;
            }
        }
        return false;
    }
    function manageDiplomacy(w, c) {
        const aggr = (c.ai && c.ai.aggression) || 0.3;
        const atWar = PSE.World.inAnyWar(w, c.tag);
        const targets = (c.ai && c.ai.target) || [];
        // 历史节奏门槛：1937 年前基本不主动扩张（侵略性极强的 1936 年起即可，如日本）
        const y = PSE.Time.decompose(w.hour).year;
        const earlyWarAllowed = y >= 1937 || w.tension > 35 || (y >= 1936 && aggr >= 0.8);
        // 已完成的战争目标 → 宣战（评估实力；侵略性越高越敢以弱打强）
        for (const t in c.wargoals) {
            if (!c.wargoals[t])
                continue;
            const d = w.countries[t];
            if (!d || d.capitulated || PSE.World.areAtWar(w, c.tag, t))
                continue;
            if (PSE.World.isPact(w, c.tag, t))
                continue;
            const myPower = armyPower(w, c);
            const theirPower = armyPower(w, d);
            const alliesPower = PSE.World.alliesOf(w, c.tag).reduce((s, a) => s + armyPower(w, w.countries[a]), 0);
            const theirAllies = PSE.World.alliesOf(w, t).reduce((s, a) => s + armyPower(w, w.countries[a]), 0);
            const ratio = (myPower + alliesPower) / Math.max(1, theirPower + theirAllies);
            if (ratio > 0.85 + (1 - aggr) * 0.3 && (earlyWarAllowed || atWar)) {
                PSE.Diplo.declareWar(w, c.tag, t, {});
            }
            break;
        }
        // 制造借口（战时也可继续造，保持扩张压力，最多同时挂 2 个）
        const nGoals = Object.keys(c.wargoals).length;
        if (earlyWarAllowed && !c.justifying && aggr >= 0.4 && c.pp > 60 && targets.length && (!atWar || nGoals < 2)) {
            const myPower = armyPower(w, c);
            // 选目标：按 ai.target 列表优先级（靠前越优先）+ 关系差 + 实力弱
            let best = null, bestScore = -1e9;
            for (let i = 0; i < targets.length; i++) {
                const t = targets[i];
                const d = w.countries[t];
                if (!d || d.capitulated)
                    continue;
                if (c.wargoals[t] || PSE.World.areAtWar(w, c.tag, t))
                    continue;
                if (PSE.World.isPact(w, c.tag, t))
                    continue;
                if (PSE.World.isAllied(w, c.tag, t))
                    continue;
                const rel = c.relations[t] || 0;
                const power = armyPower(w, d);
                // 跨洋/不相邻目标：需以绝对实力碾压（2 倍）才值得造借口，
                // 否则打不到一起，只会空转成互相断贸易的"纸上战争"
                if (!shareBorder(w, c.tag, t) && myPower < power * 2.0)
                    continue;
                const score = (targets.length - i) * 40 - rel - power * 0.005;
                if (score > bestScore) {
                    bestScore = score;
                    best = t;
                }
            }
            // 紧张度门槛随侵略性放宽：好战者低紧张度即可动手
            const tensionGate = Math.max(2, 10 - aggr * 12);
            if (best && w.tension > tensionGate)
                PSE.Cmd.justifyWarGoalFor(w, c, best);
        }
        // 法案：战时提高动员
        if (atWar && c.pp > 160) {
            if (c.laws.conscription < 3 && c.stability > 0.4)
                changeLawFor(w, c, 'conscription', c.laws.conscription + 1);
            else if (c.laws.economy < 3)
                changeLawFor(w, c, 'economy', c.laws.economy + 1);
        }
        // 顾问
        if (c.pp > 160 && c.advisors.length < 3) {
            const pool = (PSE.ADVISORS || []).filter((a) => !c.advisors.some((x) => x.id === a.id));
            if (pool.length) {
                const pick = atWar ? (pool.find((a) => a.mods && (a.mods.brkMul || a.mods.softMul)) || pool[0])
                    : (pool.find((a) => a.mods && (a.mods.civOutput || a.mods.researchSpeed)) || pool[0]);
                buyAdvisorFor(w, c, pick.id);
            }
        }
    }
    function armyPower(w, c) {
        if (!c)
            return 0;
        let p = 0;
        for (const id of c.divisions) {
            const d = w.divisions.find((x) => x.id === id);
            if (!d)
                continue;
            p += (d.template.soft + d.template.def * 0.5 + d.template.brk * 0.7) * d.str;
        }
        return p;
    }
    function changeLawFor(w, c, key, value) {
        const cost = 100 + value * 60;
        if (c.pp < cost)
            return false;
        c.pp -= cost;
        const old = c.laws[key];
        c.laws[key] = value;
        if (key === 'conscription') {
            const oldRate = BAL.CONSCRIPTION[old] || 0.015;
            const newRate = BAL.CONSCRIPTION[value] || 0.015;
            c.manpower += c.population * 1000 * Math.max(0, newRate - oldRate);
        }
        return true;
    }
    function buyAdvisorFor(w, c, advId) {
        const adv = (PSE.ADVISORS || []).find((a) => a.id === advId);
        if (!adv || c.pp < adv.cost)
            return false;
        if (c.advisors.some((a) => a.id === advId))
            return false;
        c.pp -= adv.cost;
        c.advisors.push(adv);
        for (const k in (adv.mods || {}))
            PSE.World.execEffect(w, c, { op: 'mod', key: k, v: adv.mods[k] }, 'auto');
        return true;
    }
    // 供 AI 内部使用的借口制造（不依赖玩家国）
    PSE.Cmd.justifyWarGoalFor = function (w, c, target) {
        if (c.justifying || c.wargoals[target])
            return false;
        const cost = 40;
        if (c.pp < cost)
            return false;
        c.pp -= cost;
        c.justifying = { target, days: 30 };
        return true;
    };
    // ============================================================
    // 主入口（每日）
    // ============================================================
    AI.tickDaily = function (w) {
        for (const tag in w.countries) {
            if (tag === w.playerTag)
                continue;
            const c = w.countries[tag];
            if (c.capitulated)
                continue;
            // 国策
            if (!c.focus.current) {
                const next = AI.pickFocus(w, c);
                if (next)
                    c.focus.current = { id: next, progress: 0 };
            }
            // 每 7 天：生产与建造
            if (w.hour % (24 * 7) === 0) {
                manageProduction(w, c);
                manageConstruction(w, c);
                manageArmy(w, c);
            }
            // 每 3 天：外交
            if (w.hour % (24 * 3) === 0)
                manageDiplomacy(w, c);
            // 每日：战线 + 空军
            if (w.hour % (24 * 2) === 0) {
                manageFront(w, c);
                manageAir(w, c);
            }
        }
    };
    AI.armyPower = armyPower;
    AI.frontProvinces = frontProvinces;
})(typeof window !== 'undefined' ? window : globalThis);
