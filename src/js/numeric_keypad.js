/* eslint-disable no-empty */
import * as config from "@/js/config.js";

/* Custom numeric keypad, ported from home/betaflight/rfcap-apk (www/bridge.js ->
   installKeypad). Replaces the Android soft keyboard for numeric inputs:
   - numeric inputs get inputmode="none" + readonly so the native IME never pops
   - an on-screen pad edits them instead (betaflight-configurator-style touch entry)
   - the field being edited is highlighted (no focus cursor)
   - the pad is pinned to a screen corner (default bottom-right) and can be dragged
     to any position (position persisted via config) so it never covers the field.
   CLI / text inputs are untouched (they keep the system keyboard). */

export function openNumericPad(el) {
    if (typeof globalThis !== 'undefined' && globalThis.__rfOpenNumericPad) {
        globalThis.__rfOpenNumericPad(el);
    }
}

export function installNumericKeypad() {
    const SELECTOR = 'input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"]';
    const pad = document.createElement('div');
    pad.id = 'rf-numpad';
    const KEYS = ['7','8','9','BKSP', '4','5','6','UP', '1','2','3','DOWN', '.','0','-','DONE'];
    pad.innerHTML = '<div class="rfnp-handle" data-drag="1">&#8943;</div><div class="rfnp-grid">' +
        KEYS.map(k => {
            const label = k === 'BKSP' ? '&#9003;' : k === 'UP' ? '&#9650;'
                        : k === 'DOWN' ? '&#9660;' : k === 'DONE' ? '&#10003;' : k;
            return '<button type="button" data-k="' + k + '">' + label + '</button>';
        }).join('') + '</div>';

    let target = null, buf = '', hideTO = null, hideEl = null, editEl = null;

    function markEditing(el) {
        if (editEl === el) return;
        if (editEl) { try { editEl.classList.remove('rf-editing'); } catch {} }
        editEl = el || null;
        if (editEl) { try { editEl.classList.add('rf-editing'); } catch {} }
    }

    function themePad() {
        const cs = getComputedStyle(document.documentElement);
        const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
        pad.style.background = v('--color-surface-float', 'rgba(28,31,37,.96)');
        pad.style.borderColor = v('--color-border', '#444');
        pad.querySelectorAll('button').forEach(b => {
            b.style.color = v('--color-text', '#eee');
        });
        const done = pad.querySelector('[data-k="DONE"]');
        if (done) done.style.background = v('--accent', 'hsl(202,100%,45%)');
    }

    function getScrollContainer(node) {
        let el = node ? node.parentElement : null;
        while (el && el !== document.documentElement) {
            const s = getComputedStyle(el);
            const sy = s.overflowY;
            if ((sy === 'auto' || sy === 'scroll' || sy === 'overlay') && el.scrollHeight > el.clientHeight + 1) return el;
            el = el.parentElement;
        }
        return null;
    }

    let bottomSpacer = null;
    function ensureBottomSpace() {
        if (/status\.html/i.test(location.pathname)) return;
        const sample = document.querySelector(SELECTOR) || document.body;
        const cont = getScrollContainer(sample) || document.body;
        if (!bottomSpacer) {
            bottomSpacer = document.createElement('div');
            bottomSpacer.id = 'rf-numpad-spacer';
            bottomSpacer.style.pointerEvents = 'none';
            bottomSpacer.style.flex = '0 0 auto';
        }
        if (bottomSpacer.parentNode !== cont) cont.appendChild(bottomSpacer);
        bottomSpacer.style.height = ((PADH || 230) + 48) + 'px';
    }

    function smoothScrollTo(scroller, targetTop) {
        try {
            const max = scroller.scrollHeight - scroller.clientHeight;
            targetTop = Math.max(0, Math.min(targetTop, max));
            if (Math.abs(targetTop - scroller.scrollTop) < 2) return;
            scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
            return;
        } catch {}
        const from = scroller.scrollTop, to = targetTop;
        const t0 = performance.now(), dur = 300;
        const step = (t) => {
            const k = Math.min(1, (t - t0) / dur);
            const ease = 1 - Math.pow(1 - k, 3);
            scroller.scrollTop = from + (to - from) * ease;
            if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function ensureFieldVisible(el) {
        try {
            ensureBottomSpace();
            const padH = PADH || 230;
            const limit = window.innerHeight - padH - 8 - 24;
            const sp = getScrollContainer(el);
            const scroller = sp || document.scrollingElement || document.documentElement;
            const rect = el.getBoundingClientRect();
            let delta = 0;
            if (rect.bottom > limit) delta = rect.bottom - limit;
            else if (rect.top < 0) delta = rect.top;
            else return;
            if (delta > 0 && bottomSpacer) {
                const want = Math.ceil(delta) + 120;
                if ((parseFloat(bottomSpacer.style.height) || 0) < want) {
                    bottomSpacer.style.height = want + 'px';
                }
            }
            smoothScrollTo(scroller, scroller.scrollTop + delta);
            setTimeout(() => {
                try {
                    const r2 = el.getBoundingClientRect();
                    const stillLow = r2.bottom - limit;
                    if (stillLow > 4) {
                        if (bottomSpacer && (parseFloat(bottomSpacer.style.height) || 0) < stillLow + 120) {
                            bottomSpacer.style.height = Math.ceil(stillLow + 120) + 'px';
                        }
                        const max = scroller.scrollHeight - scroller.clientHeight;
                        scroller.scrollTop = Math.min(max, scroller.scrollTop + stillLow);
                    }
                } catch {}
            }, 500);
        } catch {}
    }

    let PADH = 230;
    function applySavedPosition() {
        let saved = null;
        try { saved = config.get('numericPadPos'); } catch {}
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
            pad.style.right = 'auto';
            pad.style.bottom = 'auto';
            pad.style.left = saved.x + 'px';
            pad.style.top = saved.y + 'px';
        }
    }
    function show(el) {
        if (hideTO && hideEl === el) { clearTimeout(hideTO); hideTO = null; hideEl = null; }
        target = el;
        markEditing(el);
        buf = String(el.value === undefined ? '' : el.value);
        ensureFieldVisible(el);
        if (!pad.parentNode) document.body.appendChild(pad);
        applySavedPosition();
        pad.style.display = 'block';
        themePad();
        if (pad.offsetHeight) PADH = pad.offsetHeight;
        if (bottomSpacer) bottomSpacer.style.height = (PADH + 48) + 'px';
    }
    function fireEvents(el) {
        el = el || target;
        if (!el) return;
        try {
            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch {}
    }
    function hide(commit, el) {
        stopHold();
        const t = el || target;
        if (t === target) { target = null; buf = ''; markEditing(null); }
        if (commit && t) {
            let num = parseFloat(t.value);
            if (!isFinite(num)) num = 0;
            const mn = t.getAttribute('min'), mx = t.getAttribute('max');
            if (mn !== null && mn !== '') num = Math.max(parseFloat(mn), num);
            if (mx !== null && mx !== '') num = Math.min(parseFloat(mx), num);
            t.value = String(num);
            fireEvents(t);
        }
        try { if (t) t.blur(); } catch {}
        if (!target) pad.style.display = 'none';
        if (hideEl === t) { clearTimeout(hideTO); hideTO = null; hideEl = null; }
    }

    function stepFor() {
        const attr = target.getAttribute ? target.getAttribute('step') : null;
        if (attr) {
            const s = parseFloat(attr);
            if (!isNaN(s) && s > 0) return { v: s, dec: (attr.split('.')[1] || '').length };
        }
        let cur = parseFloat(buf);
        if (!isFinite(cur)) cur = parseFloat(target.value);
        return (isFinite(cur) && Math.abs(cur % 1) > 1e-9)
            ? { v: 0.1, dec: 1 } : { v: 1, dec: 0 };
    }
    function nudge(dir) {
        if (!target) return;
        const st = stepFor();
        let num = parseFloat(buf);
        if (!isFinite(num)) num = 0;
        num += dir * st.v;
        const mn = target.getAttribute('min'), mx = target.getAttribute('max');
        if (mn !== null && mn !== '' && !isNaN(parseFloat(mn))) num = Math.max(parseFloat(mn), num);
        if (mx !== null && mx !== '' && !isNaN(parseFloat(mx))) num = Math.min(parseFloat(mx), num);
        num = parseFloat(num.toFixed(Math.min(st.dec, 2)));
        buf = String(num);
        target.value = buf;
        fireEvents();
    }
    function press(k) {
        if (!target) return;
        if (k === 'UP')   { nudge(1);  return; }
        if (k === 'DOWN') { nudge(-1); return; }
        if (k === 'BKSP') buf = '';
        else if (k === 'DONE') { hide(true); return; }
        else if (k === '.') { if (!buf.includes('.')) buf += '.'; }
        else buf += k;
        if (buf === '-' || buf === '' || !isFinite(parseFloat(buf))) {
            if (buf === '') target.value = '';
        } else {
            target.value = buf;
        }
    }

    let holdTO = null, holdIV = null;
    function stopHold() {
        clearTimeout(holdTO); holdTO = null;
        clearInterval(holdIV); holdIV = null;
    }
    function holding() { return !!(holdTO || holdIV); }

    pad.addEventListener('pointerdown', e => e.preventDefault());
    pad.addEventListener('pointerdown', e => {
        const b = e.target.closest('button[data-k]');
        if (!b) return;
        const k = b.dataset.k;
        if (k === 'UP' || k === 'DOWN') {
            press(k);
            stopHold();
            holdTO = setTimeout(() => {
                holdIV = setInterval(() => press(k), 110);
            }, 420);
        }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
        pad.addEventListener(ev, () => { if (holding()) stopHold(); }));
    window.addEventListener('pointerup', () => { if (holding()) stopHold(); });

    pad.addEventListener('click', e => {
        const b = e.target.closest('button[data-k]');
        if (!b) return;
        const k = b.dataset.k;
        if (k === 'UP' || k === 'DOWN') return;
        press(k);
    });

    /* ---- drag handle: reposition the pad anywhere on screen ---- */
    const handle = pad.querySelector('[data-drag]');
    let drag = null;
    handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        const r = pad.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        pad.classList.add('rfnp-dragging');
        pad.style.right = 'auto';
        pad.style.bottom = 'auto';
        pad.style.left = r.left + 'px';
        pad.style.top = r.top + 'px';
        try { handle.setPointerCapture(e.pointerId); } catch {}
    });
    handle.addEventListener('pointermove', e => {
        if (!drag) return;
        let x = e.clientX - drag.dx, y = e.clientY - drag.dy;
        x = Math.max(0, Math.min(window.innerWidth - 40, x));
        y = Math.max(0, Math.min(window.innerHeight - 40, y));
        pad.style.left = x + 'px';
        pad.style.top = y + 'px';
    });
    const endDrag = () => {
        if (!drag) return;
        drag = null;
        pad.classList.remove('rfnp-dragging');
        try { config.set('numericPadPos', { x: parseInt(pad.style.left) || 0, y: parseInt(pad.style.top) || 0 }); } catch {}
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    document.addEventListener('pointerdown', (e) => {
        const el = e.target;
        if (pad.contains(el)) return;
        if (el instanceof HTMLInputElement && el.matches(SELECTOR)) {
            if (!el.disabled) {
                e.preventDefault();
                openPad(el);
            }
        } else if (target) {
            hide(true);
        }
    }, true);
    document.addEventListener('focusout', (e) => {
        const el = e.target;
        if (el && el === target) {
            if (el.hasAttribute('readonly')) return;
            hideEl = el; hideTO = setTimeout(() => { hide(true, el); }, 120);
        }
    });

    function openPad(el) {
        if (!el || el.disabled) return;
        makePadField(el);
        show(el);
    }

    globalThis.__rfOpenNumericPad = openPad;
    document.addEventListener('click', (e) => {
        const el = e.target;
        if (pad.contains(el) || !target) return;
        if (el instanceof HTMLInputElement && el.matches(SELECTOR)) return;
        if (el && el.querySelector && el.querySelector(SELECTOR)) return;
        hide(true);
    }, true);

    const makePadField = (el) => {
        el.setAttribute('inputmode', 'none');
        el.setAttribute('readonly', '');
    };
    const tag = (root) => root.querySelectorAll && root.querySelectorAll(SELECTOR)
        .forEach(i => makePadField(i));
    const start = () => {
        tag(document);
        try {
            new MutationObserver(muts => muts.forEach(m =>
                m.addedNodes && m.addedNodes.forEach(n => {
                    if (n.nodeType === 1) { if (n.matches && n.matches(SELECTOR)) makePadField(n); tag(n); }
                })
            )).observe(document.body, { childList: true, subtree: true });
        } catch {}
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    ensureBottomSpace();

    const css = document.createElement('style');
    css.textContent = [
        '#rf-numpad{position:fixed;right:8px;bottom:8px;z-index:2147483647;',
        'display:none;border:1px solid #555;border-radius:12px;padding:10px;max-width:min(92vw,340px);',
        'box-shadow:0 6px 24px rgba(0,0,0,.45);touch-action:manipulation;}',
        '#rf-numpad.rfnp-dragging{opacity:.85;}',
        '#rf-numpad .rfnp-handle{height:18px;margin:-4px -4px 6px;display:flex;align-items:center;justify-content:center;',
        'cursor:grab;color:#888;font-size:14px;letter-spacing:3px;user-select:none;',
        'border-radius:8px 8px 0 0;background:rgba(128,128,128,.18);touch-action:none;}',
        '#rf-numpad .rfnp-handle:active{cursor:grabbing;background:rgba(128,128,128,.35);}',
        '#rf-numpad .rfnp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}',
        '#rf-numpad button{min-width:64px;height:46px;font-size:20px;font-family:inherit;',
        'border:none;border-radius:8px;background:rgba(128,128,128,.22);cursor:pointer;user-select:none;}',
        '#rf-numpad button:active{background:rgba(128,128,128,.45);}',
        '#rf-numpad button[data-k="DONE"]{grid-column:auto;color:#fff;font-weight:bold;}',
        '.rf-editing{border-color:var(--accent,hsl(202,100%,45%))!important;background:#cfe5ff!important;color:#000!important;}',
        'input[type="number"].rf-editing::-webkit-inner-spin-button,',
        'input[type="number"].rf-editing::-webkit-outer-spin-button{ -webkit-appearance:none;margin:0; }'
    ].join('');
    (document.head || document.documentElement).appendChild(css);
}
