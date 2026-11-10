/* Ordovia UI helpers, API client, session state and router. */
(function () {
  'use strict';
  const FB = window.FB = window.FB || {};

  // ---------- DOM helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  const json = (s, fb) => { try { return typeof s === 'string' ? JSON.parse(s) : (s ?? fb); } catch (e) { return fb; } };
  const fmtDate = (s) => s ? String(s).slice(0, 16).replace('T', ' ') : '';
  function fmtVal(v) {
    if (v == null || v === '') return '<span class="muted">–</span>';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Array.isArray(v)) return esc(v.join(', '));
    return esc(v);
  }
  /** Plain text with line breaks and **bold** – used for handbook instructions. */
  const richText = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

  function toast(msg, kind) {
    const t = el(`<div class="toast ${kind || ''}">${esc(msg)}</div>`);
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3600);
  }

  function modal(title, body, opts = {}) {
    const m = el(`<div class="modal-backdrop"><div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <header><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">×</button></header>
      <div class="modal-body"></div></div></div>`);
    const b = $('.modal-body', m);
    if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey); opts.onClose && opts.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    $('[data-close]', m).onclick = close;
    document.addEventListener('keydown', onKey);
    document.body.appendChild(m);
    const first = $('input,select,textarea', b); if (first) first.focus();
    return { root: m, body: b, close };
  }

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function toCSV(columns, rows) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [columns.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
  }
  function table(res, opts = {}) {
    if (!res.columns || !res.columns.length) return '<p class="muted">No rows.</p>';
    const max = opts.max || 500;
    return `<div class="table-wrap"><table class="grid"><thead><tr>${res.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${res.values.slice(0, max).map((r, i) => `<tr ${opts.rowAttr ? opts.rowAttr(r, i) : ''}>${r.map(v => `<td>${fmtVal(v)}</td>`).join('')}</tr>`).join('') ||
      `<tr><td colspan="${res.columns.length}" class="muted center">No rows</td></tr>`}</tbody></table></div>
      ${res.values.length > max ? `<p class="muted small">Showing ${max} of ${res.values.length} rows.</p>` : ''}`;
  }
  function multiSelect(name, items, selected, size) {
    const sel = new Set((selected || []).map(String));
    return `<select ${name} multiple size="${size || Math.min(7, Math.max(3, items.length))}">${items.map(i => `<option value="${esc(i.value)}" ${sel.has(String(i.value)) ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</select>`;
  }

  FB.ui = { esc, $, $$, el, json, fmtDate, fmtVal, richText, toast, modal, download, toCSV, table, multiSelect };

  // ---------- API client ----------
  class ApiError extends Error { constructor(status, data) { super(data && data.error || 'Request failed'); this.status = status; this.data = data || {}; } }
  async function call(method, path, body) {
    const opts = { method, headers: { 'x-ordovia': '1' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + path, opts); } catch (e) { throw new ApiError(0, { error: 'Cannot reach the server – check your connection.' }); }
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
    if (res.status === 401 && path !== '/login') { FB.state.user = null; FB.render(); }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }
  FB.api = { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}), del: (p) => call('DELETE', p), ApiError };

  // ---------- state ----------
  FB.state = { user: null, settings: {}, meta: null, setup: false };
  FB.loadMeta = async () => { FB.state.meta = await FB.api.get('/meta'); FB.state.user = FB.state.meta.user; return FB.state.meta; };
  FB.isAdmin = () => !!(FB.state.user && FB.state.user.is_admin);
  FB.tagLabel = (id) => { const t = (FB.state.meta.tags || []).find(x => x.id === Number(id)); return t ? `${t.category}: ${t.value}` : '?'; };
  FB.tagItems = () => FB.state.meta.tags.map(t => ({ value: t.id, label: `${t.category}: ${t.value}` }));
  FB.describeRule = (rule) => {
    rule = rule || {};
    switch (rule.type) {
      case 'initiator': return 'The person who started the process';
      case 'person': { const p = FB.state.meta.people.find(x => x.id === Number(rule.personId)); return p ? p.name : 'Unknown person'; }
      case 'field': return `Person chosen in “${rule.field}”`;
      case 'tags': return (rule.tagIds || []).map(FB.tagLabel).concat((rule.sameAs || []).map(c => `same ${c} as initiator`)).join(' + ') || 'Anyone';
      default: return 'Anyone';
    }
  };
  FB.applyBranding = () => {
    const s = FB.state.settings || {};
    document.title = (s.company && s.company !== 'Ordovia' ? s.company + ' · ' : '') + 'Ordovia';
    if (s.color) document.documentElement.style.setProperty('--primary', s.color); else document.documentElement.style.removeProperty('--primary');
  };

  /** Show server-side errors (422) on a form box. Returns true if handled. */
  FB.showServerErrors = (formEl, err) => {
    if (!(err instanceof ApiError) || err.status !== 422) return false;
    const { errors = {}, formErrors = [] } = err.data;
    for (const [k, msg] of Object.entries(errors)) {
      const box = formEl.querySelector(`.ff[data-key="${k}"]`);
      if (box) { $('.err', box).textContent = msg; box.classList.add('invalid'); }
    }
    const banner = formEl.querySelector('.form-errors');
    if (banner) { banner.innerHTML = formErrors.map(m => `<div>⚠ ${esc(m)}</div>`).join(''); banner.hidden = !formErrors.length; }
    toast(formErrors[0] || 'Please check the highlighted fields.', 'error');
    return true;
  };

  // ---------- router ----------
  const routes = [];
  FB.route = (pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ re, keys, handler, opts });
  };
  FB.go = (hash) => { if (location.hash === hash) FB.render(); else location.hash = hash; };
  FB.query = () => new URLSearchParams(location.hash.split('?')[1] || '');
  FB.cleanup = [];
  FB.pages = FB.pages || {};
  let renderSeq = 0;
  FB.render = async () => {
    const seq = ++renderSeq;
    FB.cleanup.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    FB.cleanup = [];
    const main = $('#main');
    if (!FB.state.user) { document.body.classList.add('logged-out'); FB.pages.login(main); return; }
    document.body.classList.remove('logged-out');
    const path = (location.hash || '#/').slice(1).split('?')[0] || '/';
    const r = routes.map(x => ({ x, m: x.re.exec(path) })).find(o => o.m);
    FB.shell(path);
    if (!r) { main.innerHTML = '<div class="page"><h1>Not found</h1></div>'; return; }
    if (r.x.opts.admin && !FB.isAdmin()) { main.innerHTML = '<div class="page"><h1>No access</h1><p>This part is for administrators.</p></div>'; return; }
    const params = {}; r.x.keys.forEach((k, i) => { params[k] = decodeURIComponent(r.m[i + 1]); });
    // Render into a hidden container inside the page, then reveal it once the data is in.
    main.innerHTML = '<div class="loading-bar" id="loadingBar"></div>';
    const holder = el('<div class="view" hidden></div>');
    main.appendChild(holder);
    try {
      await r.x.handler(holder, params);
      if (seq !== renderSeq) return; // user navigated away meanwhile
      const bar = $('#loadingBar'); if (bar) bar.remove();
      holder.hidden = false;
      window.scrollTo(0, 0);
      (FB.afterRender || []).splice(0).forEach(fn => fn());
    } catch (e) {
      if (seq !== renderSeq) return;
      console.error(e);
      main.innerHTML = `<div class="page"><h1>${e.status === 403 ? 'No access' : e.status === 404 ? 'Not found' : 'Something went wrong'}</h1><p class="error-text">${esc(e.message)}</p></div>`;
    }
    document.body.classList.remove('nav-open');
  };
  /** Run code once the page is attached to the document (e.g. measuring SVG size). */
  FB.whenShown = (fn) => { (FB.afterRender = FB.afterRender || []).push(fn); };
})();
