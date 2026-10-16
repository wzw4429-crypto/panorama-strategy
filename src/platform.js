"use strict";
/* PSE · 平台适配层 (platform.js)
 * 一份核心、多个壳：浏览器 / PWA / Tauri / Electron / Android WebView 都只走这里。
 * 壳只要注入一个 host 对象（见 hostContract 注释）即可获得原生能力；
 * 没有壳时全部退回浏览器实现，行为与旧版一致（localStorage + a[download]）。
 */
(function (root) {
    'use strict';
    const PSE = (root.PSE = root.PSE || {});
    const Platform = (PSE.Platform = {});
    /**
     * 桌面壳契约（Tauri/Electron 侧实现同名方法后挂到 window.PSE_HOST）：
     *   kv: { get(k), set(k,v), remove(k), keys() }   // 同步键值（真实文件/原生 store）
     *   saveFile(name, text, mime) -> boolean         // 原生保存对话框
     *   openFile() -> string | null                   // 原生打开对话框，返回文本
     *   notify(title, body)                           // 系统通知
     *   fullscreen(on)                                // 窗口全屏
     *   openExternal(url)                             // 用系统浏览器打开
     */
    function host() { return root.PSE_HOST || null; }
    function hasTauri() { return !!(root.__TAURI__ || root.__TAURI_INTERNALS__); }
    function hasElectron() { return !!(root.process && root.process.versions && root.process.versions.electron); }
    function isStandalone() {
        try {
            if (root.navigator && root.navigator.standalone)
                return true;
            return !!(root.matchMedia && root.matchMedia('(display-mode: standalone)').matches);
        }
        catch (e) {
            return false;
        }
    }
    Platform.kind = function () {
        const h = host();
        if (h)
            return h.kind || 'host'; // 宿主没说 kind 就给通用标签（kind 只是展示用字符串）
        if (hasTauri())
            return 'tauri';
        if (hasElectron())
            return 'electron';
        if (isStandalone())
            return 'pwa';
        return 'web';
    };
    /** 是否桌面壳：**以"有没有宿主"为准**，kind 只是标签
     *  （Go+WebView2 壳报 'webview2'，不能再只认 tauri/electron）；
     *  宿主可显式写 `desktop: false` 表示自己是伪装成宿主的 web 垫片。 */
    Platform.isDesktop = function () {
        const h = host();
        if (h)
            return typeof h.desktop === 'boolean' ? !!h.desktop : true;
        const k = Platform.kind();
        return k === 'tauri' || k === 'electron';
    };
    /** 手机/平板：只有浏览器壳才需要「横屏提示 / 触摸手势」这类适配 */
    Platform.isMobile = function () {
        if (Platform.isDesktop())
            return false;
        try {
            return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|Mobile/i.test(root.navigator && root.navigator.userAgent || '');
        }
        catch (e) {
            return false;
        }
    };
    /** 键值存储：壳原生 KV > localStorage > 内存（Node 无头测试 / file:// 隐私模式） */
    const mem = {};
    const memStore = {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
        key: (i) => Object.keys(mem)[i] || null,
        get length() { return Object.keys(mem).length; },
    };
    Platform.store = function () {
        const h = host();
        if (h && h.kv) {
            return {
                getItem: (k) => { const v = h.kv.get(k); return v == null ? null : String(v); },
                setItem: (k, v) => { h.kv.set(k, String(v)); },
                removeItem: (k) => { h.kv.remove(k); },
                key: (i) => (h.kv.keys() || [])[i] || null,
                get length() { return (h.kv.keys() || []).length; },
            };
        }
        try {
            if (typeof root.localStorage !== 'undefined' && root.localStorage)
                return root.localStorage;
        }
        catch (e) { /* file:// 或隐私模式 */ }
        return memStore;
    };
    Platform.storageKind = function () {
        const h = host();
        if (h && h.kv)
            return 'native';
        try {
            if (typeof root.localStorage !== 'undefined' && root.localStorage)
                return 'localStorage';
        }
        catch (e) { /* ignore */ }
        return 'memory';
    };
    /** 导出文本到文件：桌面壳走原生对话框，浏览器走下载 */
    Platform.download = function (name, text, mime) {
        const h = host();
        if (h && h.saveFile)
            return !!h.saveFile(name, text, mime || 'application/json');
        if (typeof document === 'undefined')
            return false;
        try {
            const blob = new Blob([text], { type: mime || 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            setTimeout(() => { try {
                URL.revokeObjectURL(a.href);
            }
            catch (e) { /* ignore */ } }, 1000);
            return true;
        }
        catch (e) {
            return false;
        }
    };
    /** 读取一个文本文件（导入存档）：桌面壳走原生对话框，浏览器走隐藏 input */
    Platform.pickText = function (accept) {
        const h = host();
        if (h && h.openFile)
            return Promise.resolve(h.openFile());
        if (typeof document === 'undefined')
            return Promise.resolve(null);
        return new Promise((resolve) => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = accept || '.json,application/json';
            inp.style.display = 'none';
            inp.onchange = () => {
                const f = inp.files && inp.files[0];
                if (!f) {
                    resolve(null);
                    return;
                }
                const fr = new FileReader();
                fr.onload = () => resolve(String(fr.result));
                fr.onerror = () => resolve(null);
                fr.readAsText(f);
            };
            document.body.appendChild(inp);
            inp.click();
            setTimeout(() => { if (inp.parentNode)
                inp.parentNode.removeChild(inp); }, 0);
        });
    };
    Platform.notify = function (title, body) {
        const h = host();
        if (h && h.notify) {
            h.notify(title, body || '');
            return true;
        }
        try {
            if (typeof Notification === 'undefined')
                return false;
            if (Notification.permission === 'granted') {
                new Notification(title, { body: body || '' });
                return true;
            }
            if (Notification.permission === 'default') {
                Notification.requestPermission();
                return false;
            }
        }
        catch (e) { /* ignore */ }
        return false;
    };
    Platform.fullscreen = function (on) {
        const h = host();
        if (h && h.fullscreen) {
            h.fullscreen(on);
            return true;
        }
        return false;
    };
    Platform.openExternal = function (url) {
        const h = host();
        if (h && h.openExternal) {
            h.openExternal(url);
            return true;
        }
        if (typeof root.open === 'function') {
            root.open(url, '_blank');
            return true;
        }
        return false;
    };
    /** 关于/调试用：一句话描述当前运行环境 */
    Platform.info = function () {
        return {
            kind: Platform.kind(), desktop: Platform.isDesktop(), mobile: Platform.isMobile(),
            storage: Platform.storageKind(), host: !!host(), standalone: isStandalone(),
            ua: String(root.navigator && root.navigator.userAgent || ''),
        };
    };
})(typeof window !== 'undefined' ? window : globalThis);
