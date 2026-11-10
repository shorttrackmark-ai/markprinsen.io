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

  const startFlow = async (id, btn) => {
    if (btn) btn.disabled = true;
    try { const r = await api.post(`/flows/${id}/start`); toast('Process started', 'ok'); FB.refreshBadge && FB.refreshBadge(); FB.go(r.taskId ? '#/task/' + r.taskId : '#/processes/' + r.instanceId); }
    catch (e) { toast(e.message, 'error'); if (btn) btn.disabled = false; }
  };
  Org.startFlow = startFlow;

  // ---------------------------------------------------------------- areas
  FB.route('/areas', async (main) => {
    const list = await api.get('/areas');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Areas</h1><p class="muted">Every department or domain, with the processes, forms and dashboards it offers to the rest of the company.</p></div>
      ${FB.isAdmin() ? '<div class="actions"><a class="btn" href="#/admin/areas">Manage areas</a></div>' : ''}</div>
      <div class="cards">${list.map(a => `<a class="card link-card area-card" href="#/area/${a.id}" style="--ac:${esc(a.color || '#4f46e5')}"><h3>${esc(a.name)}</h3><p class="small">${esc(a.description || '')}</p>
        <p class="muted small">${a.owner ? 'Owner: ' + esc(a.owner) + ' · ' : ''}${a.flows} process${a.flows === 1 ? '' : 'es'} · ${a.forms} form${a.forms === 1 ? '' : 's'} · ${a.dashboards} dashboard${a.dashboards === 1 ? '' : 's'}</p></a>`).join('') ||
        `<div class="empty-state card"><p>No areas yet.</p>${FB.isAdmin() ? '<p><a class="btn primary" href="#/admin/areas">Create the first area</a></p>' : ''}</div>`}</div></div>`;
  });

  FB.route('/area/:id', async (main, { id }) => {
    const aid = Number(id), a = areaOf(aid);
    if (!a) { main.innerHTML = '<div class="page"><h1>Not found</h1><p class="muted">This area does not exist.</p></div>'; return; }
    const [hb, home, dash] = await Promise.all([api.get('/handbook'), api.get('/home'), api.get('/dashboards')]);
    const startable = new Set(home.flows.map(f => f.id));
    const flows = hb.filter(f => f.area_id === aid), forms = FB.state.meta.forms.filter(f => f.area_id === aid && f.status !== 'archived'), dashes = dash.filter(d => d.area_id === aid);
    main.innerHTML = `<div class="page"><div class="page-head"><div><a class="crumb" href="#/areas">← Areas</a><h1><span class="dot" style="background:${esc(a.color || '#4f46e5')}"></span> ${esc(a.name)}</h1>
      <p class="muted">${esc(a.description || '')}${a.owner_id ? ` · owner ${esc(Org.personName(a.owner_id))}` : ''}</p></div></div>
      <section><h2>Request something from ${esc(a.name)} <span class="count">${flows.length}</span></h2><div class="cards">${flows.map(f => `<div class="card link-card"><a href="#/handbook/${f.id}"><h3>${esc(f.name)} ${Org.status(f.status)}</h3></a>
        <p class="small">${esc(f.doc.purpose || f.description || '')}</p><p class="muted small">${f.owner ? 'Owner: ' + esc(f.owner) + ' · ' : ''}v${f.version}${f.overdue ? ' · <span class="warn-text">review due</span>' : ''}</p>
        <div class="row-actions">${startable.has(f.id) ? `<button class="btn small primary" data-start="${f.id}">Start</button>` : ''}<a class="btn small" href="#/handbook/${f.id}">How it works</a></div></div>`).join('') || '<p class="muted">No processes in this area yet.</p>'}</div></section>
      <section><h2>Data <span class="count">${forms.length}</span></h2><div class="cards">${forms.map(f => `<a class="card link-card" href="#/data/${f.id}"><h3>${esc(f.name)}</h3><p class="small">${esc(f.description || '')}</p></a>`).join('') || '<p class="muted">No forms in this area.</p>'}</div></section>
      <section><h2>Dashboards <span class="count">${dashes.length}</span></h2><div class="cards">${dashes.map(d => `<a class="card link-card" href="#/dashboards/${d.id}"><h3>${esc(d.name)}</h3><p class="muted small">${d.widgets} widget${d.widgets === 1 ? '' : 's'}</p></a>`).join('') || '<p class="muted">No dashboards in this area.</p>'}</div></section></div>`;
    $$('[data-start]', main).forEach(b => b.onclick = () => startFlow(b.dataset.start, b));
  });

  FB.route('/admin/areas', async (main) => {
    const list = await api.get('/areas');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Areas</h1><p class="muted">Areas are how everything is grouped: one per department or domain. Give each an owner. Processes, forms and dashboards each belong to one area.</p></div><div class="actions"><button class="btn primary" id="naBtn">+ New area</button></div></div>
      ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Area</th><th>Owner</th><th>Processes</th><th>Forms</th><th>Dashboards</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr><td><a href="#/area/${a.id}">${Org.chip(a.id)}</a> <span class="muted small">${esc(a.description || '')}</span></td><td>${esc(a.owner || '–')}</td><td>${a.flows}</td><td>${a.forms}</td><td>${a.dashboards}</td>
        <td><button class="btn small" data-edit="${a.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state card"><p>No areas yet. Start with your departments, e.g. Finance, HR, Sales, Operations.</p></div>'}</div>`;
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
      ${h.items.length ? `<ul class="health">${h.items.map(i => `<li class="lv-${i.level}"><span class="hi">${ICON[i.level]}</span><div><b>${esc(i.title)}</b>${i.detail ? `<div class="muted small">${esc(i.detail)}</div>` : ''}</div>${i.link ? `<a class="btn small" href="${esc(i.link)}">Open</a>` : ''}</li>`).join('')}</ul>`
        : '<div class="empty-state card"><p>✓ Everything is in order.</p></div>'}</div>`;
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
})();
