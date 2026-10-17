"use strict";
/* PSE · 主题化下拉组件（把原生 <select> 换成深色风格的自定义下拉）
 *
 * 为什么要它：浏览器原生 <select> 弹出的系统列表无法用 CSS 控制 —— 开局界面点「选择国家」时
 *   它会从窗口顶端一路铺下来盖住标题与表单、列表被窗口边缘裁切、鼠标悬停用系统浅色条
 *   （深色页面上就是一条白光在闪）。所以：原生 <select> 只保留数据与事件语义（.value /
 *   option / change 事件，现有代码一行都不用改），外观交互全部换成我们自己的。
 *
 * 用法：任何会生成 <select> 的 HTML 渲染完之后，调用 PSE.SelectUI.enhance(容器)；
 *   ui.ts 的 renderPanel() 与 main.ts 的开局界面已经接好。选项是运行时 innerHTML 重写的，
 *   所以弹层每次打开都重新读 select.options（不缓存），另外有个轻量 MutationObserver 兜底
 *   捕捉后续动态插入的 select。
 *
 * 键盘：Enter/Space/↑↓ 打开；打开后 ↑↓/Home/End 移动、Enter 选中、Esc 关闭、Tab 关闭；
 *   点击外部关闭；弹层靠近视口底部时自动向上翻转，任何情况下不超出视口。
 */
(function () {
    const root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
    const PSE = (root.PSE = root.PSE || {});
    const SU = (PSE.SelectUI = PSE.SelectUI || {});
    const parts = typeof WeakMap === 'function' ? new WeakMap() : null; // select → 组件记录
    let count = 0;
    let openRec = null; // 当前展开的组件记录
    let layer = null; // 页面内的弹层容器（不是浏览器原生 UI）
    let docBound = false;
    let measureCtx = null;
    function D() { return root.document || null; }
    function tag(el) { return el && el.tagName ? String(el.tagName).toUpperCase() : ''; }
    function optionsOf(sel) {
        const out = [];
        try {
            const os = sel && sel.options;
            if (os && typeof os.length === 'number') {
                for (let i = 0; i < os.length; i++)
                    if (os[i])
                        out.push(os[i]);
            }
        }
        catch (e) { /* 测试桩 */ }
        return out;
    }
    function optionText(o) {
        if (!o)
            return '';
        const t = o.textContent != null ? o.textContent : (o.text != null ? o.text : '');
        return String(t);
    }
    function optionValue(o) { return o && o.value != null ? String(o.value) : ''; }
    function selIndex(sel) {
        const os = optionsOf(sel);
        if (!os.length)
            return -1;
        let i = typeof sel.selectedIndex === 'number' ? sel.selectedIndex : -1;
        if (i >= 0 && i < os.length)
            return i;
        for (let k = 0; k < os.length; k++)
            if (optionValue(os[k]) === String(sel.value))
                return k;
        return 0;
    }
    function setAttr(el, k, v) { try {
        if (el && el.setAttribute)
            el.setAttribute(k, v);
    }
    catch (e) { } }
    function addClass(el, c) { try {
        if (el && el.classList)
            el.classList.add(c);
    }
    catch (e) { } }
    function removeClass(el, c) { try {
        if (el && el.classList)
            el.classList.remove(c);
    }
    catch (e) { } }
    function hasClass(el, c) { try {
        return !!(el && el.classList && el.classList.contains(c));
    }
    catch (e) {
        return false;
    } }
    function textWidth(sel, text, fontEl) {
        try {
            const d = D();
            if (!d || !d.createElement)
                return String(text).length * 12; // 兜底估算
            if (!measureCtx) {
                const c = d.createElement('canvas');
                measureCtx = c && c.getContext ? c.getContext('2d') : null;
            }
            if (!measureCtx)
                return String(text).length * 12;
            let font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
            try {
                const cs = root.getComputedStyle ? root.getComputedStyle(fontEl || sel) : null;
                if (cs) {
                    const size = cs.fontSize || '12px';
                    const family = cs.fontFamily || 'sans-serif';
                    font = (cs.fontStyle || '') + ' ' + (cs.fontWeight || '') + ' ' + size + ' ' + family;
                    font = font.replace(/\s+/g, ' ').trim();
                }
            }
            catch (e) { /* 保持默认字体 */ }
            measureCtx.font = font || '12px system-ui';
            return measureCtx.measureText(String(text)).width || 0;
        }
        catch (e) {
            return String(text).length * 12;
        }
    }
    /** 触发器宽度按最长选项自适应：文字宽 + 12px 余量 + 箭头/间距/内边距（按实际计算样式，兼容移动端字号/间距覆盖）；弹层宽度也按文字自适应 */
    function fitWidth(sel, rec) {
        const os = optionsOf(sel);
        let max = 0;
        for (let i = 0; i < os.length; i++)
            max = Math.max(max, textWidth(sel, optionText(os[i]), rec.btn));
        let extra = 12 + 10 + 6 + 16; // 兜底：余量 12 + 箭头 10 + 间距 6 + 内边距 16
        try {
            const cs = root.getComputedStyle ? root.getComputedStyle(rec.btn) : null;
            if (cs) {
                const px = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
                const pad = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
                const gap = px(cs.columnGap) || px(cs.gap) || 6;
                let arrowW = 10;
                try {
                    if (rec.arrow && rec.arrow.offsetWidth)
                        arrowW = rec.arrow.offsetWidth;
                }
                catch (e) { }
                extra = 12 + pad + gap + arrowW;
            }
        }
        catch (e) { /* 测试桩没有 getComputedStyle */ }
        const w = Math.max(78, Math.ceil(max + extra));
        try {
            rec.wrap.style.minWidth = w + 'px';
            rec.wrap.style.maxWidth = '100%';
            rec.btn.style.minWidth = w + 'px';
            // 弹层行内文字区 = 弹层宽 - 行内边距 16 - 对勾 12 - 间距 6 - 弹层内边距 8 - 边框 2；再留 12 余量
            if (rec.pop)
                rec.pop.style.minWidth = Math.max(150, Math.ceil(max + 12 + 16 + 12 + 6 + 8 + 2)) + 'px';
        }
        catch (e) { /* 测试桩 */ }
    }
    function syncLabel(sel) {
        const rec = parts ? parts.get(sel) : null;
        if (!rec)
            return;
        const os = optionsOf(sel);
        const i = selIndex(sel);
        const txt = i >= 0 ? optionText(os[i]) : '';
        try {
            rec.lab.textContent = txt || '（无选项）';
        }
        catch (e) { }
        try {
            rec.btn.title = txt;
        }
        catch (e) { }
        try {
            rec.btn.disabled = !!sel.disabled;
        }
        catch (e) { }
        addClass(rec.btn, 'pselEmpty');
        if (txt)
            removeClass(rec.btn, 'pselEmpty');
    }
    function ensureLayer() {
        const d = D();
        if (!d)
            return null;
        if (layer && layer.parentNode)
            return layer;
        if (!d.body)
            return null;
        layer = d.createElement('div');
        layer.className = 'pselLayer';
        d.body.appendChild(layer);
        return layer;
    }
    function viewport() {
        const w = root.innerWidth || (root.screen && root.screen.width) || 1280;
        const h = root.innerHeight || (root.screen && root.screen.height) || 800;
        return { w: w, h: h };
    }
    /** 弹层定位：默认向下；下方空间不足且上方更宽裕时向上翻转；左右夹在视口内 */
    function positionPop(rec) {
        if (!rec || !rec.pop || !rec.btn)
            return;
        try {
            const r = rec.btn.getBoundingClientRect ? rec.btn.getBoundingClientRect() : null;
            if (!r)
                return;
            const vp = viewport();
            const gap = 4;
            const minSpace = 96;
            let below = vp.h - r.bottom - gap - 8;
            let above = r.top - gap - 8;
            let openUp = below < Math.min(200, vp.h * 0.45) && above > below;
            let space = openUp ? above : below;
            let popH = Math.min(280, Math.max(minSpace, space));
            if (popH > space)
                popH = Math.max(24, space);
            const width = Math.max(Math.ceil(r.width || 0), 150);
            let left = Math.round(r.left || 0);
            left = Math.max(8, Math.min(left, vp.w - width - 8));
            try {
                rec.pop.style.position = 'absolute';
                rec.pop.style.width = width + 'px';
                rec.pop.style.maxHeight = Math.round(popH) + 'px';
                rec.pop.style.left = left + 'px';
                if (openUp) {
                    rec.pop.style.top = Math.round(r.top - popH - gap) + 'px';
                    rec.pop.style.bottom = '';
                }
                else {
                    rec.pop.style.top = Math.round(r.bottom + gap) + 'px';
                    rec.pop.style.bottom = '';
                }
            }
            catch (e) { }
            rec.openUp = openUp;
        }
        catch (e) { /* 测试桩 */ }
    }
    function rowsOf(rec) { return (rec && rec.rows) || []; }
    function highlight(rec, idx) {
        const rows = rowsOf(rec);
        for (let i = 0; i < rows.length; i++) {
            if (i === idx)
                addClass(rows[i], 'hl');
            else
                removeClass(rows[i], 'hl');
        }
        rec.activeIdx = idx;
    }
    function scrollToActive(rec) {
        const rows = rowsOf(rec);
        const row = rows[rec.activeIdx];
        if (!row || !rec.pop)
            return;
        try {
            const top = row.offsetTop || 0;
            const h = row.offsetHeight || 24;
            const ch = rec.pop.clientHeight || 280;
            if (top < rec.pop.scrollTop)
                rec.pop.scrollTop = Math.max(0, top - 4);
            else if (top + h > rec.pop.scrollTop + ch)
                rec.pop.scrollTop = top + h - ch + 4;
        }
        catch (e) { /* 测试桩 */ }
    }
    function clampInside(rec) {
        if (!rec || !rec.pop)
            return;
        if (rec.activeIdx >= 0)
            scrollToActive(rec);
    }
    /** 重新填弹层内容：每次打开都重新读 select.options（选项可能刚被面板重写过） */
    function repopulate(rec) {
        const d = D();
        if (!d || !rec || !rec.pop)
            return;
        const sel = rec.sel;
        const os = optionsOf(sel);
        rec.rows = [];
        try {
            rec.pop.innerHTML = '';
        }
        catch (e) { }
        for (let i = 0; i < os.length; i++) {
            const o = os[i];
            const row = d.createElement('div');
            row.className = 'pselOpt';
            setAttr(row, 'role', 'option');
            setAttr(row, 'data-i', String(i));
            setAttr(row, 'data-value', optionValue(o));
            const tick = d.createElement('span');
            tick.className = 'pselTick';
            tick.textContent = '✓';
            const txt = d.createElement('span');
            txt.className = 'pselOptText';
            txt.textContent = optionText(o);
            row.appendChild(tick);
            row.appendChild(txt);
            if (o.disabled)
                addClass(row, 'dis');
            if (i === selIndex(sel)) {
                addClass(row, 'sel');
                setAttr(row, 'aria-selected', 'true');
            }
            else
                setAttr(row, 'aria-selected', 'false');
            try {
                row.addEventListener('mousedown', (ev) => { if (ev && ev.preventDefault)
                    ev.preventDefault(); });
                row.addEventListener('mouseover', () => { if (openRec === rec)
                    highlight(rec, i); });
                row.addEventListener('click', (ev) => {
                    if (ev) {
                        if (ev.preventDefault)
                            ev.preventDefault();
                        if (ev.stopPropagation)
                            ev.stopPropagation();
                    }
                    choose(rec, i);
                });
            }
            catch (e) { }
            rec.pop.appendChild(row);
            rec.rows.push(row);
        }
    }
    function choose(rec, i) {
        const sel = rec && rec.sel;
        if (!sel)
            return;
        const os = optionsOf(sel);
        const o = os[i];
        if (!o || o.disabled)
            return;
        try {
            sel.selectedIndex = i;
        }
        catch (e) { }
        try {
            sel.value = optionValue(o);
        }
        catch (e) { }
        syncLabel(sel);
        close();
        // 照旧派发 change：面板里原有的 onchange / addEventListener('change') 全部生效
        try {
            let ev = null;
            if (typeof root.Event === 'function')
                ev = new root.Event('change', { bubbles: true });
            else {
                const d = D();
                if (d && d.createEvent) {
                    ev = d.createEvent('Event');
                    ev.initEvent('change', true, false);
                }
            }
            if (ev && sel.dispatchEvent)
                sel.dispatchEvent(ev);
        }
        catch (e) { /* 事件派发失败不影响取值 */ }
    }
    function open(rec) {
        if (!rec || !rec.pop || !rec.btn)
            return;
        if (openRec && openRec !== rec)
            close();
        const layerEl = ensureLayer();
        if (layerEl && rec.pop.parentNode !== layerEl) {
            try {
                layerEl.appendChild(rec.pop);
            }
            catch (e) { }
        }
        repopulate(rec);
        positionPop(rec);
        removeClass(rec.pop, 'hidden');
        addClass(rec.pop, 'open');
        setAttr(rec.btn, 'aria-expanded', 'true');
        addClass(rec.btn, 'open');
        try {
            rec.pop.scrollTop = 0;
        }
        catch (e) { }
        rec.open = true;
        openRec = rec;
        highlight(rec, selIndex(rec.sel));
        scrollToActive(rec);
    }
    function close() {
        const rec = openRec;
        openRec = null;
        if (!rec)
            return;
        rec.open = false;
        addClass(rec.pop, 'hidden');
        removeClass(rec.pop, 'open');
        setAttr(rec.btn, 'aria-expanded', 'false');
        removeClass(rec.btn, 'open');
        highlight(rec, -1);
    }
    function moveActive(rec, dir) {
        const os = optionsOf(rec.sel);
        const rows = rowsOf(rec);
        if (!os.length)
            return;
        let i = typeof rec.activeIdx === 'number' ? rec.activeIdx : -1;
        for (let n = 0; n < os.length; n++) {
            i = (i + dir + os.length) % os.length;
            if (!os[i] || os[i].disabled)
                continue;
            highlight(rec, i);
            scrollToActive(rec);
            return;
        }
    }
    function onDocKey(e) {
        if (!openRec || !e)
            return;
        const k = e.key;
        if (k === 'Escape' || k === 'Esc') {
            if (e.preventDefault)
                e.preventDefault();
            if (e.stopPropagation)
                e.stopPropagation();
            const rec = openRec;
            close();
            try {
                if (rec && rec.btn && rec.btn.focus)
                    rec.btn.focus();
            }
            catch (err) { }
            return;
        }
        if (k === 'ArrowDown') {
            if (e.preventDefault)
                e.preventDefault();
            if (e.stopPropagation)
                e.stopPropagation();
            moveActive(openRec, 1);
            return;
        }
        if (k === 'ArrowUp') {
            if (e.preventDefault)
                e.preventDefault();
            if (e.stopPropagation)
                e.stopPropagation();
            moveActive(openRec, -1);
            return;
        }
        if (k === 'Home') {
            if (e.preventDefault)
                e.preventDefault();
            highlight(openRec, 0);
            scrollToActive(openRec);
            return;
        }
        if (k === 'End') {
            if (e.preventDefault)
                e.preventDefault();
            highlight(openRec, optionsOf(openRec.sel).length - 1);
            scrollToActive(openRec);
            return;
        }
        if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
            if (e.preventDefault)
                e.preventDefault();
            if (e.stopPropagation)
                e.stopPropagation();
            choose(openRec, openRec.activeIdx);
            return;
        }
        if (k === 'Tab')
            close();
    }
    function bindDocOnce() {
        if (docBound)
            return;
        const d = D();
        if (!d)
            return;
        docBound = true;
        try {
            d.addEventListener('mousedown', (e) => {
                if (!openRec)
                    return;
                const t = e && e.target;
                if (openRec.wrap && t && (openRec.wrap === t || (openRec.wrap.contains && openRec.wrap.contains(t))))
                    return;
                if (openRec.pop && t && openRec.pop.contains && openRec.pop.contains(t))
                    return;
                close();
            }, true);
            d.addEventListener('keydown', onDocKey, true);
        }
        catch (e) { }
        try {
            root.addEventListener('resize', () => { if (openRec)
                positionPop(openRec); });
            // 弹层跟随滚动（页面/面板滚动时重新定位），不打断原生滚动
            root.addEventListener('scroll', () => { if (openRec)
                positionPop(openRec); }, true);
        }
        catch (e) { }
    }
    function build(sel) {
        const d = D();
        if (!d || !sel || !sel.parentNode)
            return null;
        if (parts && parts.get(sel))
            return null;
        if (tag(sel) !== 'SELECT')
            return null;
        if (hasClass(sel, 'pselNative'))
            return null;
        try {
            if (sel.getAttribute && sel.getAttribute('data-psel') === '1')
                return null;
        }
        catch (e) { }
        try {
            if (sel.hasAttribute && sel.hasAttribute('data-native'))
                return null;
        }
        catch (e) { }
        const wrap = d.createElement('span');
        wrap.className = 'psel';
        const btn = d.createElement('button');
        btn.type = 'button';
        btn.className = 'pselBtn';
        setAttr(btn, 'aria-haspopup', 'listbox');
        setAttr(btn, 'aria-expanded', 'false');
        const lab = d.createElement('span');
        lab.className = 'pselLabel';
        const arrow = d.createElement('span');
        arrow.className = 'pselArrow';
        arrow.textContent = '▾';
        btn.appendChild(lab);
        btn.appendChild(arrow);
        const pop = d.createElement('div');
        pop.className = 'pselPop hidden';
        setAttr(pop, 'role', 'listbox');
        // 原生 select 视觉隐藏（保留 value/change/表单语义），移进 wrapper 的定位盒里
        try {
            sel.parentNode.insertBefore(wrap, sel);
        }
        catch (e) {
            return null;
        }
        wrap.appendChild(sel);
        wrap.appendChild(btn);
        addClass(sel, 'pselNative');
        setAttr(sel, 'data-psel', '1');
        setAttr(sel, 'tabindex', '-1');
        setAttr(sel, 'aria-hidden', 'true');
        const rec = { sel: sel, wrap: wrap, btn: btn, pop: pop, lab: lab, arrow: arrow, rows: [], open: false, activeIdx: -1 };
        if (parts)
            parts.set(sel, rec);
        count++;
        try {
            btn.addEventListener('click', (ev) => {
                if (ev) {
                    if (ev.preventDefault)
                        ev.preventDefault();
                    if (ev.stopPropagation)
                        ev.stopPropagation();
                }
                if (sel.disabled)
                    return;
                if (rec.open)
                    close();
                else
                    open(rec);
            });
            btn.addEventListener('mousedown', (ev) => { if (ev && ev.preventDefault)
                ev.preventDefault(); });
            btn.addEventListener('keydown', (ev) => {
                const k = ev && ev.key;
                if (!k)
                    return;
                if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'ArrowDown' || k === 'ArrowUp') {
                    if (ev.preventDefault)
                        ev.preventDefault();
                    if (rec.open) {
                        if (k !== 'Enter' && k !== ' ')
                            moveActive(rec, k === 'ArrowUp' ? -1 : 1);
                    }
                    else {
                        open(rec);
                        if (k === 'ArrowUp')
                            moveActive(rec, -1);
                    }
                }
            });
            // 外部（代码里）直接改 select.value / selectedIndex 时同步触发器文字
            sel.addEventListener('change', () => syncLabel(sel));
            sel.addEventListener('input', () => syncLabel(sel));
        }
        catch (e) { }
        fitWidth(sel, rec);
        syncLabel(sel);
        bindDocOnce();
        return rec;
    }
    /** 统一入口：增强容器内所有还没被增强的 <select>；返回本次增强的数量 */
    SU.enhance = function (node) {
        const d = D();
        if (!d)
            return 0;
        const host = node || d;
        let list = [];
        try {
            if (host.querySelectorAll)
                list = Array.prototype.slice.call(host.querySelectorAll('select'));
        }
        catch (e) {
            list = [];
        }
        let n = 0;
        for (let i = 0; i < list.length; i++) {
            try {
                if (build(list[i]))
                    n++;
            }
            catch (e) { /* 单个失败不影响其它 */ }
        }
        return n;
    };
    SU.enhanceAll = function () { return SU.enhance(D()); };
    SU.isOpen = function () { return !!openRec; };
    SU.close = close;
    SU.count = function () { return count; };
    /** 测试/调试：组件状态（触发器与弹层节点、是否展开、当前文字） */
    SU.state = function (sel) {
        const rec = sel && parts ? parts.get(sel) : null;
        if (!rec)
            return { enhanced: false };
        return {
            enhanced: true, open: !!rec.open, trigger: rec.btn, popup: rec.pop,
            label: rec.lab ? rec.lab.textContent : '', options: optionsOf(sel).length,
        };
    };
    /** 测试/调试：弹层里每行的文字（按当前 options 顺序） */
    SU.texts = function (sel) {
        const os = optionsOf(sel);
        const out = [];
        for (let i = 0; i < os.length; i++)
            out.push(optionText(os[i]));
        return out;
    };
    /** 供 ui.ts 在外部改写选项后刷新触发器文字（选项变化时同时重算宽度） */
    SU.refresh = function (sel) {
        const rec = sel && parts ? parts.get(sel) : null;
        if (rec)
            fitWidth(sel, rec);
        syncLabel(sel);
    };
    SU.refreshAll = function () {
        const d = D();
        if (!d || !d.querySelectorAll)
            return;
        try {
            const list = Array.prototype.slice.call(d.querySelectorAll('select'));
            for (let i = 0; i < list.length; i++) {
                const rec = parts ? parts.get(list[i]) : null;
                if (rec)
                    fitWidth(list[i], rec);
                syncLabel(list[i]);
            }
        }
        catch (e) { }
    };
    // 兜底：面板/开局界面之外的动态 select（MutationObserver 存在才启用；测试桩没有则跳过）
    function observe() {
        const d = D();
        if (!d || !root.MutationObserver || !d.body)
            return;
        try {
            const mo = new root.MutationObserver(() => { SU.enhance(d); });
            mo.observe(d.body, { childList: true, subtree: true });
        }
        catch (e) { }
    }
    SU.observe = observe;
    if (typeof root.document !== 'undefined' && root.document) {
        if (root.document.readyState === 'loading' && root.document.addEventListener) {
            root.document.addEventListener('DOMContentLoaded', observe);
        }
        else
            observe();
    }
})();
