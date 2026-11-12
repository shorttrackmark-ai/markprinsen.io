/* Ordovia app: shell, pages and boot. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, el, fmtDate, richText, toast, modal, table, download, toCSV } = FB.ui;
  const P = FB.pages;
  const api = FB.api;

  // ---------------- shell ----------------
  const healthBadge = () => { const h = FB.state.health; return h && (h.counts.error + h.counts.warn) ? String(h.counts.error + h.counts.warn) : ''; };
  FB.shell = function (path) {
    const u = FB.state.user, m = FB.state.meta || {};
    const link = (href, icon, label, prefix, badge) => {
      const active = path === href.slice(1) || (prefix && path.startsWith(prefix));
      return `<a href="${href}" class="nav-link ${active ? 'active' : ''}"><span class="ico">${icon}</span><span>${label}</span>${badge ? `<b class="badge">${badge}</b>` : ''}</a>`;
    };
    $('#nav').innerHTML = `<div class="nav-group">
      ${link('#/', '▤', 'My tasks', null, m.openTasks)}
      ${link('#/areas', '◫', 'Areas', '/area')}
      ${link('#/processes', '⟳', 'Runs', '/processes')}
      ${link('#/handbook', '❖', 'Handbook', '/handbook')}
      ${link('#/objects', '◈', 'Objects', '/objects')}
      ${link('#/documents', '❏', 'Documents', '/documents')}
      ${link('#/data', '▦', 'Data', '/data')}
      ${link('#/dashboards', '▣', 'Dashboards', '/dashboards')}</div>
      ${FB.isAdmin() ? `<div class="nav-title">Build</div><div class="nav-group">
      ${link('#/admin/flows', '⇄', 'Flows', '/admin/flows')}
      ${link('#/admin/forms', '☰', 'Forms', '/admin/forms')}
      ${link('#/admin/areas', '◫', 'Manage areas')}
      ${link('#/admin/people', '☺', 'People &amp; tags')}</div>
      <div class="nav-title">Control</div><div class="nav-group">
      ${link('#/admin/api', '⇌', 'API & web forms', '/admin/api')}
      ${link('#/admin/health', '✚', 'Health', '/admin/health', healthBadge())}
      ${link('#/admin/activity', '☷', 'Activity', '/admin/activity')}
      ${link('#/admin/sql', '⌘', 'SQL console')}
      ${link('#/admin/settings', '⚙', 'Settings')}</div>` : ''}`;
    if (FB.isAdmin() && FB.loadHealthCount) FB.loadHealthCount();
    $('#who').innerHTML = `<span class="avatar">${esc(u.name.split(' ').map(s => s[0]).slice(0, 2).join(''))}</span><span class="who-name">${esc(u.name)}</span>`;
    const dc = $('#demoCtl');
    if (dc && FB.state.settings.demoSite) {
      dc.innerHTML = `<span class="demo-pill" title="The example resets every night and sends nothing anywhere">Example</span><select id="demoWho" aria-label="Look through someone else's eyes">${PERSONAS.map(([k, l]) => `<option value="${k}" ${(k === 'admin' ? 'demo@example.com' : k + '@example.com') === u.email ? 'selected' : ''}>${esc(l.split(' – ')[0])}</option>`).join('')}</select><button class="btn small ghost" id="demoReset" title="Throw away all changes and start fresh">Reset</button><button class="btn small" id="demoLeave" title="Back to your own workspace">Exit example</button>`;
      $('#demoLeave').onclick = async () => { try { await api.post('/demo/leave'); location.hash = '#/'; location.reload(); } catch (err) { toast(err.message, 'error'); } };
      $('#demoWho').onchange = (e) => enterDemo(e.target.value);
      $('#demoReset').onclick = async () => { if (!confirm('Reset the example to its starting state?')) return; try { await api.post('/demo/reset'); await enterDemo('admin'); toast('The example is fresh again', 'ok'); } catch (err) { toast(err.message, 'error'); } };
    }
    $('#brandName').textContent = FB.state.settings.company && FB.state.settings.company !== 'Ordovia' ? FB.state.settings.company : 'Ordovia';
  };
  FB.refreshBadge = () => refreshBadge();
  const refreshBadge = async () => { try { await FB.loadMeta(); FB.shell((location.hash || '#/').slice(1).split('?')[0] || '/'); } catch (e) { /* ignore */ } };

  // ---------------- setup & login ----------------
  const PERSONAS = [['admin', 'Admin – builds processes, forms and dashboards'], ['anna', 'Anna – Manager, Sales'], ['bram', 'Bram – Employee, Sales'], ['carla', 'Carla – Employee, Operations'], ['daan', 'Daan – Manager, Operations'], ['eva', 'Eva – Finance']];
  const enterDemo = async (as) => { try { await api.post('/demo/enter', { as }); await FB.loadMeta(); location.hash = '#/'; FB.render(); } catch (err) { toast(err.message, 'error'); } };
  FB.enterDemo = enterDemo;
  const exampleButton = () => (FB.state.settings.canTryExample ? '<button type="button" class="btn block example-btn" data-example>▶ Try the example – no login needed</button>' : '');
  const wireExample = (root) => { const b = $('[data-example]', root); if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Preparing the example…'; try { await api.post('/demo/enter', { as: 'admin' }); location.hash = '#/'; location.reload(); } catch (err) { toast(err.message, 'error'); b.disabled = false; b.textContent = '▶ Try the example – no login needed'; } }; };
  P.login = function (main) {
    if (FB.state.settings.demoSite) {
      main.innerHTML = `<div class="login-wrap"><div class="card login"><div class="brand big"><span class="logo-mark">◆</span> Ordovia – example</div>
        <p class="muted">A small company with people, forms, three processes and a dashboard. Click around, start a process, approve a task – the example resets every night and sends nothing anywhere.</p>
        <button class="btn primary block" id="demoGo">Enter the example</button>
        <p class="small muted">Or look through someone else's eyes:</p>${PERSONAS.slice(1).map(([k, l]) => `<button type="button" class="chip" data-as="${k}">${esc(l)}</button>`).join('')}</div></div>`;
      $('#demoGo', main).onclick = (e) => { e.target.disabled = true; e.target.textContent = 'Preparing the example…'; enterDemo('admin'); };
      $$('[data-as]', main).forEach(b => b.onclick = () => { b.disabled = true; enterDemo(b.dataset.as); });
      return;
    }
    if (FB.state.setup) return P.setup(main);
    main.innerHTML = `<div class="login-wrap"><form class="card login" id="loginForm">
      <div class="brand big"><span class="logo-mark">◆</span> ${esc(FB.state.settings.company || 'Ordovia')}</div>
      <p class="muted">Processes, forms, handbook and dashboards – all linked.</p>
      <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block">Sign in</button>
      ${exampleButton()}
      ${FB.state.settings.demo ? `<div class="demo-users"><p class="small muted">Demo colleagues (password <code>demo1234</code>):</p>
        ${[['anna', 'Anna – Manager, Sales'], ['bram', 'Bram – Employee, Sales'], ['carla', 'Carla – Employee, Operations'], ['daan', 'Daan – Manager, Operations'], ['eva', 'Eva – Finance']]
          .map(([k, l]) => `<button type="button" class="chip" data-email="${k}@example.com">${esc(l)}</button>`).join('')}</div>` : ''}
    </form></div>`;
    wireExample(main);
    const f = $('#loginForm');
    $$('[data-email]', f).forEach(b => b.onclick = () => { f.email.value = b.dataset.email; f.password.value = 'demo1234'; f.requestSubmit(); });
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api.post('/login', { email: f.email.value, password: f.password.value }); await FB.loadMeta(); location.hash = '#/'; FB.render(); }
      catch (err) { toast(err.message, 'error'); }
    };
  };

  P.setup = function (main) {
    main.innerHTML = `<div class="login-wrap"><form class="card login" id="setupForm">
      <div class="brand big"><span class="logo-mark">◆</span> Welcome to Ordovia</div>
      <p class="muted">Create your workspace and the first administrator.</p>
      <label>Company name<input name="company" required placeholder="Acme BV"></label>
      <label>Your name<input name="name" required autocomplete="name"></label>
      <label>E-mail<input name="email" type="email" required autocomplete="username"></label>
      <label>Password <small class="muted">(at least 8 characters)</small><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <label class="check"><input type="checkbox" name="demo" checked><span>Fill with demo data (colleagues, forms, processes, dashboard)</span></label>
      <button class="btn primary block">Create workspace</button>${exampleButton()}</form></div>`;
    wireExample(main);
    const f = $('#setupForm');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button', f); btn.disabled = true; btn.textContent = 'Setting up…';
      try {
        await api.post('/setup', { company: f.company.value, name: f.name.value, email: f.email.value, password: f.password.value, demo: f.demo.checked });
        await boot();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Create workspace'; }
    };
  };

  // ---------------- my tasks ----------------
  FB.route('/', async (main) => {
    const u = FB.state.user;
    const h = await api.get('/home');
    main.innerHTML = `<div class="page"><div class="page-head"><h1>Hi ${esc(u.name.split(' ')[0])}</h1></div>
      <section><h2>Start a process</h2>${FB.org.group(h.flows, f => f.area_id).map(g => `<div class="start-area">${g.area ? `<div class="start-area-head"><a href="#/area/${g.area.id}">${FB.org.chip(g.area.id)}</a></div>` : ''}<div class="start-grid">${g.items.map(f => `<button class="card start-card" data-start="${f.id}"><b>${esc(f.name)} ${FB.org.status(f.status)}</b><span class="muted small">${esc(f.description || '')}</span></button>`).join('')}</div></div>`).join('') || '<p class="muted">No processes available for you.</p>'}</section>
      <section><h2>Open tasks <span class="count">${h.tasks.length}</span></h2>
      ${h.tasks.length ? `<div class="task-list">${h.tasks.map(t => `<a class="card task-row ${t.overdue ? 'overdue' : ''}" href="#/task/${t.id}">
        <div><b>${esc(t.name)}</b><div class="muted small">${esc(t.process)} · ${esc(t.flow)}</div></div>
        <div class="muted small right">${t.due_at ? `<span class="${t.overdue ? 'danger-text' : ''}">${t.overdue ? 'Overdue' : 'Due'} ${esc(fmtDate(t.due_at))}</span><br>` : esc(fmtDate(t.created_at)) + '<br>'}${esc(t.assignee)}</div></a>`).join('')}</div>`
        : '<div class="empty-state card"><p>Nothing to do right now.</p></div>'}</section>
      <section><h2>Recently started by me</h2>${h.mine.length ? table({ columns: ['Process', 'Status', 'Outcome', 'Started'], values: h.mine.map(i => [i.title, i.status, i.outcome, fmtDate(i.created_at)]) }, { rowAttr: (r, i) => `data-href="#/processes/${h.mine[i].id}" class="clickable"` }) : '<p class="muted">None yet.</p>'}</section></div>`;
    $$('[data-start]', main).forEach(b => b.onclick = () => FB.org.start(h.flows.find(f => f.id === Number(b.dataset.start)), b));
    clickableRows(main);
  });
  function clickableRows(root) { $$('tr[data-href]', root).forEach(r => r.onclick = () => FB.go(r.dataset.href)); }
  const formById = (id) => FB.state.meta.forms.find(f => f.id === Number(id));

  // ---------------- task ----------------
  FB.route('/task/:id', async (main, { id }) => {
    const d = await api.get('/tasks/' + Number(id));
    const t = d.task, form = t.form_id ? formById(t.form_id) : null;
    main.innerHTML = `<div class="page"><div class="page-head"><div><a class="crumb" href="#/processes/${t.instance_id}">← ${esc(t.process)}</a><h1>${esc(t.name)}</h1>
      ${t.due_at ? `<p class="muted small">Due ${esc(fmtDate(t.due_at))}</p>` : ''}</div><span class="status s-${esc(t.status)}">${esc(t.status)}</span></div>
      ${d.instructions ? `<div class="card instructions"><h4>Work instruction</h4><p>${richText(d.instructions)}</p></div>` : ''}
      ${(d.documents || []).length ? `<div class="card instructions"><h4>Documents for this step</h4>${FB.org.docLinks(d.documents)}</div>` : ''}
      ${(d.links || []).length ? `<div class="card instructions"><h4>Linked at this step</h4>${FB.org.linkList(d.links)}</div>` : ''}
      <div class="two-col"><div class="card" id="taskForm"></div>
      <aside>${d.previous.length ? `<h3>Earlier in this process</h3>${d.previous.map(s => { const f = formById(s.form_id); return f ? `<div class="card prev"><div class="muted small">${esc(s.task_name || f.name)} · ${esc(s.who || 'automatic')} · ${esc(fmtDate(s.created_at))}</div>${FB.forms.summary(f, s.data)}</div>` : ''; }).join('')}` : '<p class="muted">This is the first step.</p>'}</aside></div></div>`;
    const box = $('#taskForm', main);
    if (t.status !== 'open') { box.innerHTML = `<p class="muted">Completed ${esc(fmtDate(t.completed_at))}.</p>${d.submission && form ? FB.forms.summary(form, d.submission.data) : ''}`; return; }
    if (!d.canComplete) { box.innerHTML = `<p>This task is assigned to: <b>${esc(d.assignee)}</b>.</p>`; return; }
    const complete = async (data) => {
      const r = await api.post(`/tasks/${t.id}/complete`, { data });
      toast('Task completed', 'ok'); refreshBadge();
      FB.go(r.taskId ? '#/task/' + r.taskId : '#/processes/' + r.instanceId);
    };
    if (!form) { box.innerHTML = '<p>This task has no form.</p><button class="btn primary" id="done">Mark as done</button>'; $('#done', box).onclick = () => complete({}).catch(e => toast(e.message, 'error')); return; }
    if (form.description) box.insertAdjacentHTML('beforeend', `<p class="muted">${esc(form.description)}</p>`);
    await FB.forms.open(box, form, { context: d.vars, submitLabel: 'Complete task', onSubmit: complete });
  });

  // ---------------- processes ----------------
  FB.route('/processes', async (main) => {
    const status = FB.query().get('status') || '';
    const rows = await api.get('/instances' + (status ? '?status=' + encodeURIComponent(status) : ''));
    main.innerHTML = `<div class="page"><div class="page-head"><h1>Processes</h1>
      <div class="seg">${['', 'running', 'done', 'stuck'].map(s => `<button class="${s === status ? 'on' : ''}" data-s="${s}">${s || 'all'}</button>`).join('')}</div></div>
      ${table({ columns: ['#', 'Process', 'Flow', 'Status', 'Outcome', 'Started by', 'Started', 'Hours'], values: rows.map(r => [r.id, r.title, r.flow, r.status, r.outcome, r.started_by, fmtDate(r.created_at), r.hours]) }, { rowAttr: (r) => `data-href="#/processes/${r[0]}" class="clickable"` })}</div>`;
    $$('[data-s]', main).forEach(b => b.onclick = () => { location.hash = '#/processes' + (b.dataset.s ? '?status=' + b.dataset.s : ''); });
    clickableRows(main);
  });

  FB.route('/processes/:id', async (main, { id }) => {
    const d = await api.get('/instances/' + Number(id));
    const inst = d.instance;
    const done = new Set(d.tasks.filter(t => t.status === 'done').map(t => t.node_id));
    const open = new Set(d.tasks.filter(t => t.status === 'open').map(t => t.node_id));
    main.innerHTML = `<div class="page"><div class="page-head"><div><a class="crumb" href="#/processes">← Processes</a><h1>${esc(inst.title)}</h1>
      <p class="muted">${esc(inst.flow)}${d.subject ? ` · about <a href="#/objects/${d.subject.formId}/${d.subject.id}">${esc(d.subject.form)}: ${esc(d.subject.label)}</a>` : ''} · started by ${esc(inst.started_by || '?')} · ${esc(fmtDate(inst.created_at))}</p></div>
      <div class="actions"><span class="status s-${esc(inst.status)}">${esc(inst.status)}${inst.outcome ? ' · ' + esc(inst.outcome) : ''}</span>
      ${FB.isAdmin() ? '<button class="btn danger ghost small" id="pDel">Delete</button>' : ''}</div></div>
      <div class="card mini-flow">${FB.flows.static(d.graph, done, open)}</div>
      <div class="two-col"><div><h3>Tasks</h3>${d.tasks.map(t => `<a class="card task-row" href="#/task/${t.id}"><div><b>${esc(t.name)}</b><div class="muted small">${t.status === 'done' ? `Done by ${esc(t.who)} · ${esc(fmtDate(t.completed_at))}` : esc(t.assignee)}</div></div><span class="status s-${esc(t.status)}">${esc(t.status)}</span></a>`).join('') || '<p class="muted">No tasks.</p>'}
        <details><summary>Process variables</summary><pre class="code small">${esc(JSON.stringify(d.vars, null, 2))}</pre></details></div>
      <div><h3>Timeline</h3><ol class="timeline">${d.events.map(e => `<li><span class="muted small">${esc(fmtDate(e.created_at))}</span>${esc(e.message)}</li>`).join('')}</ol></div></div></div>`;
    const del = $('#pDel', main);
    if (del) del.onclick = async () => { if (confirm('Delete this process and its tasks?')) { await api.del('/instances/' + inst.id); refreshBadge(); FB.go('#/processes'); } };
  });

  // ---------------- handbook ----------------
  FB.route('/handbook', async (main) => {
    const list = await api.get('/handbook');
    const st = { q: '', area: '', status: 'live' };
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Process handbook</h1><p class="muted">How we work: every process with its purpose, owner, steps and work instructions – always in sync with what actually runs.</p></div></div>
      <div id="hbFilters"></div><div id="hbList"></div></div>`;
    const draw = () => {
      const shown = list.filter(f => FB.org.match(f, st, [f.name, f.description, f.doc.purpose, f.owner].join(' ')));
      FB.org.register($('#hbList', main), shown, [
        { label: 'Process', cell: f => `<a href="#/handbook/${f.id}"><b>${esc(f.name)}</b></a> ${FB.org.status(f.status)}`, sort: f => f.name.toLowerCase() },
        { label: 'Area', cell: FB.org.cell.areaChip, sort: f => FB.org.areaName(f.area_id) },
        { label: 'Purpose', cell: f => `<span class="clip">${esc(f.doc.purpose || f.description || '')}</span>`, cls: 'wide', sort: f => f.doc.purpose || f.description || '' },
        { label: 'Owner', cell: FB.org.cell.person, sort: f => f.owner || '' },
        { label: 'Steps', cell: f => f.steps, sort: f => f.steps, cls: 'num' },
        { label: 'Version', cell: f => 'v' + f.version, sort: f => f.version, cls: 'num' },
        { label: 'Next review', cell: FB.org.cell.review, sort: f => f.reviewDue || '9999' },
      ], { href: f => '#/handbook/' + f.id, empty: 'No processes match.', one: 'process', many: 'processes', total: list.length });
    };
    FB.org.filters($('#hbFilters', main), st, { status: FB.isAdmin(), placeholder: 'Search processes…' }, draw);
    draw();
  });

  FB.route('/handbook/:id', async (main, { id }) => {
    const h = await api.get('/handbook/' + Number(id));
    const order = orderSteps(h.graph);
    const steps = order.map(nid => h.steps.find(s => s.id === nid)).filter(s => s && s.type !== 'start');
    const typeLabel = { task: 'Task', decision: 'Decision', action: 'Calculation', record: 'Record', webhook: 'Integration', end: 'End' };
    main.innerHTML = `<div class="page handbook"><div class="page-head"><div><a class="crumb" href="#/handbook">← Handbook</a><h1>${esc(h.name)}</h1>
      <p class="muted">${h.area ? `<a href="#/area/${h.area_id}">${esc(h.area)}</a> · ` : ''}Version ${h.version} · last changed ${esc(fmtDate(h.updated_at))}${h.stats && h.stats.runs ? ` · ${h.stats.runs} runs, avg. ${h.stats.avg_hours ?? '–'} h` : ''} ${FB.org.status(h.status)}</p>
      ${h.reviewDue ? `<p class="small ${h.overdue ? 'warn-text' : 'muted'}">${h.overdue ? '⚠ Review was due' : 'Next review'} ${esc(h.reviewDue)}${h.reviewedAt ? ` · last reviewed ${esc(fmtDate(h.reviewedAt).slice(0, 10))}` : ''}</p>` : ''}</div>
      <div class="actions">${h.canReview ? '<button class="btn" id="hbReview">Mark as reviewed</button>' : ''}<button class="btn" onclick="window.print()">Print</button>${FB.isAdmin() ? `<a class="btn" href="#/admin/flows/${h.id}">Edit flow</a>` : ''}</div></div>
      <div class="doc-grid">
        <div class="card"><h4>Purpose</h4><p>${richText(h.doc.purpose || h.description || '–')}</p></div>
        <div class="card"><h4>Owner</h4><p>${esc(h.owner || h.doc.owner || '–')}</p><h4>Scope</h4><p>${esc(h.doc.scope || '–')}</p></div>
        <div class="card"><h4>Records</h4><p>${esc(h.doc.records || '–')}</p></div></div>
      <div class="card mini-flow">${FB.flows.static(h.graph)}</div>
      <div id="hbLinks"></div>
      <h2>Steps</h2><ol class="steps">${steps.map(s => `<li class="step step-${s.type}"><div class="step-head"><b>${esc(s.name)}</b><span class="tag">${typeLabel[s.type] || s.type}</span></div>
        ${s.responsible ? `<div class="small"><span class="muted">Responsible:</span> ${esc(s.responsible)}${s.dueHours ? ` · <span class="muted">within</span> ${s.dueHours} h` : ''}</div>` : ''}
        ${s.form ? `<div class="small"><span class="muted">Form:</span> ${esc(s.form)}</div>` : ''}
        ${s.instructions ? `<div class="step-instr">${richText(s.instructions)}</div>` : ''}
        ${(s.documents || []).length ? `<div class="step-docs">${FB.org.docLinks(s.documents)}</div>` : ''}
        ${(s.links || []).length ? `<div class="step-docs">${FB.org.linkList(s.links)}</div>` : ''}
        ${s.next.length > 1 ? `<div class="small muted">${s.next.map(n => `${esc(n.when || 'otherwise')} → ${esc(n.to)}`).join(' · ')}</div>` : ''}</li>`).join('')}</ol></div>`;
    FB.org.links($('#hbLinks', main), { type: 'flow', id: h.id }, { title: 'Links', outLabel: 'Refers to', inLabel: 'Linked from' });
    const rv = $('#hbReview', main);
    if (rv) rv.onclick = async () => { try { await api.post(`/flows/${h.id}/review`); toast('Marked as reviewed', 'ok'); FB.render(); } catch (e) { toast(e.message, 'error'); } };
  });
  /** Order steps roughly in flow order (breadth-first from Start). */
  function orderSteps(g) {
    const start = g.nodes.find(n => n.type === 'start'); if (!start) return g.nodes.map(n => n.id);
    const seen = new Set([start.id]), q = [start.id], out = [];
    while (q.length) { const id = q.shift(); out.push(id); g.edges.filter(e => e.from === id).forEach(e => { if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); } }); }
    return out.concat(g.nodes.map(n => n.id).filter(id => !seen.has(id)));
  }

  // ---------------- data ----------------
  FB.route('/data', async (main) => {
    await FB.loadMeta();
    const forms = FB.state.meta.forms;
    const st = { q: '', area: '', status: 'live' };
    main.innerHTML = `<div class="page"><div class="page-head"><h1>Data</h1></div><div id="dtFilters"></div><div id="dtList"></div></div>`;
    const draw = () => {
      const shown = forms.filter(f => FB.org.match(f, st, f.name + ' ' + (f.description || '')));
      FB.org.register($('#dtList', main), shown, [
        { label: 'Register', cell: f => `<a href="#/data/${f.id}"><b>${esc(f.name)}</b></a> ${FB.org.status(f.status)}`, sort: f => f.name.toLowerCase() },
        { label: 'Area', cell: FB.org.cell.areaChip, sort: f => FB.org.areaName(f.area_id) },
        { label: 'Description', cell: f => `<span class="clip">${esc(f.description || '')}</span>`, cls: 'wide', sort: f => f.description || '' },
        { label: 'You can see', cell: f => (f.canView ? 'All records' : 'Your records'), sort: f => (f.canView ? 0 : 1) },
        { label: 'You can add', cell: f => (f.canAdd ? 'Yes' : '–'), sort: f => (f.canAdd ? 0 : 1) },
      ], { href: f => '#/data/' + f.id, empty: 'No forms match.', one: 'register', many: 'registers', total: forms.length });
    };
    FB.org.filters($('#dtFilters', main), st, { status: FB.isAdmin(), placeholder: 'Search data…' }, draw);
    draw();
  });

  FB.route('/data/:id', async (main, { id }) => {
    let res = await api.get(`/forms/${Number(id)}/records`);
    const form = formById(id) || res.form;
    let q = '';
    main.innerHTML = `<div class="page page-wide"><div class="page-head"><div><a class="crumb" href="#/data">← Data</a><h1>${esc(form.name)} <span class="count" id="dCount"></span></h1>
      <p class="muted small">${res.scope === 'all' ? 'All records' : 'Only your own records'} · SQL view <code>form_${esc(form.slug)}</code></p></div>
      <div class="actions"><input type="search" id="dSearch" placeholder="Search…"><button class="btn" id="dCsv">Export CSV</button>
      ${FB.isAdmin() ? `<a class="btn" href="#/admin/forms/${form.id}">Edit form</a>` : ''}${res.canAdd ? '<button class="btn primary" id="dNew">+ New record</button>' : ''}</div></div>
      <div id="dTable"></div></div>`;
    const filtered = () => q ? { columns: res.columns, values: res.values.filter(r => r.some(v => String(v ?? '').toLowerCase().includes(q.toLowerCase()))) } : res;
    function draw() {
      const rows = filtered();
      $('#dTable').innerHTML = table(rows, { rowAttr: (r) => `data-sub="${r[0]}" class="clickable"` });
      $('#dCount').textContent = rows.values.length;
      $$('tr[data-sub]').forEach(r => r.onclick = () => showRecord(Number(r.dataset.sub)));
    }
    const reload = async () => { res = await api.get(`/forms/${form.id}/records`); draw(); };
    $('#dSearch', main).oninput = (e) => { q = e.target.value; draw(); };
    $('#dCsv', main).onclick = () => { const r = filtered(); download(form.slug + '.csv', toCSV(r.columns, r.values), 'text/csv'); };
    const nb = $('#dNew', main);
    if (nb) nb.onclick = async () => {
      const box = document.createElement('div');
      const m = modal('New ' + form.name, box, { wide: true });
      await FB.forms.open(box, form, { context: { initiator: FB.profileOf(FB.state.user.id) }, submitLabel: 'Save record', onCancel: m.close,
        onSubmit: async (data) => { await api.post(`/forms/${form.id}/records`, { data }); m.close(); toast('Record saved', 'ok'); reload(); } });
    };
    async function showRecord(sid) {
      const r = await api.get('/records/' + sid);
      const s = r.record;
      const body = el(`<div><p class="muted small">#${s.id} · ${esc(s.who || 'automatic')} · ${esc(fmtDate(s.created_at))}${s.updated_at ? ` · updated ${esc(fmtDate(s.updated_at))}` : ''}${s.instance_id ? ` · <a href="#/processes/${s.instance_id}">process #${s.instance_id}</a>` : ''}</p>
        <div id="recBody">${FB.forms.summary(form, s.data)}</div>
        ${r.linkedFrom.length ? `<h4>Linked from</h4><ul class="linked">${r.linkedFrom.map(l => `<li><a href="#/data/${l.formId}">${esc(l.form)}</a> #${l.id}</li>`).join('')}</ul>` : ''}
        ${r.canEdit ? '<div class="form-actions"><button class="btn danger ghost" id="rDel">Delete</button><button class="btn" id="rEdit">Edit</button></div>' : ''}</div>`);
      const m = modal(form.name + ' #' + s.id, body, { wide: true });
      const del = $('#rDel', body);
      if (del) del.onclick = async () => { if (confirm('Delete this record?')) { await api.del('/records/' + sid); m.close(); reload(); } };
      const ed = $('#rEdit', body);
      if (ed) ed.onclick = async () => {
        const holder = $('#recBody', body); holder.innerHTML = ''; ed.parentElement.remove();
        await FB.forms.open(holder, form, { values: s.data, context: { initiator: FB.profileOf(s.person_id || FB.state.user.id) }, submitLabel: 'Save changes', onCancel: m.close,
          onSubmit: async (data) => { await api.put('/records/' + sid, { data }); m.close(); toast('Record updated', 'ok'); reload(); } });
      };
    }
    draw();
    const openId = Number(FB.query().get('open')); if (openId) showRecord(openId).catch(() => {});
  });

  // ---------------- dashboards ----------------
  FB.route('/dashboards', (main) => FB.dashboards.listPage(main));
  FB.route('/dashboards/:id', (main, { id }) => FB.dashboards.page(main, Number(id)));

  // ---------------- admin: forms ----------------
  FB.route('/admin/forms', async (main) => {
    const forms = await api.get('/admin/forms');
    const st = { q: '', area: '', status: 'live' };
    main.innerHTML = `<div class="page page-wide"><div class="page-head"><h1>Forms</h1><div class="actions"><button class="btn primary" id="nf">+ New form</button></div></div><div id="fmFilters"></div><div id="fmList"></div></div>`;
    const draw = () => {
      const shown = forms.filter(f => FB.org.match(f, st, f.name + ' ' + f.slug + ' ' + (f.description || '')));
      const rows = FB.org.group(shown, f => f.area_id).flatMap(g => g.items);
      $('#fmList', main).innerHTML = table({ columns: ['Form', 'Area', 'Status', 'Fields', 'Records', 'Used in', 'SQL view', 'Updated'], values: rows.map(f => [f.name, '', f.status, f.fields, f.records, f.usedIn ? f.usedIn + ' process' + (f.usedIn > 1 ? 'es' : '') : '–', 'form_' + f.slug, fmtDate(f.updated_at)]) },
        { rowAttr: (r, i) => `data-href="#/admin/forms/${rows[i].id}" class="clickable"` });
      $$('#fmList tbody tr', main).forEach((tr, i) => { const tds = tr.children; if (tds[1]) tds[1].innerHTML = FB.org.chip(rows[i].area_id) || '<span class="muted">–</span>'; if (tds[2]) tds[2].innerHTML = FB.org.status(rows[i].status) || 'active'; });
      clickableRows(main);
    };
    FB.org.filters($('#fmFilters', main), st, { status: true, placeholder: 'Search forms…' }, draw);
    draw();
    $('#nf', main).onclick = async () => { const n = prompt('Form name', 'New form'); if (n && n.trim()) { const r = await api.post('/admin/forms', { name: n.trim(), area_id: st.area && st.area !== 'none' ? Number(st.area) : null }); await FB.loadMeta(); FB.go('#/admin/forms/' + r.id); } };
  }, { admin: true });
  FB.route('/admin/forms/:id', (main, { id }) => FB.forms.builder(main, Number(id)), { admin: true });

  // ---------------- admin: flows ----------------
  FB.route('/admin/flows', async (main) => {
    const flows = await api.get('/admin/flows');
    const st = { q: '', area: '', status: 'live' };
    main.innerHTML = `<div class="page"><div class="page-head"><h1>Flows</h1><div class="actions"><button class="btn primary" id="nf">+ New flow</button></div></div><div id="flFilters"></div><div id="flList"></div></div>`;
    const setStatus = async (id, status) => {
      const full = await api.get('/admin/flows/' + id);
      try { await api.put('/admin/flows/' + id, { name: full.name, description: full.description, graph: full.graph, doc: full.doc, status }); toast(status === 'archived' ? 'Archived' : 'Restored as draft', 'ok'); FB.render(); } catch (e) { toast(e.message, 'error'); }
    };
    const wire = () => {
      $$('[data-archive]', main).forEach(b => b.onclick = () => { if (confirm('Archive this process? It disappears for everyone; running processes continue. You can restore it later.')) setStatus(b.dataset.archive, 'archived'); });
      $$('[data-restore]', main).forEach(b => b.onclick = () => setStatus(b.dataset.restore, 'draft'));
      $$('[data-del]', main).forEach(b => b.onclick = async () => { if (confirm('Delete this archived flow and ALL its process runs for good? This cannot be undone.')) { try { await api.del('/admin/flows/' + b.dataset.del); FB.render(); } catch (e) { toast(e.message, 'error'); } } });
    };
    const draw = () => {
      const shown = flows.filter(f => FB.org.match(f, st, f.name + ' ' + (f.description || '')));
      FB.org.register($('#flList', main), shown, [
        { label: 'Process', cell: f => `<a href="#/admin/flows/${f.id}"><b>${esc(f.name)}</b></a> ${FB.org.status(f.status)}`, sort: f => f.name.toLowerCase() },
        { label: 'Area', cell: FB.org.cell.areaChip, sort: f => FB.org.areaName(f.area_id) },
        { label: 'Owner', cell: f => (f.owner_id ? esc(FB.org.personName(f.owner_id)) : '<span class="muted">none</span>'), sort: f => (f.owner_id ? FB.org.personName(f.owner_id) : '') },
        { label: 'Steps', cell: f => f.steps, sort: f => f.steps, cls: 'num' },
        { label: 'Version', cell: f => 'v' + f.version, sort: f => f.version, cls: 'num' },
        { label: 'Runs', cell: f => `${f.runs}${f.running ? ` <span class="muted">(${f.running} running)</span>` : ''}`, sort: f => f.runs, cls: 'num' },
        { label: 'Check', cell: f => (f.issues ? `<span class="warn-text">${f.issues} issue${f.issues === 1 ? '' : 's'}</span>` : '<span class="ok-text">ready</span>') + (f.overdue ? ' · <span class="warn-text">review due</span>' : ''), sort: f => f.issues || 0 },
        { label: '', cls: 'actions-cell', cell: f => `<a class="btn small" href="#/admin/flows/${f.id}">Design</a> <a class="btn small" href="#/handbook/${f.id}">Handbook</a> ${f.status === 'archived' ? `<button class="btn small" data-restore="${f.id}">Restore</button> <button class="btn small danger ghost" data-del="${f.id}">Delete…</button>` : `<button class="btn small ghost" data-archive="${f.id}">Archive</button>`}`, sort: () => '' },
      ], { empty: 'No flows match.', one: 'process', many: 'processes', total: flows.length, after: wire });
      wire();
    };
    FB.org.filters($('#flFilters', main), st, { status: true, placeholder: 'Search flows…' }, draw);
    draw();
    $('#nf', main).onclick = async () => { const n = prompt('Flow name', 'New process'); if (n && n.trim()) { const r = await api.post('/admin/flows', { name: n.trim(), area_id: st.area && st.area !== 'none' ? Number(st.area) : null }); FB.go('#/admin/flows/' + r.id); } };
  }, { admin: true });
  FB.route('/admin/flows/:id', (main, { id }) => FB.flows.designer(main, Number(id)), { admin: true });

  // ---------------- admin: people ----------------
  FB.route('/admin/people', async (main) => {
    const { people, tags, categories: cats, personFields: pfields } = await api.get('/admin/people');
    main.innerHTML = `<div class="page page-wide"><div class="page-head"><h1>People &amp; tags</h1><div class="actions"><button class="btn" id="nat">Attributes…</button><button class="btn" id="nt">+ Tag</button><button class="btn primary" id="np">+ Person</button></div></div>
      <p class="muted">Tags (department, location, team, …) and attributes (job title, employee number, …) decide who can start a process, who receives a task and who sees which data.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>E-mail</th>${pfields.map(f => `<th>${esc(f.label)}</th>`).join('')}${cats.map(c => `<th>${esc(c)}</th>`).join('')}<th>Admin</th><th></th></tr></thead><tbody>
      ${people.map(p => `<tr class="${p.active ? '' : 'inactive'}"><td>${esc(p.name)}</td><td>${esc(p.email)}</td>
        ${pfields.map(f => `<td>${p.attrs[f.key] == null || p.attrs[f.key] === '' ? '<span class="muted">–</span>' : esc(String(p.attrs[f.key]))}</td>`).join('')}
        ${cats.map(c => `<td>${tags.filter(t => t.category === c && p.tagIds.includes(t.id)).map(t => `<span class="tag">${esc(t.value)}</span>`).join(' ')}</td>`).join('')}
        <td>${p.is_admin ? '✓' : ''}</td><td><button class="btn small" data-edit="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>
      <h2>Tags</h2><div class="tag-cloud">${cats.map(c => `<div class="card"><h4>${esc(c)}</h4>${tags.filter(t => t.category === c).map(t => `<span class="tag">${esc(t.value)} <button class="tag-x" data-deltag="${t.id}" title="Delete tag">×</button></span>`).join(' ')}</div>`).join('')}</div></div>`;
    const done = async () => { await FB.loadMeta(); FB.render(); };
    $('#np', main).onclick = () => editPerson(null);
    $('#nat', main).onclick = () => editAttributes();
    $$('[data-edit]', main).forEach(b => b.onclick = () => editPerson(Number(b.dataset.edit)));
    $$('[data-deltag]', main).forEach(b => b.onclick = async () => { if (confirm('Delete this tag from everyone?')) { await api.del('/admin/tags/' + b.dataset.deltag); done(); } });
    $('#nt', main).onclick = () => {
      const m = modal('New tag', `<form id="tf"><label>Category<input name="category" list="cats" required placeholder="e.g. Department"><datalist id="cats">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</datalist></label>
        <label>Value<input name="value" required placeholder="e.g. Marketing"></label><div class="form-actions"><button class="btn primary">Add tag</button></div></form>`);
      $('#tf', m.root).onsubmit = async (e) => { e.preventDefault(); try { await api.post('/admin/tags', { category: e.target.category.value, value: e.target.value.value }); m.close(); done(); } catch (err) { toast(err.message, 'error'); } };
    };
    function editPerson(pid) {
      const p = pid ? people.find(x => x.id === pid) : { name: '', email: '', is_admin: 0, active: 1, tagIds: [], attrs: {} };
      const attrInput = (f, v) => {
        const nm = `name="attr:${esc(f.key)}"`;
        if (f.type === 'select' || f.type === 'radio') return `<select ${nm}><option value="">–</option>${(f.options || []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        if (f.type === 'checkbox') return `<input type="checkbox" ${nm} ${v ? 'checked' : ''}>`;
        if (f.type === 'textarea') return `<textarea ${nm} rows="2">${esc(v ?? '')}</textarea>`;
        return `<input ${nm} type="${['number', 'date', 'email'].includes(f.type) ? f.type : 'text'}" step="any" value="${esc(v ?? '')}">`;
      };
      const m = modal(pid ? 'Edit person' : 'New person', `<form id="pf">
        <label>Name<input name="name" required value="${esc(p.name)}"></label>
        <label>E-mail<input name="email" type="email" required value="${esc(p.email)}"></label>
        <label>Password ${pid ? '<small class="muted">(leave empty to keep)</small>' : '<small class="muted">(at least 8 characters)</small>'}<input name="password" type="password" minlength="8" autocomplete="new-password" ${pid ? '' : 'required'}></label>
        ${pfields.length ? `<fieldset><legend>Attributes</legend><div class="row2">${pfields.map(f => `<label>${esc(f.label)}${attrInput(f, p.attrs[f.key])}</label>`).join('')}</div></fieldset>` : ''}
        ${cats.map(c => `<fieldset><legend>${esc(c)}</legend>${tags.filter(t => t.category === c).map(t => `<label class="check inline"><input type="checkbox" name="tag" value="${t.id}" ${p.tagIds.includes(t.id) ? 'checked' : ''}><span>${esc(t.value)}</span></label>`).join('')}</fieldset>`).join('')}
        <label class="check"><input type="checkbox" name="is_admin" ${p.is_admin ? 'checked' : ''}><span>Administrator (builds flows, forms, dashboards; uses SQL)</span></label>
        <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}><span>Active</span></label>
        <div class="form-actions"><button class="btn primary">Save</button></div></form>`);
      $('#pf', m.root).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const body = { name: f.name.value, email: f.email.value, password: f.password.value || undefined, is_admin: f.is_admin.checked, active: f.active.checked, tagIds: $$('input[name="tag"]:checked', f).map(c => Number(c.value)),
          attrs: Object.fromEntries(pfields.map(af => { const i = f.elements['attr:' + af.key]; return [af.key, !i ? null : af.type === 'checkbox' ? i.checked : af.type === 'number' ? (i.value === '' ? null : Number(i.value)) : (i.value === '' ? null : i.value)]; })) };
        try { if (pid) await api.put('/admin/people/' + pid, body); else await api.post('/admin/people', body); m.close(); toast('Saved', 'ok'); done(); }
        catch (err) { toast(err.data && err.data.errors ? Object.values(err.data.errors)[0] : err.message, 'error'); }
      };
    }
    /** Which attributes every person has: the Person class. */
    function editAttributes() {
      const rows = pfields.map(f => ({ ...f }));
      const m = modal('Person attributes', '<div id="paBox"></div>', { wide: true });
      const TYPES = [['text', 'Text'], ['select', 'Dropdown'], ['number', 'Number'], ['date', 'Date'], ['email', 'E-mail'], ['checkbox', 'Yes / no'], ['textarea', 'Long text']];
      const draw = () => {
        $('#paBox', m.root).innerHTML = `<p class="muted small">Attributes every person has, besides name and e-mail. A flow can send a task to “everyone whose job title is Metrologist”, and formulas can read them (<code>initiator.job_title</code>).</p>
          ${rows.map((f, i) => `<div class="check-row pa-row" data-i="${i}"><input data-k="label" value="${esc(f.label || '')}" placeholder="Name, e.g. Job title"><select data-k="type">${TYPES.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="icon-btn danger" data-del="${i}" title="Remove">×</button>
            ${f.type === 'select' ? `<input data-k="options" class="pa-options" value="${esc((f.options || []).join(', '))}" placeholder="Options, separated by commas">` : ''}</div>`).join('') || '<p class="muted">No attributes yet.</p>'}
          <div class="form-actions"><button type="button" class="btn" id="paAdd">+ Attribute</button><button type="button" class="btn primary" id="paSave">Save</button></div>`;
        $$('[data-i]', m.root).forEach(row => { const i = Number(row.dataset.i); $$('[data-k]', row).forEach(inp => inp.onchange = () => { const k = inp.dataset.k; rows[i][k] = k === 'options' ? inp.value.split(',').map(x => x.trim()).filter(Boolean) : inp.value; if (k === 'type') draw(); }); });
        $$('[data-del]', m.root).forEach(b => b.onclick = () => { rows.splice(Number(b.dataset.del), 1); draw(); });
        $('#paAdd', m.root).onclick = () => { rows.push({ label: '', type: 'text' }); draw(); };
        $('#paSave', m.root).onclick = async () => {
          try { await api.put('/admin/person-fields', { fields: rows.filter(r => (r.label || '').trim()).map(r => ({ key: r.key, label: r.label, type: r.type, ...(r.type === 'select' ? { options: r.options || [] } : {}) })) }); m.close(); toast('Saved', 'ok'); await FB.loadMeta(); FB.render(); }
          catch (err) { toast(err.message, 'error'); }
        };
      };
      draw();
    }
  }, { admin: true });

  // ---------------- admin: SQL console ----------------
  FB.route('/admin/sql', async (main) => {
    const cat = await api.get('/admin/catalog');
    let last = '';
    try { last = sessionStorage.getItem('ordovia.sql') || ''; } catch (e) { /* storage blocked */ }
    main.innerHTML = `<div class="page page-wide"><div class="page-head"><h1>SQL console</h1></div>
      <div class="sql-layout"><aside class="card schema"><h4>Schema</h4>${cat.map(o => `<details><summary><span class="muted small">${o.type}</span> ${esc(o.name)}</summary><ul>${o.columns.map(c => `<li><code>${esc(c)}</code></li>`).join('')}</ul></details>`).join('')}</aside>
      <div><textarea id="sql" class="mono sql-input" rows="8" spellcheck="false">${esc(last || "SELECT value AS department, count(*) AS people\nFROM v_people WHERE category = 'Department'\nGROUP BY 1 ORDER BY 2 DESC")}</textarea>
      <div class="form-actions left"><button class="btn primary" id="run">Run (Ctrl+Enter)</button><button class="btn" id="csv">Export CSV</button><span class="muted small">One statement at a time · full read/write access · passwords are never shown</span></div>
      <div id="out"></div></div></div></div>`;
    let res = null;
    const run = async () => {
      const sql = $('#sql').value;
      try { sessionStorage.setItem('ordovia.sql', sql); } catch (e) { /* ignore */ }
      try { res = await api.post('/admin/sql', { sql }); $('#out').innerHTML = `<p class="muted small">${res.values.length} rows · ${res.ms} ms</p>` + table(res); }
      catch (e) { $('#out').innerHTML = `<pre class="error">${esc(e.message)}</pre>`; }
    };
    $('#run', main).onclick = run;
    $('#sql', main).onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } };
    $('#csv', main).onclick = () => { if (res) download('query.csv', toCSV(res.columns, res.values), 'text/csv'); };
  }, { admin: true });

  // ---------------- admin: settings ----------------
  FB.route('/admin/settings', async (main) => {
    const s = await api.get('/admin/settings');
    main.innerHTML = `<div class="page"><div class="page-head"><h1>Settings</h1></div>
      <form class="card narrow" id="sf"><h3>Workspace</h3>
        <label>Company name<input name="company" value="${esc(s.company || '')}"></label>
        <label>Brand colour<span class="color-row"><input type="color" name="color" value="${esc(s.color || '#4f46e5')}"><button type="button" class="btn small ghost" id="resetColor">Default</button></span></label>
        <label>Notification webhook <small class="muted">(https – new and overdue tasks are posted here)</small><input name="notify_webhook" class="mono" value="${esc(s.notify_webhook || '')}" placeholder="https://…"></label>
        <label>Message format<select name="notify_format"><option value="json" ${s.notify_format !== 'teams' ? 'selected' : ''}>Plain JSON (Slack, Power Automate, Zapier, your own system)</option><option value="teams" ${s.notify_format === 'teams' ? 'selected' : ''}>Microsoft Teams card (Workflows “When a Teams webhook request is received”)</option></select></label>
        <div class="form-actions left"><button class="btn primary">Save</button></div></form>
      <div class="card narrow"><h3>Your data</h3><p class="muted">Everything is stored in your own Cloudflare D1 (SQLite) database. Download a full JSON export at any time.</p>
        <a class="btn" href="/api/admin/export">Download export</a></div></div>`;
    const f = $('#sf', main);
    let color = s.color || '';
    f.color.oninput = () => { color = f.color.value; document.documentElement.style.setProperty('--primary', color); };
    $('#resetColor', main).onclick = () => { color = ''; document.documentElement.style.removeProperty('--primary'); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.put('/admin/settings', { company: f.company.value, color, notify_webhook: f.notify_webhook.value.trim(), notify_format: f.notify_format.value });
        FB.state.settings.company = f.company.value; FB.state.settings.color = color; FB.applyBranding(); FB.shell('/admin/settings'); toast('Settings saved', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    };
  }, { admin: true });

  // ---------------- boot ----------------
  async function boot() {
    try {
      const s = await api.get('/session');
      FB.state.setup = s.setup; FB.state.settings = s.settings; FB.state.user = s.user;
      FB.applyBranding();
      if (s.user) await FB.loadMeta();
    } catch (e) {
      $('#main').innerHTML = `<div class="page"><h1>Could not start</h1><p class="error-text">${esc(e.message)}</p></div>`;
      return;
    }
    document.body.classList.remove('booting');
    FB.render();
  }
  $('#logout').onclick = async () => { await api.post('/logout').catch(() => {}); FB.state.user = null; FB.state.meta = null; location.hash = '#/'; FB.render(); };
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('#searchForm').onsubmit = (e) => { e.preventDefault(); const q = $('#searchBox').value.trim(); if (q.length >= 2) location.hash = '#/search?q=' + encodeURIComponent(q); };
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') && FB.state.user) { e.preventDefault(); $('#searchBox').focus(); } });
  window.addEventListener('hashchange', FB.render);
  document.addEventListener('DOMContentLoaded', boot);
})();
