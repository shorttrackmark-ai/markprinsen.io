/* Ordovia objects: the things a company keeps track of (machines, vehicles, suppliers...). A class is a register marked as such;
 * every record is an object with its own page: its attributes, the processes that worked on it, and the processes you can start on it. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, fmtDate, fmtVal, toast, modal } = FB.ui;
  const api = FB.api;

  // ---------------------------------------------------------------- all classes
  FB.route('/objects', async (main) => {
    const list = await api.get('/objects');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Objects</h1><p class="muted">The things the company keeps track of: machines, vehicles, suppliers, locations. Every object has its own page with its attributes and every process that was run on it.</p></div>
      ${FB.isAdmin() ? '<div class="actions"><a class="btn" href="#/admin/forms">Define a class</a></div>' : ''}</div><div id="obList"></div></div>`;
    FB.org.register($('#obList', main), list, [
      { label: 'Class', cell: o => `<a href="#/objects/${o.id}"><b>${esc(o.name)}</b></a> ${FB.org.status(o.status)}`, sort: o => o.name.toLowerCase() },
      { label: 'Area', cell: FB.org.cell.areaChip, sort: o => FB.org.areaName(o.area_id) },
      { label: 'Description', cell: o => `<span class="clip">${esc(o.description || '')}</span>`, cls: 'wide', sort: o => o.description || '' },
      { label: 'Objects', cell: o => o.count, sort: o => o.count, cls: 'num' },
    ], { href: o => '#/objects/' + o.id, empty: FB.isAdmin() ? 'No classes yet. Open a form (Build › Forms) and tick “This is a class of objects”.' : 'No classes yet.', one: 'class', many: 'classes' });
  });

  // ---------------------------------------------------------------- the objects of one class
  FB.route('/objects/:fid', async (main, { fid }) => {
    const d = await api.get('/objects/' + Number(fid));
    const form = d.form;
    const cols = form.fields.filter(f => !['heading', 'file', 'textarea', 'calc'].includes(f.type)).slice(1, 8);
    main.innerHTML = `<div class="page page-wide"><div class="page-head"><div><a class="crumb" href="#/objects">← Objects</a><h1>${esc(form.name)}</h1>${form.description ? `<p class="muted">${esc(form.description)}</p>` : ''}</div>
      <div class="actions">${FB.isAdmin() ? `<a class="btn" href="#/admin/forms/${form.id}">Edit class</a>` : ''}${d.canAdd ? `<button class="btn primary" id="obNew">+ New ${esc(form.name.toLowerCase())}</button>` : ''}</div></div>
      <div class="filters"><input type="search" id="obSearch" placeholder="Search ${esc(form.name.toLowerCase())}…"></div><div id="obTable"></div></div>`;
    let q = '';
    const draw = () => {
      const shown = d.objects.filter(o => !q || (o.label + ' ' + Object.values(o.data).join(' ')).toLowerCase().includes(q.toLowerCase()));
      FB.org.register($('#obTable', main), shown, [
        { label: form.fields.filter(f => ['text', 'email', 'select'].includes(f.type))[0] ? form.fields.filter(f => ['text', 'email', 'select'].includes(f.type))[0].label : form.name, cell: o => `<a href="#/objects/${form.id}/${o.id}"><b>${esc(o.label)}</b></a>`, sort: o => o.label.toLowerCase() },
        ...cols.map(f => ({ label: f.label, cell: o => { const v = o.data[f.key + '_label'] ?? o.data[f.key]; return v == null || v === '' ? '<span class="muted">–</span>' : esc(String(fmtVal(v)).replace(/<[^>]*>/g, '')); }, sort: o => { const v = o.data[f.key + '_label'] ?? o.data[f.key]; return typeof v === 'number' ? v : String(v ?? ''); }, cls: f.type === 'number' ? 'num' : '' })),
      ], { href: o => `#/objects/${form.id}/${o.id}`, empty: 'Nothing here yet.', one: form.name.toLowerCase(), many: form.name.toLowerCase() + ' objects', total: d.objects.length });
    };
    draw();
    $('#obSearch', main).oninput = (e) => { q = e.target.value; draw(); };
    const nb = $('#obNew', main);
    if (nb) nb.onclick = async () => {
      const box = document.createElement('div');
      const m = modal('New ' + form.name.toLowerCase(), box, { wide: true });
      await FB.forms.open(box, form, { context: { initiator: FB.profileOf(FB.state.user.id) }, submitLabel: 'Save', onCancel: m.close,
        onSubmit: async (data) => { const r = await api.post(`/forms/${form.id}/records`, { data }); m.close(); toast('Saved', 'ok'); FB.go(`#/objects/${form.id}/${r.id}`); } });
    };
  });

  // ---------------------------------------------------------------- one object
  FB.route('/objects/:fid/:id', async (main, { fid, id }) => {
    const d = await api.get(`/objects/${Number(fid)}/${Number(id)}`);
    const { form, object: o } = d;
    main.innerHTML = `<div class="page page-wide"><div class="page-head"><div><a class="crumb" href="#/objects/${form.id}">← ${esc(form.name)}</a><h1>${esc(o.label)}</h1>
      <p class="muted">${esc(form.name)} #${o.id} · added ${esc(fmtDate(o.created_at))}${o.who ? ' by ' + esc(o.who) : ''}${o.updated_at ? ` · changed ${esc(fmtDate(o.updated_at))}` : ''}</p></div>
      <div class="actions">${d.startable.map(f => `<button class="btn primary" data-start="${f.id}">${esc(f.name)}</button>`).join('')}${d.canEdit ? '<button class="btn" id="obEdit">Edit</button>' : ''}</div></div>
      <div class="two-col"><div><h2>Attributes</h2><div class="card" id="obAttr"><dl class="summary">${attributes(form, o.data)}</dl></div>
        ${d.linkedFrom.length ? `<h2>Linked from</h2><ul class="linked">${d.linkedFrom.map(l => `<li><a href="#/data/${l.formId}?open=${l.id}">${esc(l.form)} #${l.id}</a></li>`).join('')}</ul>` : ''}</div>
      <div><h2>Processes on this ${esc(form.name.toLowerCase())} <span class="count">${d.runs.length}</span></h2><div id="obRuns"></div>
        ${d.startable.length ? '' : '<p class="muted small">No process works on this class yet. In a flow, click the white canvas and choose this class under “Works on”.</p>'}</div></div></div>`;
    FB.org.register($('#obRuns', main), d.runs, [
      { label: 'Process', cell: r => `<a href="#/processes/${r.id}"><b>${esc(r.flow)}</b></a>`, sort: r => r.flow.toLowerCase() },
      { label: 'Status', cell: r => `<span class="status s-${esc(r.status)}">${esc(r.status)}</span>`, sort: r => r.status },
      { label: 'Started', cell: r => esc(fmtDate(r.created_at)), sort: r => r.created_at },
      { label: 'By', cell: r => esc(r.started_by || '–'), sort: r => r.started_by || '' },
    ], { href: r => '#/processes/' + r.id, empty: 'No process has worked on this yet.', one: 'run', many: 'runs' });
    $$('[data-start]', main).forEach(b => b.onclick = () => FB.org.start(d.startable.find(f => f.id === Number(b.dataset.start)), b, o.id));
    const ed = $('#obEdit', main);
    if (ed) ed.onclick = async () => {
      const holder = $('#obAttr', main); holder.innerHTML = '';
      await FB.forms.open(holder, form, { values: o.data, context: { initiator: FB.profileOf(FB.state.user.id) }, submitLabel: 'Save changes', onCancel: () => FB.render(),
        onSubmit: async (data) => { await api.put('/records/' + o.id, { data }); toast('Saved', 'ok'); FB.render(); } });
    };
  });

  /** The attributes as a list of label / value pairs (files and links open from here). */
  function attributes(form, data) {
    return form.fields.filter(f => f.type !== 'heading').map(f => {
      let v = data[f.key];
      if (v == null || v === '') return `<dt>${esc(f.label)}</dt><dd class="muted">–</dd>`;
      if (f.type === 'file') return `<dt>${esc(f.label)}</dt><dd><a href="/api/files/${esc(v)}" target="_blank" rel="noopener">${esc(data[f.key + '_label'] || 'File')}</a></dd>`;
      if ((f.type === 'person' || f.type === 'record') && data[f.key + '_label']) v = data[f.key + '_label'];
      return `<dt>${esc(f.label)}</dt><dd>${fmtVal(v)}</dd>`;
    }).join('');
  }
})();
