/* PSE · 内核层 (core.js)
 * 确定性 RNG / 数值工具 / 事件总线 / 时间工具
 * 约束：本文件必须可在 Node 下无 DOM 加载（无头测试用）。
 */
(function (root) {
  'use strict';
  const PSE = (root.PSE = root.PSE || {});

  // ============================================================
  // 1. 数值工具
  // ============================================================
  const U = {
    clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    round2(v) { return Math.round(v * 100) / 100; },
    /** 安全除法：分母为 0 时返回 fallback（避免 NaN 污染存档） */
    div(a, b, fb) { return b === 0 || !isFinite(b) ? (fb === undefined ? 0 : fb) : a / b; },
    /** 木桶效应：取所有系数最小值 */
    minAll(arr) { return arr.length ? Math.min.apply(null, arr) : 1; },
    /** 有序对象遍历（确定性关键：禁止依赖 Object.keys 的插入顺序做随机） */
    sortedKeys(obj) { return Object.keys(obj).sort(); },
    sum(arr, f) { let s = 0; for (let i = 0; i < arr.length; i++) s += f ? f(arr[i]) : arr[i]; return s; },
    /** 1..sides 的档位描述 */
    diceLabel(d) { return 'd' + d; },
  };
  PSE.U = U;

  // ============================================================
  // 2. 确定性随机（xorshift128+）
  //    同一 seed + 同一调用序列 => 同一结果，跨平台一致
  // ============================================================
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function hashStr32(a, b) { return hash32(String(a) + '|' + String(b)); }

  class RNG {
    constructor(seed) {
      // splitmix32 展开成 128bit 状态，避免低质量种子
      let s = (seed >>> 0) || 0x9e3779b9;
      const sm = () => {
        s = (s + 0x9e3779b9) >>> 0;
        let z = s;
        z = (Math.imul(z ^ (z >>> 16), 0x21f0aaad)) >>> 0;
        z = (Math.imul(z ^ (z >>> 15), 0x735a2d97)) >>> 0;
        return (z ^ (z >>> 15)) >>> 0;
      };
      this.s0 = sm() || 1;
      this.s1 = sm() || 2;
    }
    nextU32() {
      let x = this.s0, y = this.s1;
      this.s0 = y;
      x ^= (x << 23) >>> 0;
      this.s1 = (x ^ y ^ (x >>> 17) ^ (y >>> 26)) >>> 0;
      return (this.s1 + y) >>> 0;
    }
    /** [0,1) */
    next01() { return this.nextU32() / 4294967296; }
    /** [0, n) 整数 */
    int(n) { return n <= 0 ? 0 : Math.floor(this.next01() * n); }
    /** 战斗掷骰：1..sides */
    dice(sides) { return 1 + this.int(sides); }
    /** 以 salt 派生独立子流（战斗/国家各自独立，互不干扰） */
    fork(salt) { return new RNG((this.nextU32() ^ hashStr32(salt, this.s0)) >>> 0); }
    static seeded(seed, salt) { return new RNG(hashStr32(seed, salt)); }
  }
  PSE.RNG = RNG;
  PSE.hash32 = hash32;
  PSE.hashStr32 = hashStr32;

  // ============================================================
  // 3. 事件总线（同步分发，深度受限）
  // ============================================================
  class EventBus {
    constructor() { this.handlers = {}; this.depth = 0; }
    on(type, fn) {
      (this.handlers[type] = this.handlers[type] || []).push(fn);
      return () => this.off(type, fn);
    }
    off(type, fn) {
      const a = this.handlers[type]; if (!a) return;
      const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    }
    emit(type, payload) {
      if (this.depth > 8) { console.warn('[PSE] event depth exceeded:', type); return; }
      const a = this.handlers[type]; if (!a || !a.length) return;
      this.depth++;
      for (let i = 0; i < a.length; i++) {
        try { a[i](payload); } catch (e) { console.error('[PSE] handler error', type, e); }
      }
      this.depth--;
    }
  }
  PSE.EventBus = EventBus;
  /** 全局事件总线实例（系统间解耦通信） */
  PSE.bus = new EventBus();

  // ============================================================
  // 4. 时间（以 1936-01-01T00:00 为 hour 0）
  // ============================================================
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInYear(y) { return isLeap(y) ? 366 : 365; }

  const Time = {
    START_YEAR: 1936,
    /** hour -> {year, month(1..12), day(1..31), hour(0..23), dayOfYear, weekOfYear} */
    decompose(hour) {
      let y = 1936, rest = Math.floor(hour);
      while (rest >= daysInYear(y) * 24) { rest -= daysInYear(y) * 24; y++; }
      let day = Math.floor(rest / 24); const h = rest % 24;
      let m = 1, doy = day;
      for (let i = 0; i < 12; i++) {
        const dm = MONTH_DAYS[i] + (i === 1 && isLeap(y) ? 1 : 0);
        if (day < dm) { m = i + 1; break; }
        day -= dm;
      }
      return { year: y, month: m, day: day + 1, hour: h, dayOfYear: doy + 1, weekOfYear: Math.floor(doy / 7) };
    },
    format(hour) {
      const t = Time.decompose(hour);
      return t.year + '-' + String(t.month).padStart(2, '0') + '-' + String(t.day).padStart(2, '0') +
        ' ' + String(t.hour).padStart(2, '0') + ':00';
    },
    formatShort(hour) {
      const t = Time.decompose(hour);
      return t.year + '年' + t.month + '月' + t.day + '日';
    },
    /** 季节：0 春 1 夏 2 秋 3 冬 */
    season(hour) {
      const t = Time.decompose(hour);
      return t.month <= 2 || t.month === 12 ? 3 : t.month <= 5 ? 0 : t.month <= 8 ? 1 : 2;
    },
    /** 从 1936-01-01 到指定日期的天数（剧本用） */
    daysFromStart(y, m, d) {
      let days = 0;
      for (let yy = 1936; yy < y; yy++) days += daysInYear(yy);
      for (let i = 0; i < m - 1; i++) days += MONTH_DAYS[i] + (i === 1 && isLeap(y) ? 1 : 0);
      return days + (d - 1);
    },
  };
  PSE.Time = Time;

  // ============================================================
  // 5. 日志（游戏内消息，供 UI 与回放诊断）
  // ============================================================
  class GameLog {
    constructor(limit) { this.limit = limit || 400; this.items = []; }
    push(hour, text, kind, tag) {
      this.items.push({ hour, text, kind: kind || 'info', tag: tag || '' });
      if (this.items.length > this.limit) this.items.shift();
    }
    recent(n) { return this.items.slice(-(n || 30)); }
  }
  PSE.GameLog = GameLog;

  // ============================================================
  // 6. 深拷贝 / 校验和（存档与确定性验证）
  // ============================================================
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  /** FNV-1a 有序校验和：只取模拟关键字段，浮点量化到 1/10 */
  function stateHash(world) {
    let h = 2166136261 >>> 0;
    const feed = (s) => {
      s = String(s);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    };
    const q = (v) => Math.round((+v || 0) * 10);
    feed(world.hour);
    feed(world.tension | 0);
    const tags = Object.keys(world.countries).sort();
    for (const t of tags) {
      const c = world.countries[t];
      feed(t); feed(q(c.pp)); feed(q(c.stability)); feed(q(c.manpower));
      feed(c.divisions.length); feed(c.focusDone.join(','));
      const eq = Object.keys(c.stockpile).sort();
      for (const e of eq) feed(e + ':' + q(c.stockpile[e]));
      for (const l of c.production) feed(l.equipId + ':' + l.factories + ':' + q(l.eff));
      for (const r of c.research) feed(r.techId + ':' + q(r.prog));
    }
    for (const pr of world.provinces) feed(pr.id + pr.controller + ':' + q(pr.resistance) + ':' + q(pr.compliance) + ':' + q(pr.supply));
    for (const dv of world.divisions) feed(dv.id + dv.tag + ':' + dv.loc + ':' + q(dv.org) + ':' + q(dv.hp) + ':' + q(dv.str));
    for (const war of world.wars) feed(war.id + war.attackers.join('/') + '>' + war.defenders.join('/'));
    return h >>> 0;
  }

  PSE.util2 = { deepClone, stateHash };
})(typeof window !== 'undefined' ? window : globalThis);
