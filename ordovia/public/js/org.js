/* Ordovia organisation: areas (departments), status, owners, filters – the things that keep a growing workspace tidy.
 * Also the pages for areas, health, activity and search. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, el, fmtDate, toast, modal, table } = FB.ui;
  const api = FB.api;
  const Org = FB.org = {};

  const areas = () => (FB.state.meta && FB.state.meta.areas) || [];
  const people = () => (FB.state.meta && FB.state.meta.people) || [];
  const areaOf = (id) => areas().find(a => a.id === Number(id));
  Org.areaName = (id) => (areaOf(id) || {}).name || '';
  Org.personName = (id) => (people().find(p => p.id === Number(id)) || {}).name || '';
  Org.chip = (id) => { const a = areaOf(id); return a ? `<span class="chip-area" style="--ac:${esc(a.color || '#4f46e5')}">${esc(a.name)}</span>` : ''; };
  Org.status = (s) => (s && s !== 'active' ? `<span class="status s-${esc(s)}">${esc(s)}</span>` : '');

  /** Group items by area (areas by name, items without an area last). -> [{ area: {id,name,color}|null, items }] */
  Org.group = (items, getArea) => {
    const by = new Map();
    for (const it of items) { const k = getArea(it) || 0; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    const out = areas().filter(a => by.has(a.id)).map(a => ({ area: a, items: by.get(a.id) }));
    if (by.has(0)) out.push({ area: null, items: by.get(0) });
    return out;
  };
  /** Cards grouped under area headings. render(item) -> html of one card. */
  Org.groupedCards = (items, getArea, render, empty) => {
    if (!items.length) return `<p class="muted">${empty || 'Nothing here yet.'}</p>`;
    const groups = Org.group(items, getArea);
    if (groups.length === 1 && !groups[0].area) return `<div class="cards">${items.map(render).join('')}</div>`;
    return groups.map(g => `<section class="area-group"><h2>${g.area ? `<a class="area-link" href="#/area/${g.area.id}">${Org.chip(g.area.id)}</a>` : '<span class="muted">No area</span>'} <span class="count">${g.items.length}</span></h2>
      <div class="cards">${g.items.map(render).join('')}</div></section>`).join('');
  };

  /** A register: one ruled, sortable table (the way lists look in business software). Columns: [{ label, cell(item) -> html, sort(item) -> value, cls }].
   *  `host` keeps its sort between redraws; `opts.href(item)` makes a row clickable; `opts.empty` is shown when there is nothing. Click a heading to sort. */
  Org.register = (host, items, cols, opts) => {
    opts = opts || {};
    const sortState = host._sort || (host._sort = { i: 0, dir: 1 });
    const val = (c, it) => { const v = c.sort ? c.sort(it) : String(c.cell(it)).replace(/<[^>]*>/g, ''); return v == null ? '' : v; };
    const col = cols[sortState.i] || cols[0];
    const rows = items.slice().sort((a, b) => { const x = val(col, a), y = val(col, b); const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }); return r * sortState.dir; });
    if (!rows.length) { host.innerHTML = `<p class="muted register-empty">${opts.empty || 'Nothing here yet.'}</p>`; return; }
    host.innerHTML = `<div class="table-wrap"><table class="grid register"><thead><tr>${cols.map((c, i) => `<th class="${c.cls || ''} sortable ${i === sortState.i ? (sortState.dir > 0 ? 'asc' : 'desc') : ''}" data-col="${i}" aria-sort="${i === sortState.i ? (sortState.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((it, r) => `<tr ${opts.href ? `class="clickable" data-href="${esc(opts.href(it))}"` : ''}>${cols.map(c => `<td class="${c.cls || ''}">${c.cell(it)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="reg-foot small muted">${rows.length} ${rows.length === 1 ? (opts.one || 'item') : (opts.many || 'items')}${opts.total && opts.total !== rows.length ? ` of ${opts.total}` : ''} · <button type="button" class="link-btn" data-csv>Export CSV</button></p>`;
    const csv = $('[data-csv]', host);
    if (csv) csv.onclick = () => {   // what is on screen, as a spreadsheet
      const tmp = document.createElement('div');
      const text = (html) => { tmp.innerHTML = html; return tmp.textContent.replace(/\s+/g, ' ').trim(); };
      const heads = cols.map(c => c.label), named = cols.map((c, i) => (c.label ? i : -1)).filter(i => i >= 0);
      FB.ui.download((opts.csv || 'export') + '.csv', FB.ui.toCSV(named.map(i => heads[i]), rows.map(it => named.map(i => text(String(cols[i].cell(it)))))), 'text/csv');
    };
    $$('th.sortable', host).forEach(th => th.onclick = () => { const i = Number(th.dataset.col); sortState.dir = sortState.i === i ? -sortState.dir : 1; sortState.i = i; Org.register(host, items, cols, opts); if (opts.after) opts.after(); });
    if (opts.href) $$('tbody tr[data-href]', host).forEach(tr => tr.onclick = (e) => { if (e.target.closest('a, button, input, select')) return; location.hash = tr.dataset.href; });
  };
  /** Cells that registers share. */
  Org.cell = {
    areaChip: (it) => (it.area_id ? Org.chip(it.area_id) : '<span class="muted">–</span>'),
    person: (it) => esc(it.owner || (it.owner_id ? Org.personName(it.owner_id) : '') || '–'),
    review: (it) => (it.reviewDue ? `<span class="${it.overdue ? 'warn-text' : ''}">${esc(String(it.reviewDue).slice(0, 10))}${it.overdue ? ' · overdue' : ''}</span>` : '<span class="muted">–</span>'),
  };

  /** A filter bar (search, area, status). `state` = { q, area, status }; calls onChange() when it changes. */
  Org.filters = (host, state, opts, onChange) => {
    opts = opts || {};
    const stat = opts.status ? `<select data-f="status" aria-label="Status"><option value="live">Draft + active</option><option value="active">Active only</option><option value="draft">Drafts</option><option value="archived">Archived</option></select>` : '';
    host.innerHTML = `<div class="filters"><input type="search" data-f="q" placeholder="${esc(opts.placeholder || 'Search…')}" value="${esc(state.q || '')}">
      <select data-f="area" aria-label="Area"><option value="">All areas</option>${areas().map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}<option value="none">No area</option></select>${stat}</div>`;
    const set = (k, v) => { const i = $(`[data-f="${k}"]`, host); if (i) i.value = v; };
    set('area', state.area || ''); set('status', state.status || 'live');
    $$('[data-f]', host).forEach(i => { i.oninput = i.onchange = () => { state[i.dataset.f] = i.value; onChange(); }; });
  };
  Org.match = (it, state, text) => {
    if (state.area === 'none' ? it.area_id : (state.area && Number(state.area) !== it.area_id)) return false;
    const st = state.status || 'live';
    if (it.status && ((st === 'live' && it.status === 'archived') || (st === 'active' && it.status !== 'active') || (st === 'draft' && it.status !== 'draft') || (st === 'archived' && it.status !== 'archived'))) return false;
    return !state.q || String(text).toLowerCase().includes(state.q.toLowerCase());
  };

  /** The "organise" box in the builders: area, owner, status (and review cycle for processes). Edits `obj` in place. */
  Org.bar = (host, obj, opts, touch) => {
    opts = opts || {};
    host.innerHTML = `<div class="org-bar">
      <label>Area<select data-o="area_id"><option value="">– none –</option>${areas().map(a => `<option value="${a.id}" ${Number(obj.area_id) === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <label>Owner<select data-o="owner_id"><option value="">– nobody –</option>${people().map(p => `<option value="${p.id}" ${Number(obj.owner_id) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Status<select data-o="status">${['draft', 'active', 'archived'].map(s => `<option ${obj.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      ${opts.review ? `<label>Review every<span class="inline-unit"><input type="number" min="0" max="60" data-o="review_months" value="${Number(obj.review_months ?? 12)}"> months</span></label>` : ''}</div>`;
    $$('[data-o]', host).forEach(i => i.onchange = () => {
      const k = i.dataset.o;
      obj[k] = k === 'status' ? i.value : (i.value === '' ? null : Number(i.value));
      touch && touch();
    });
  };

  const startFlow = async (id, btn, subject) => {
    if (btn) btn.disabled = true;
    try { const r = await api.post(`/flows/${id}/start`, subject ? { subject } : undefined); toast('Process started', 'ok'); FB.refreshBadge && FB.refreshBadge(); FB.go(r.taskId ? '#/task/' + r.taskId : '#/processes/' + r.instanceId); }
    catch (e) { toast(e.message, 'error'); if (btn) btn.disabled = false; }
  };
  Org.startFlow = startFlow;
  /** Start a process: if it has a request form, ask for that first (the same input the API and the public web form take). */
  Org.start = async (flow, btn, subject) => {
    // a process that works on an object (a machine, a vehicle...) first needs to know which one
    if (flow.subject_form_id && !subject) {
      const cls = FB.state.meta.forms.find(f => f.id === Number(flow.subject_form_id));
      const list = (await api.get('/objects/' + Number(flow.subject_form_id))).objects;
      const box = document.createElement('div');
      const m = modal(flow.name, box);
      box.innerHTML = list.length ? `<form><label>Which ${esc((cls ? cls.name : 'object').toLowerCase())}?<select name="subject" required><option value="">– choose –</option>${list.map(o => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label><div class="form-actions"><button class="btn primary">Continue</button></div></form>` : `<p class="muted">There are no ${esc((cls ? cls.name : 'object').toLowerCase())} objects yet. <a href="#/objects/${Number(flow.subject_form_id)}">Add one first.</a></p>`;
      const fm = $('form', box); if (fm) fm.onsubmit = (e) => { e.preventDefault(); m.close(); Org.start(flow, btn, Number(fm.subject.value)); };
      return;
    }
    const form = flow.form_id ? FB.state.meta.forms.find(f => f.id === Number(flow.form_id)) : null;
    if (!form) {   // no request form: starting makes a case and gives you the first step, so ask first (no empty cases by accident)
      const m = modal(flow.name, `<p>${esc(flow.description || '')}</p><p class="muted">Starting creates a new case and takes you to the first step.</p><div class="form-actions"><button type="button" class="btn ghost" id="stNo">Cancel</button><button type="button" class="btn primary" id="stYes">Start</button></div>`);
      $('#stNo', m.root).onclick = m.close;
      $('#stYes', m.root).onclick = () => { m.close(); startFlow(flow.id, btn, subject); };
      return;
    }
    const box = document.createElement('div');
    const m = modal(flow.name, box, { wide: true });
    FB.forms.open(box, form, { context: { initiator: FB.profileOf(FB.state.user.id) }, submitLabel: 'Submit request', onCancel: m.close,
      onSubmit: async (data) => { const r = await api.post(`/flows/${flow.id}/start`, { data, subject }); m.close(); toast('Request sent', 'ok'); FB.refreshBadge && FB.refreshBadge(); FB.go(r.taskId ? '#/task/' + r.taskId : '#/processes/' + r.instanceId); } });
  };

  // ---------------------------------------------------------------- areas
  FB.route('/areas', async (main) => {
    const list = await api.get('/areas');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Areas</h1><p class="muted">Every department or domain, with the processes, forms and dashboards it offers to the rest of the company.</p></div>
      ${FB.isAdmin() ? '<div class="actions"><a class="btn" href="#/admin/areas">Manage areas</a></div>' : ''}</div>
      <div class="cards">${list.map(a => `<a class="card link-card area-card" href="#/area/${a.id}" style="--ac:${esc(a.color || '#4f46e5')}"><h3>${esc(a.name)}</h3><p class="small">${esc(a.description || '')}</p>
        <p class="muted small">${a.owner ? 'Owner: ' + esc(a.owner) + ' · ' : ''}${a.flows} process${a.flows === 1 ? '' : 'es'} · ${a.forms} form${a.forms === 1 ? '' : 's'} · ${a.documents || 0} document${a.documents === 1 ? '' : 's'} · ${a.dashboards} dashboard${a.dashboards === 1 ? '' : 's'}</p></a>`).join('') ||
        `<div class="empty-state card"><p>No areas yet.</p>${FB.isAdmin() ? '<p><a class="btn primary" href="#/admin/areas">Create the first area</a></p>' : ''}</div>`}</div></div>`;
  });

  FB.route('/area/:id', async (main, { id }) => {
    const aid = Number(id), a = areaOf(aid);
    if (!a) { main.innerHTML = '<div class="page"><h1>Not found</h1><p class="muted">This area does not exist.</p></div>'; return; }
    const [hb, home, dash, docs] = await Promise.all([api.get('/handbook'), api.get('/home'), api.get('/dashboards'), api.get('/documents')]);
    const startable = new Map(home.flows.map(f => [f.id, f]));
    const areaDocs = docs.filter(d => d.area_id === aid && d.status !== 'archived');
    const flows = hb.filter(f => f.area_id === aid), forms = FB.state.meta.forms.filter(f => f.area_id === aid && f.status !== 'archived'), dashes = dash.filter(d => d.area_id === aid);
    main.innerHTML = `<div class="page"><div class="page-head"><div><a class="crumb" href="#/areas">← Areas</a><h1><span class="dot" style="background:${esc(a.color || '#4f46e5')}"></span> ${esc(a.name)}</h1>
      <p class="muted">${esc(a.description || '')}${a.owner_id ? ` · owner ${esc(Org.personName(a.owner_id))}` : ''}</p></div></div>
      <section><h2>Request something from ${esc(a.name)} <span class="count">${flows.length}</span></h2><div class="cards">${flows.map(f => `<div class="card link-card"><a href="#/handbook/${f.id}"><h3>${esc(f.name)} ${Org.status(f.status)}</h3></a>
        <p class="small">${esc(f.doc.purpose || f.description || '')}</p><p class="muted small">${f.owner ? 'Owner: ' + esc(f.owner) + ' · ' : ''}v${f.version}${f.overdue ? ' · <span class="warn-text">review due</span>' : ''}</p>
        <div class="row-actions">${startable.has(f.id) ? `<button class="btn small primary" data-start="${f.id}">Start</button>` : ''}<a class="btn small" href="#/handbook/${f.id}">How it works</a></div></div>`).join('') || '<p class="muted">No processes in this area yet.</p>'}</div></section>
      <section><h2>Data <span class="count">${forms.length}</span></h2><div class="cards">${forms.map(f => `<a class="card link-card" href="#/data/${f.id}"><h3>${esc(f.name)}</h3><p class="small">${esc(f.description || '')}</p></a>`).join('') || '<p class="muted">No forms in this area.</p>'}</div></section>
      <section><h2>Documents <span class="count">${areaDocs.length}</span></h2>${areaDocs.length ? FB.org.docLinks(areaDocs) : '<p class="muted">No documents in this area.</p>'}</section>
      <section><h2>Dashboards <span class="count">${dashes.length}</span></h2><div class="cards">${dashes.map(d => `<a class="card link-card" href="#/dashboards/${d.id}"><h3>${esc(d.name)}</h3><p class="muted small">${d.widgets} widget${d.widgets === 1 ? '' : 's'}</p></a>`).join('') || '<p class="muted">No dashboards in this area.</p>'}</div></section></div>`;
    $$('[data-start]', main).forEach(b => b.onclick = () => Org.start(startable.get(Number(b.dataset.start)), b));
  });

  FB.route('/admin/areas', async (main) => {
    const list = await api.get('/areas');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Areas</h1><p class="muted">Areas are how everything is grouped: one per department or domain. Give each an owner. Processes, forms and dashboards each belong to one area.</p></div><div class="actions"><button class="btn primary" id="naBtn">+ New area</button></div></div>
      ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Area</th><th>Owner</th><th>Processes</th><th>Forms</th><th>Dashboards</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr><td><a href="#/area/${a.id}">${Org.chip(a.id)}</a> <span class="muted small">${esc(a.description || '')}</span></td><td>${esc(a.owner || '–')}</td><td>${a.flows}</td><td>${a.forms}</td><td>${a.dashboards}</td>
        <td><button class="btn small" data-edit="${a.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state card"><p>No areas yet. Start with your departments, e.g. Finance, HR, Sales, Operations.</p><p><button class="btn primary" id="arStarter">Create starter areas</button></p></div>'}</div>`;
    const st = $('#arStarter', main); if (st) st.onclick = async () => { await api.post('/admin/areas/starter'); await FB.loadMeta(); FB.render(); };
    const edit = (a) => {
      a = a || { name: '', description: '', color: '#4f46e5', owner_id: null };
      const m = modal(a.id ? 'Edit area' : 'New area', `<form id="arf"><label>Name<input name="name" required value="${esc(a.name)}" placeholder="e.g. Finance"></label>
        <label>Description<input name="description" value="${esc(a.description || '')}" placeholder="What does this department or domain offer the company?"></label>
        <div class="row2"><label>Owner<select name="owner_id"><option value="">– nobody –</option>${people().map(p => `<option value="${p.id}" ${Number(a.owner_id) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Colour<input type="color" name="color" value="${esc(a.color || '#4f46e5')}"></label></div>
        <div class="form-actions">${a.id ? '<button type="button" class="btn danger ghost" id="arDel">Delete</button>' : ''}<button class="btn primary">Save</button></div></form>`);
      const f = $('#arf', m.root);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const body = { name: f.name.value, description: f.description.value, color: f.color.value, owner_id: f.owner_id.value || null };
        try { if (a.id) await api.put('/admin/areas/' + a.id, body); else await api.post('/admin/areas', body); m.close(); await FB.loadMeta(); FB.render(); } catch (err) { toast(err.message, 'error'); }
      };
      const d = $('#arDel', m.root);
      if (d) d.onclick = async () => { if (confirm('Delete this area? Its processes, forms and dashboards stay, but are then in no area.')) { await api.del('/admin/areas/' + a.id); m.close(); await FB.loadMeta(); FB.render(); } };
    };
    $('#naBtn', main).onclick = () => edit(null);
    $$('[data-edit]', main).forEach(b => b.onclick = () => edit(list.find(x => x.id === Number(b.dataset.edit))));
  }, { admin: true });

  // ---------------------------------------------------------------- health
  const ICON = { error: '⛔', warn: '⚠', info: 'ℹ' };
  FB.route('/admin/health', async (main) => {
    const h = await api.get('/admin/health');
    FB.state.health = { counts: h.counts, at: Date.now() };
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Health</h1><p class="muted">What needs attention in this workspace – checked just now. Fix the red ones first.</p></div></div>
      <div class="health-counts"><span class="hc e">${h.counts.error} problem${h.counts.error === 1 ? '' : 's'}</span><span class="hc w">${h.counts.warn} warning${h.counts.warn === 1 ? '' : 's'}</span><span class="hc i">${h.counts.info} tip${h.counts.info === 1 ? '' : 's'}</span></div>
      ${h.items.length ? `<ul class="health">${h.items.map(i => `<li class="lv-${i.level}"><span class="hi">${ICON[i.level]}</span><div><b>${esc(i.title)}</b>${i.detail ? `<div class="muted small">${esc(i.detail)}</div>` : ''}</div>${i.entity && areas().length ? `<select class="fix-area" data-entity="${i.entity}" data-id="${i.id}" aria-label="Put in an area"><option value="">Put in area…</option>${areas().map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>` : ''}${i.link ? `<a class="btn small" href="${esc(i.link)}">Open</a>` : ''}</li>`).join('')}</ul>`
        : '<div class="empty-state card"><p>✓ Everything is in order.</p></div>'}</div>`;
    $$('.fix-area', main).forEach(sel => sel.onchange = async () => { if (!sel.value) return; try { await api.post('/admin/assign-area', { entity: sel.dataset.entity, id: Number(sel.dataset.id), area_id: Number(sel.value) }); await FB.loadMeta(); FB.state.health = null; FB.render(); } catch (e) { toast(e.message, 'error'); } });
    FB.shell((location.hash || '#/').slice(1).split('?')[0]);
  }, { admin: true });

  /** Fetch the health counts for the sidebar badge (not more often than every 3 minutes). */
  FB.loadHealthCount = async () => {
    if (!FB.isAdmin()) return;
    const cur = FB.state.health;
    if (cur && Date.now() - cur.at < 180000) return;
    try { const h = await api.get('/admin/health'); FB.state.health = { counts: h.counts, at: Date.now() }; FB.shell((location.hash || '#/').slice(1).split('?')[0] || '/'); } catch (e) { /* ignore */ }
  };

  // ---------------------------------------------------------------- activity (audit log)
  FB.route('/admin/activity', async (main) => {
    const ent = FB.query().get('entity') || '';
    const rows = await api.get('/admin/audit' + (ent ? '?entity=' + encodeURIComponent(ent) : ''));
    const kinds = ['process', 'form', 'dashboard', 'area', 'person', 'tag', 'settings', 'sql', 'record', 'run'];
    main.innerHTML = `<div class="page page-wide"><div class="page-head"><div><h1>Activity</h1><p class="muted">Who changed what, and when. Newest first.</p></div>
      <div class="actions"><select id="aeFilter"><option value="">Everything</option>${kinds.map(k => `<option value="${k}" ${k === ent ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
      ${rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Detail</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="nowrap">${esc(fmtDate(r.at))}</td><td>${esc(r.who || '–')}</td><td>${esc(r.action)} ${esc(r.entity)}</td><td>${esc(r.name || '')}</td><td class="muted small">${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty-state card"><p>No changes recorded yet.</p></div>'}</div>`;
    $('#aeFilter', main).onchange = (e) => FB.go('#/admin/activity' + (e.target.value ? '?entity=' + e.target.value : ''));
  }, { admin: true });

  // ---------------------------------------------------------------- search
  FB.route('/search', async (main) => {
    const q = (FB.query().get('q') || '').trim();
    const box = $('#searchBox'); if (box && box.value !== q) box.value = q;
    const r = q.length >= 2 ? await api.get('/search?q=' + encodeURIComponent(q)) : { results: [] };
    const types = [...new Set(r.results.map(x => x.type))];
    main.innerHTML = `<div class="page"><div class="page-head"><h1>Search</h1></div>
      ${q.length < 2 ? '<p class="muted">Type at least two letters in the search box above.</p>' : !r.results.length ? `<div class="empty-state card"><p>Nothing found for “${esc(q)}”.</p></div>`
        : types.map(t => `<section><h2>${esc(t)} <span class="count">${r.results.filter(x => x.type === t).length}</span></h2><div class="results">${r.results.filter(x => x.type === t).map(x =>
          `<${x.link ? `a href="${esc(x.link)}"` : 'div'} class="card result"><b>${esc(x.title)}</b><span class="muted small">${esc(x.sub)}</span></${x.link ? 'a' : 'div'}>`).join('')}</div></section>`).join('')}</div>`;
  });

  // ---------------------------------------------------------------- public web form (no sign-in)
  FB.route('/request/:token', async (main, { token }) => {
    let d;
    try { d = await api.get('/public/request/' + encodeURIComponent(token)); }
    catch (e) { main.innerHTML = `<div class="public-wrap"><div class="card public-card"><h1>Form not available</h1><p class="muted">${esc(e.message)}</p></div></div>`; return; }
    document.title = d.process + ' · ' + d.company;
    main.innerHTML = `<div class="public-wrap"><div class="card public-card"><div class="muted small">${esc(d.company)}</div><h1>${esc(d.process)}</h1><p class="muted">${esc(d.description || d.form.description || '')}</p>
      <div class="row2"><label>Your name<input id="rqName" autocomplete="name"></label><label>Your e-mail<input id="rqMail" type="email" autocomplete="email"></label></div>
      <input id="rqWeb" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
      <div id="rqForm"></div><p class="muted small powered">Powered by Ordovia</p></div></div>`;
    FB.forms.render($('#rqForm', main), d.form, { context: {}, submitLabel: 'Send request',
      onSubmit: async (data) => {
        const r = await api.post('/public/request/' + encodeURIComponent(token), { data, website: $('#rqWeb', main).value, requester: { name: $('#rqName', main).value, email: $('#rqMail', main).value } });
        main.innerHTML = `<div class="public-wrap"><div class="card public-card center"><h1>Thank you</h1><p>Your request has been received.</p><p class="muted">Reference <b>${esc(r.reference)}</b></p></div></div>`;
      } });
  }, { public: true });

  // ---------------------------------------------------------------- API: tokens and how to use them
  FB.route('/admin/api', async (main) => {
    const [tokens, procs, flows] = await Promise.all([api.get('/admin/tokens'), api.get('/v1/processes'), api.get('/admin/flows')]);
    const origin = location.origin, ex = procs.find(p => p.input) || procs[0];
    const sample = ex ? JSON.stringify({ data: Object.fromEntries(((ex.input && ex.input.fields) || []).slice(0, 3).map(f => [f.key, f.type === 'number' ? 1 : 'text'])), reference: 'MY-ORDER-1' }) : '{}';
    const pubs = flows.filter(f => f.publicToken && f.status === 'active');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>API &amp; web forms</h1><p class="muted">Ordovia is the interface between departments and systems: a process is a service with a defined input (its request form) and a status you can follow. Other tools – your ERP, a website, Outlook flows, Teams – start and follow processes here, instead of e-mail.</p></div>
      <div class="actions"><button class="btn primary" id="tkNew">+ New API token</button></div></div>
      <h2>API tokens</h2>
      ${tokens.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Acts as</th><th>Token</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>
      ${tokens.map(t => `<tr class="${t.revoked_at ? 'inactive' : ''}"><td>${esc(t.name)}</td><td>${esc(t.person)}</td><td><code>${esc(t.token_hint || '')}</code></td><td>${esc(fmtDate(t.created_at))}</td><td>${esc(fmtDate(t.last_used_at) || 'never')}</td><td>${t.revoked_at ? '<span class="muted">revoked</span>' : `<button class="btn small danger ghost" data-revoke="${t.id}">Revoke</button>`}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No tokens yet. A token lets one system call Ordovia <b>as a chosen person</b>, with exactly that person\'s rights: create a person for the system (e.g. “ERP”) and give it only the tags it needs.</p>'}
      <h2>Quick start</h2><div class="card"><p class="small muted">Send the token as <code>Authorization: Bearer ord_…</code>. All data is JSON.</p>
      <pre class="code small">${esc(`# which processes may I start, and what do they need as input?
curl ${origin}/api/v1/processes -H "Authorization: Bearer ord_…"

# start one (data = the request form's fields; reference = your own number; callbackUrl = where to report back, optional)
curl -X POST ${origin}/api/v1/processes/${ex ? ex.id : 1}/start -H "Authorization: Bearer ord_…" -H "Content-Type: application/json" \\
  -d '${sample.replace(/}$/, ', "callbackUrl": "https://example.com/hooks/ordovia"}')}'

# follow it: status, outcome, outputs and tasks (by id, or find yours by reference)
curl ${origin}/api/v1/runs/123 -H "Authorization: Bearer ord_…"
curl "${origin}/api/v1/runs?reference=MY-ORDER-1" -H "Authorization: Bearer ord_…"

# data: list forms, read and add records
curl ${origin}/api/v1/forms -H "Authorization: Bearer ord_…"
curl ${origin}/api/v1/forms/supplier/records -H "Authorization: Bearer ord_…"`)}</pre>
      <p class="small"><b>Callbacks.</b> With <code>callbackUrl</code> (https) Ordovia posts <code>{"event":"run.finished"|"run.stuck","run":{…},"outputs":{…}}</code> when the run ends. <b>Outgoing:</b> a Webhook step in a flow calls any system during a process.</p></div>
      <h2>Microsoft: Power Automate, Power Apps, Logic Apps, Teams</h2><div class="card">
        <p><b>Use Ordovia as a connector.</b> Ordovia describes its API in a standard file, so Microsoft tools get ready-made actions: <i>Start a process</i>, <i>Get a run</i>, <i>List runs</i>, <i>Add a record</i>.</p>
        <ol class="small steps-list">
          <li>Create an API token above (for a person made for this purpose, such as “Power Automate”).</li>
          <li>In Power Automate choose <i>Data › Custom connectors › New custom connector › Import an OpenAPI file</i> and use <input readonly class="mono link-input inline-link" value="${esc(origin + '/api/v1/openapi.json')}"> (download it from that address and upload it).</li>
          <li>Security: choose <i>API Key</i>, parameter label <code>Authorization</code>, location <i>Header</i>. When you create a connection, type <code>Bearer ord_…</code> (the word Bearer, a space, the token).</li>
          <li>Build flows: <i>when an e-mail arrives in Outlook → Start a process</i>, or <i>when a SharePoint item is created → Start a process</i>.</li>
          <li>To have Power Automate hear back when a run finishes, start the flow with <i>When an HTTP request is received</i>, and pass its address as <code>callbackUrl</code>.</li>
        </ol>
        <p><b>Do things in Microsoft 365 (nothing to install).</b> Add a <i>Webhook</i> step to a process, or tick <i>Send a notification</i> on an End step, and paste the address of a Power Automate flow that starts with <i>When an HTTP request is received</i>. That flow can then create a SharePoint item, send an Outlook e-mail, add a calendar event, post in Teams, update an Excel table or create a Planner task. Ordovia sends the case data as JSON, so the flow can use it directly.</p>
        <p><b>Teams.</b> In Teams make a workflow “Post to a channel when a webhook request is received”, copy its address into <i>Settings › Notification webhook</i> and choose the format <i>Microsoft Teams card</i>. Every new and overdue task is then announced in the channel.</p></div>
      <h2>Processes you can call <span class="count">${procs.length}</span></h2>
      ${procs.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Process</th><th>Area</th><th>Input (request form)</th><th>Start</th></tr></thead><tbody>${procs.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.area || '–')}</td><td class="small">${p.input ? p.input.fields.map(f => `<code>${esc(f.key)}</code>${f.required ? '*' : ''} <span class="muted">${esc(f.type)}</span>`).join(' · ') : '<span class="muted">none – starts without input</span>'}</td><td><code>POST /api/v1/processes/${p.id}/start</code></td></tr>`).join('')}</tbody></table></div><p class="small muted">* required</p>` : '<p class="muted">No active processes yet.</p>'}
      <h2>Public web forms <span class="count">${pubs.length}</span></h2>
      ${pubs.length ? `<div class="table-wrap"><table class="grid"><tbody>${pubs.map(f => `<tr><td><b>${esc(f.name)}</b></td><td><input readonly class="mono link-input" value="${esc(origin + '/#/request/' + f.publicToken)}"></td><td><a class="btn small" target="_blank" rel="noopener" href="/#/request/${esc(f.publicToken)}">Open</a></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">None. Open a flow, click on the white canvas, choose a request form and tick “Public web form”: anyone with the link can then send the request without signing in – ideal for other departments, customers or suppliers.</p>'}</div>`;
    $$('[data-revoke]', main).forEach(b => b.onclick = async () => { if (confirm('Revoke this token? Systems using it stop working immediately.')) { await api.del('/admin/tokens/' + b.dataset.revoke); FB.render(); } });
    $$('.link-input', main).forEach(i => i.onclick = () => i.select());
    $('#tkNew', main).onclick = () => {
      const m = modal('New API token', `<form id="tkf"><label>Name <small class="muted">(the system that will use it)</small><input name="name" required placeholder="e.g. ERP, website, Outlook flow"></label>
        <label>Acts as<select name="person_id" required><option value="">– choose a person –</option>${people().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <p class="hint">The token has exactly this person's rights. Best practice: create a person for the system (People &amp; tags) and give it only the tags it needs – not an administrator.</p>
        <div class="form-actions"><button class="btn primary">Create token</button></div></form>`);
      $('#tkf', m.root).onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api.post('/admin/tokens', { name: e.target.name.value, person_id: Number(e.target.person_id.value) });
          m.body.innerHTML = `<p><b>Copy this token now.</b> It is shown only once; Ordovia keeps just a fingerprint.</p><input readonly class="mono link-input" id="tkVal" value="${esc(r.token)}"><div class="form-actions"><button class="btn" id="tkCopy">Copy</button><button class="btn primary" id="tkDone">Done</button></div>`;
          $('#tkVal', m.body).select();
          $('#tkCopy', m.body).onclick = () => navigator.clipboard.writeText(r.token).then(() => toast('Copied', 'ok'));
          $('#tkDone', m.body).onclick = () => { m.close(); FB.render(); };
        } catch (err) { toast(err.message, 'error'); }
      };
    };
  }, { admin: true });
})();
