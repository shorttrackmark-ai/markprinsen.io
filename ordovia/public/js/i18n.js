/* Language: Dutch (default) and English. The app is written in English; in Dutch every piece of text that reaches the screen is looked up here:
   a dictionary of whole sentences, plus patterns where a name or number sits inside ("Hi …" -> "Hoi …").
   Text that is not in the dictionary simply stays English (and is listed in FB.i18n.missing for the developers). Dates and numbers follow the language. */
(function () {
  'use strict';
  const FB = window.FB = window.FB || {};
  const KEY = 'ordovia_lang';
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  let stored = null; try { stored = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  const I = FB.i18n = {
    lang: stored === 'en' ? 'en' : 'nl',
    dict: new Map(), pats: [], missing: new Set(),
    persist(lang) { try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ } },
  };
  FB.locale = () => (I.lang === 'nl' ? 'nl-NL' : 'en-GB');

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Add translations. A key containing {} is a pattern: each {} matches any text and is carried over to the same place in the value. */
  I.add = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = norm(k);
      if (!key.includes('{}')) { I.dict.set(key, v); continue; }
      const parts = key.split('{}');
      let n = 0;
      I.pats.push({ re: new RegExp('^' + parts.map(esc).join('(.+?)') + '$'), to: v.split('{}').reduce((acc, piece, i) => acc + (i ? '$' + (++n) : '') + piece, ''), literal: parts.join('').length });
    }
    I.pats.sort((a, b) => b.literal - a.literal);   // the most specific pattern first
  };

  const pad2 = (n) => String(n).padStart(2, '0');
  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  /** 2026-11-12 20:05 -> 12-11-2026 20:05 */
  I.date = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?Z?)?$/.exec(String(s).trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? ' ' + m[4] : ''}` : null;
  };
  I.monthName = (i) => MONTHS[i];

  /** The Dutch text for a piece of English text, or null when there is none. */
  I.t = (s) => {
    if (I.lang !== 'nl' || s == null) return s == null ? s : s;
    const lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0], core = norm(s);
    if (!core) return s;
    let out = I.dict.get(core);
    if (out === undefined) { const d = I.date(core); if (d) out = d; }
    if (out === undefined) {
      for (const p of I.pats) {
        const m = p.re.exec(core); if (!m) continue;
        // what the pattern captured is translated too when it is a known phrase ("Purchase: Train tickets (€ 5)")
        out = p.to.replace(/\$(\d)/g, (_, i) => { const g = m[Number(i)], d = I.dict.get(norm(g)); return d === undefined ? g : d; });
        break;
      }
    }
    if (out === undefined) { if (/[A-Za-z]{3}/.test(core)) I.missing.add(core); return s; }
    return lead + out + tail;
  };
  FB.t = (s) => { const r = I.t(s); return r == null ? s : r; };

  // ---------------------------------------------------------------- the page
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT', 'SELECT_']);
  const skipEl = (el) => !el || SKIP.has(el.tagName) || (el.closest && el.closest('[data-notranslate], .mono, code, pre, textarea'));
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const doText = (n) => {
    if (n.__nl === n.nodeValue) return;
    const p = n.parentNode; if (!p || skipEl(p)) return;
    const t = I.t(n.nodeValue);
    if (t !== n.nodeValue) { n.__nl = t; n.nodeValue = t; }
  };
  const doAttrs = (el) => {
    if (el.nodeType !== 1 || (el.closest && el.closest('[data-notranslate]'))) return;
    const done = el.__nlA || (el.__nlA = {});
    for (const a of ATTRS) if (el.hasAttribute(a)) {
      const v = el.getAttribute(a);
      if (done[a] === v) continue;   // (our own translation: nothing more to do)
      const t = I.t(v); if (t !== v) { done[a] = t; el.setAttribute(a, t); }
    }
    if (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type) && done.value !== el.value) { const t = I.t(el.value); if (t !== el.value) { done.value = t; el.value = t; } }
  };
  const walk = (root) => {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  };
  I.apply = (root) => { if (I.lang === 'nl') walk(root || document.body); };

  if (I.lang === 'nl') {
    document.documentElement.lang = 'nl';
    const start = () => {
      I.apply(document.body);
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'characterData') doText(m.target);
          else if (m.type === 'attributes') doAttrs(m.target);
          else m.addedNodes.forEach(walk);
        }
        const tt = I.t(document.title); if (tt !== document.title) document.title = tt;
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    // (only once every script, including the dictionary, has loaded)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    // the browser's own dialogs
    for (const f of ['confirm', 'alert']) { const orig = window[f].bind(window); window[f] = (m) => orig(FB.t(String(m))); }
    const op = window.prompt.bind(window); window.prompt = (m, d) => op(FB.t(String(m)), d);
  }

  /** Choose a language for this browser (and for the signed-in person), then start over in it. */
  FB.setLang = async (lang) => {
    I.persist(lang);
    try { if (FB.state && FB.state.user && FB.api) await FB.api.post('/me/language', { lang }); } catch (e) { /* the browser choice still applies */ }
    location.reload();
  };
  /** A signed-in person's own language beats this browser's. */
  FB.syncLang = (user) => { if (user && user.lang && user.lang !== I.lang) { I.persist(user.lang); location.reload(); return true; } return false; };
})();
