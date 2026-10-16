"use strict";
/* PSE · 存档 (save.js)
 * 存储走 PSE.Platform.store()：桌面壳原生文件 > localStorage > 内存（Node 无头测试）。
 * 铁人模式：每月自动存档、禁用作弊命令、存档带校验和。
 */
(function (root) {
    'use strict';
    const PSE = (root.PSE = root.PSE || {});
    const Save = (PSE.Save = {});
    /** 兼容没有 platform.js 的老页面/单测：退回 localStorage 或内存 */
    const mem = {};
    function store() {
        if (PSE.Platform && PSE.Platform.store)
            return PSE.Platform.store();
        try {
            if (typeof root.localStorage !== 'undefined' && root.localStorage)
                return root.localStorage;
        }
        catch (e) { /* file:// 或隐私模式 */ }
        return {
            getItem: (k) => (k in mem ? mem[k] : null),
            setItem: (k, v) => { mem[k] = String(v); },
            removeItem: (k) => { delete mem[k]; },
            key: (i) => Object.keys(mem)[i] || null,
            get length() { return Object.keys(mem).length; },
        };
    }
    const PREFIX = 'pse_save_';
    Save.save = function (w, slot, opts) {
        opts = opts || {};
        const payload = {
            version: w.version, savedAt: new Date().toISOString(),
            hour: w.hour, playerTag: w.playerTag, ironman: !!w.ironman,
            hash: PSE.util2.stateHash(w),
            world: w,
        };
        const text = JSON.stringify(payload);
        try {
            store().setItem(PREFIX + slot, text);
            return { ok: true, slot, bytes: text.length, hash: payload.hash };
        }
        catch (e) {
            return { ok: false, error: String(e && e.message || e) };
        }
    };
    Save.load = function (slot) {
        const text = store().getItem(PREFIX + slot);
        if (!text)
            return null;
        try {
            const payload = JSON.parse(text);
            const w = PSE.World.deserialize(JSON.stringify(payload.world));
            w.ironman = !!payload.ironman;
            return w;
        }
        catch (e) {
            return null;
        }
    };
    Save.list = function () {
        const out = [];
        const s = store();
        for (let i = 0; i < (s.length || 0); i++) {
            const k = s.key(i);
            if (!k || k.indexOf(PREFIX) !== 0)
                continue;
            const slot = k.slice(PREFIX.length);
            try {
                const payload = JSON.parse(s.getItem(k));
                out.push({ slot, hour: payload.hour, playerTag: payload.playerTag, ironman: !!payload.ironman, savedAt: payload.savedAt, hash: payload.hash });
            }
            catch (e) {
                out.push({ slot, corrupt: true });
            }
        }
        return out;
    };
    Save.remove = function (slot) { store().removeItem(PREFIX + slot); };
    Save.exportText = function (w) { return JSON.stringify({ version: w.version, hour: w.hour, playerTag: w.playerTag, world: w }); };
    Save.importText = function (text) {
        try {
            const payload = JSON.parse(text);
            const w = PSE.World.deserialize(JSON.stringify(payload.world || payload));
            return w;
        }
        catch (e) {
            return null;
        }
    };
    /** 自动存档：每月一次（铁人模式每月 + 关键事件） */
    Save.autoTick = function (w, lastAuto) {
        const day = Math.floor(w.hour / 24);
        if (day - (lastAuto || 0) < 30)
            return lastAuto || 0;
        Save.save(w, w.ironman ? 'ironman' : 'autosave', {});
        return day;
    };
})(typeof window !== 'undefined' ? window : globalThis);
