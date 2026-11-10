/* Ordovia flows: flowchart designer and read-only flow rendering. The engine runs on the server. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, toast, multiSelect } = FB.ui;

  const NODE_TYPES = {
    start: { label: 'Start', w: 120, h: 46 },
    task: { label: 'Task (form)', w: 170, h: 64 },
    decision: { label: 'Decision', w: 150, h: 84 },
    action: { label: 'Calculate', w: 160, h: 56 },
    record: { label: 'Create / update record', w: 170, h: 60 },
    webhook: { label: 'Webhook', w: 150, h: 56 },
    end: { label: 'End', w: 120, h: 46 },
  };
  const Flows = { NODE_TYPES };
  FB.flows = Flows;

  function clip(n, tx, ty) {
    const t = NODE_TYPES[n.type] || NODE_TYPES.task, dx = tx - n.x, dy = ty - n.y;
    if (!dx && !dy) return { x: n.x, y: n.y };
    const hw = t.w / 2, hh = t.h / 2;
    const s = n.type === 'decision' ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh) : Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
    return { x: n.x + dx * s, y: n.y + dy * s };
  }
  function shape(n) {
    const t = NODE_TYPES[n.type] || NODE_TYPES.task, w = t.w, h = t.h;
    if (n.type === 'start' || n.type === 'end') return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h / 2}" class="shape"/>`;
    if (n.type === 'decision') return `<polygon points="0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0" class="shape"/>`;
    if (n.type === 'record') return `<path d="M${-w / 2},${-h / 2 + 8} a${w / 2},8 0 0,1 ${w},0 v${h - 16} a${w / 2},8 0 0,1 ${-w},0 z M${-w / 2},${-h / 2 + 8} a${w / 2},8 0 0,0 ${w},0" class="shape"/>`;
    if (n.type === 'webhook') return `<polygon points="${-w / 2 + 14},${-h / 2} ${w / 2},${-h / 2} ${w / 2 - 14},${h / 2} ${-w / 2},${h / 2}" class="shape"/>`;
    return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="10" class="shape"/>`;
  }
  function wrap(text, max) {
    const words = String(text || '').split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }
  function subtitle(n) {
    const form = n.formId ? FB.state.meta.forms.find(f => f.id === Number(n.formId)) : null;
    if (n.type === 'task') return form ? form.name : 'no form!';
    if (n.type === 'record') return form ? (n.mode === 'update' ? 'update ' : 'new ') + form.name : 'no form!';
    if (n.type === 'webhook') { try { return new URL(n.url).host; } catch (e) { return 'no url!'; } }
    return '';
  }

  /** Static SVG of a flow; done/open are sets of node ids to highlight. */
  Flows.static = function (graph, done, open) {
    const g = graph;
    if (!g.nodes.length) return '';
    const xs = g.nodes.map(n => n.x), ys = g.nodes.map(n => n.y);
    const minX = Math.min(...xs) - 100, minY = Math.min(...ys) - 60, w = Math.max(...xs) - minX + 100, h = Math.max(...ys) - minY + 60;
    const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
    const edges = g.edges.map(e => {
      const a = byId[e.from], b = byId[e.to]; if (!a || !b) return '';
      const p1 = clip(a, b.x, b.y), p2 = clip(b, a.x, a.y);
      return `<path d="M${p1.x},${p1.y} L${p2.x},${p2.y}" class="edge ${e.condition ? 'cond' : ''}" marker-end="url(#arrowS)"/>${e.label ? `<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 5}" text-anchor="middle" class="edge-label">${esc(e.label)}</text>` : ''}`;
    }).join('');
    const nodes = g.nodes.map(n => {
      const cls = done && done.has(n.id) ? 'done' : open && open.has(n.id) ? 'open' : '';
      const lines = wrap(n.name, n.type === 'decision' ? 16 : 20), y0 = -(lines.length - 1) * 8;
      return `<g class="node node-${n.type} ${cls}" transform="translate(${n.x},${n.y})">${shape(n)}${lines.map((l, i) => `<text y="${y0 + i * 16}" text-anchor="middle" dominant-baseline="middle" class="node-text">${esc(l)}</text>`).join('')}</g>`;
    }).join('');
    return `<svg viewBox="${minX} ${minY} ${w} ${h}" class="flow-svg static" style="max-height:${Math.min(340, h)}px" role="img" aria-label="Process diagram">
      <defs><marker id="arrowS" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>${edges}${nodes}</svg>`;
  };

  // ---------------------------------------------------------------- designer
  Flows.designer = async function (main, flowId) {
    const flow = await FB.api.get('/admin/flows/' + flowId);
    const g = flow.graph;
    flow.doc = flow.doc || {};
    let sel = null, dirty = false;
    const view = { x: 0, y: 0, k: 1 };
    const meta = FB.state.meta;
    const forms = meta.forms;
    const formIds = forms.map(f => f.id);

    main.innerHTML = `<div class="page page-full">
      <div class="page-head">
        <div><a href="#/admin/flows" class="crumb">← Flows · version <span id="flVer">${flow.version}</span></a><input class="title-input" id="flName" value="${esc(flow.name)}" aria-label="Flow name"></div>
        <div class="actions">
          ${Object.entries(NODE_TYPES).filter(([k]) => k !== 'start').map(([k, t]) => `<button class="btn small node-btn nb-${k}" data-add="${k}">+ ${t.label.replace(' / update', '/upd.')}</button>`).join('')}
          <button class="btn small" id="flFit">Fit</button><a class="btn small" href="#/handbook/${flow.id}">Handbook</a>
          <button class="btn primary" id="flSave">Save</button>
        </div>
      </div>
      <div class="designer">
        <div class="canvas-wrap card"><svg id="flSvg" class="flow-svg" tabindex="0" aria-label="Flow designer canvas">
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker>
          <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="dot"/></pattern></defs>
          <rect id="flBg" x="-5000" y="-5000" width="10000" height="10000" fill="url(#dots)"/>
          <g id="flView"><g id="flEdges"></g><g id="flNodes"></g><path id="flGhost" class="edge ghost" d=""/></g></svg>
          <div class="canvas-hint">Drag steps to move · drag from the ● handle to another step to connect · scroll to zoom · drag background to pan · Del removes</div>
        </div>
        <aside class="card props-panel" id="flProps"></aside>
      </div></div>`;

    const svg = $('#flSvg'), vg = $('#flView');
    const touch = () => { dirty = true; $('#flSave').textContent = 'Save*'; };
    $('#flName').oninput = (e) => { flow.name = e.target.value; touch(); };
    $('#flSave').onclick = save;
    $('#flFit').onclick = fit;
    $$('[data-add]', main).forEach(b => b.onclick = () => {
      const t = b.dataset.add, r = svg.getBoundingClientRect(), id = uid('n');
      const names = { task: 'New task', decision: 'Condition?', action: 'Calculate', record: 'Save record', webhook: 'Notify system', end: 'End' };
      const node = { id, type: t, name: names[t], x: Math.round((r.width / 2 - view.x) / view.k), y: Math.round((r.height / 2 - view.y) / view.k) };
      if (t === 'task') node.assignee = { type: 'initiator' };
      if (t === 'record') node.mode = 'create';
      g.nodes.push(node); sel = { kind: 'node', id }; touch(); draw(); drawProps();
    });

    function uid(p) { let i = 1; const ids = new Set(g.nodes.map(n => n.id).concat(g.edges.map(e => e.id))); while (ids.has(p + i)) i++; return p + i; }
    function applyView() { const t = `translate(${view.x},${view.y}) scale(${view.k})`; vg.setAttribute('transform', t); $('#flBg').setAttribute('transform', t); }
    function fit() {
      if (!g.nodes.length) return;
      const r = svg.getBoundingClientRect(); if (!r.width) return;
      const xs = g.nodes.map(n => n.x), ys = g.nodes.map(n => n.y);
      const minX = Math.min(...xs) - 120, maxX = Math.max(...xs) + 120, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 80;
      view.k = Math.min(1.3, Math.max(0.3, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
      view.x = (r.width - (maxX - minX) * view.k) / 2 - minX * view.k;
      view.y = (r.height - (maxY - minY) * view.k) / 2 - minY * view.k;
      applyView();
    }

    function draw() {
      const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
      $('#flEdges').innerHTML = g.edges.map(e => {
        const a = byId[e.from], b = byId[e.to]; if (!a || !b) return '';
        const p1 = clip(a, b.x, b.y), p2 = clip(b, a.x, a.y);
        const many = g.edges.filter(x => x.from === e.from).length > 1;
        const label = e.label || e.condition || (many ? 'otherwise' : '');
        const isSel = sel && sel.kind === 'edge' && sel.id === e.id;
        return `<g class="edge-g ${isSel ? 'sel' : ''}" data-edge="${esc(e.id)}"><path class="edge-hit" d="M${p1.x},${p1.y} L${p2.x},${p2.y}"/>
          <path class="edge ${e.condition ? 'cond' : ''}" d="M${p1.x},${p1.y} L${p2.x},${p2.y}" marker-end="url(#arrow)"/>
          ${label ? `<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 6}" class="edge-label" text-anchor="middle">${esc(label.length > 28 ? label.slice(0, 27) + '…' : label)}</text>` : ''}</g>`;
      }).join('');
      $('#flNodes').innerHTML = g.nodes.map(n => {
        const t = NODE_TYPES[n.type] || NODE_TYPES.task, lines = wrap(n.name, n.type === 'decision' ? 16 : 20), sub = subtitle(n);
        const isSel = sel && sel.kind === 'node' && sel.id === n.id, y0 = -(lines.length - 1) * 8 - (sub ? 7 : 0);
        return `<g class="node node-${n.type} ${isSel ? 'sel' : ''}" data-node="${esc(n.id)}" transform="translate(${n.x},${n.y})">${shape(n)}
          ${lines.map((l, i) => `<text y="${y0 + i * 16}" text-anchor="middle" dominant-baseline="middle" class="node-text">${esc(l)}</text>`).join('')}
          ${sub ? `<text y="${y0 + lines.length * 16}" text-anchor="middle" dominant-baseline="middle" class="node-sub">${esc(sub)}</text>` : ''}
          ${n.instructions ? `<text x="${-t.w / 2 + 8}" y="${-t.h / 2 + 12}" class="node-sub" title="Has instructions">✎</text>` : ''}
          ${n.type !== 'end' ? `<circle class="port" data-port="${esc(n.id)}" cx="${t.w / 2}" cy="0" r="7"/>` : ''}</g>`;
      }).join('');
    }

    // ---- interactions ----
    let drag = null;
    const pt = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };
    svg.addEventListener('pointerdown', (e) => {
      svg.focus();
      const port = e.target.closest('[data-port]'), nodeEl = e.target.closest('[data-node]'), edgeEl = e.target.closest('[data-edge]');
      if (port) drag = { mode: 'connect', from: port.dataset.port };
      else if (nodeEl) {
        const n = g.nodes.find(x => x.id === nodeEl.dataset.node), p = pt(e);
        drag = { mode: 'node', node: n, dx: p.x - n.x, dy: p.y - n.y, moved: false };
        sel = { kind: 'node', id: n.id }; draw(); drawProps();
      } else if (edgeEl) { sel = { kind: 'edge', id: edgeEl.dataset.edge }; draw(); drawProps(); return; }
      else drag = { mode: 'pan', sx: e.clientX - view.x, sy: e.clientY - view.y, moved: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pt(e);
      if (drag.mode === 'node') { drag.node.x = Math.round((p.x - drag.dx) / 10) * 10; drag.node.y = Math.round((p.y - drag.dy) / 10) * 10; drag.moved = true; draw(); }
      else if (drag.mode === 'pan') { view.x = e.clientX - drag.sx; view.y = e.clientY - drag.sy; drag.moved = true; applyView(); }
      else { const a = g.nodes.find(x => x.id === drag.from); $('#flGhost').setAttribute('d', `M${a.x + NODE_TYPES[a.type].w / 2},${a.y} L${p.x},${p.y}`); }
    });
    svg.addEventListener('pointerup', (e) => {
      if (!drag) return;
      if (drag.mode === 'node' && drag.moved) touch();
      if (drag.mode === 'pan' && !drag.moved) { sel = null; draw(); drawProps(); }
      if (drag.mode === 'connect') {
        $('#flGhost').setAttribute('d', '');
        const p = pt(e);
        const target = g.nodes.find(n => n.id !== drag.from && Math.abs(n.x - p.x) < NODE_TYPES[n.type].w / 2 + 6 && Math.abs(n.y - p.y) < NODE_TYPES[n.type].h / 2 + 6);
        if (target && target.type !== 'start' && !g.edges.some(x => x.from === drag.from && x.to === target.id)) {
          const id = uid('e'); g.edges.push({ id, from: drag.from, to: target.id, label: '', condition: '' });
          sel = { kind: 'edge', id }; touch(); draw(); drawProps();
        }
      }
      drag = null;
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.min(2.5, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k; applyView();
    }, { passive: false });
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); removeSel(); }
    };
    const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('keydown', onKey); window.addEventListener('beforeunload', beforeUnload);
    FB.cleanup.push(() => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); });

    function removeSel() {
      if (!sel) return;
      if (sel.kind === 'node') {
        const n = g.nodes.find(x => x.id === sel.id);
        if (n && n.type === 'start') { toast('The Start step cannot be removed', 'error'); return; }
        g.nodes = g.nodes.filter(x => x.id !== sel.id);
        g.edges = g.edges.filter(x => x.from !== sel.id && x.to !== sel.id);
      } else g.edges = g.edges.filter(x => x.id !== sel.id);
      sel = null; touch(); draw(); drawProps();
    }

    async function save() {
      try {
        const r = await FB.api.put('/admin/flows/' + flow.id, { name: flow.name, description: flow.description, graph: g, doc: flow.doc });
        dirty = false; $('#flSave').textContent = 'Save'; $('#flVer').textContent = r.version;
        if (r.issues.length) toast('Saved, but: ' + r.issues[0], 'warn'); else toast('Flow saved – running processes keep their own version', 'ok');
        drawProps();
      } catch (e) { toast(e.message, 'error'); }
    }

    // ---- properties panel ----
    function varsHint() {
      const names = new Set(['initiator.name', 'initiator.department', 'initiator.function']);
      for (const n of g.nodes) {
        if (n.type === 'task' && n.formId) { const f = forms.find(x => x.id === Number(n.formId)); if (f) f.fields.forEach(x => { if (x.type !== 'heading') names.add(x.key); if (x.type === 'record' || x.type === 'person') names.add(x.key + '_label'); }); }
        if (n.type === 'action') FB.logic.assignments(n.assignments).forEach(a => names.add(a.name));
      }
      return `<div class="hint vars">Variables: ${[...names].map(v => `<code>${esc(v)}</code>`).join(' ')}</div>`;
    }

    function drawProps() {
      const box = $('#flProps');
      if (!sel) {
        const errs = FB.logic.lintFlow(g, formIds);
        box.innerHTML = `<h4>Process handbook</h4>
          <label>Description<textarea data-d="description" rows="2">${esc(flow.description || '')}</textarea></label>
          <label>Purpose<textarea data-doc="purpose" rows="2">${esc(flow.doc.purpose || '')}</textarea></label>
          <div class="row2"><label>Process owner<input data-doc="owner" value="${esc(flow.doc.owner || '')}"></label><label>Scope<input data-doc="scope" value="${esc(flow.doc.scope || '')}"></label></div>
          <label>Records &amp; retention<input data-doc="records" value="${esc(flow.doc.records || '')}"></label>
          <label>Who can start <small class="muted">(tags, empty = everyone)</small>${multiSelect('id="stTags"', FB.tagItems(), (g.nodes.find(n => n.type === 'start') || {}).startTags)}</label>
          <label>Process title <small class="muted">(formula)</small><input id="stTitle" class="mono" value="${esc((g.nodes.find(n => n.type === 'start') || {}).title || '')}" placeholder='"Leave " & initiator.name'></label>
          <h4>Check</h4>${errs.length ? `<ul class="issues">${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="ok-text">✓ This flow is ready to run.</p>'}
          <p class="hint"><b>Task</b>: a person fills a form. <b>Decision</b>: first arrow whose condition is true, otherwise the arrow without condition. <b>Calculate</b>: set variables. <b>Record</b>: create or update a record in any form. <b>Webhook</b>: send data to another system (Teams, Slack, ERP…).</p>`;
        $$('[data-d]', box).forEach(i => i.oninput = () => { flow.description = i.value; touch(); });
        $$('[data-doc]', box).forEach(i => i.oninput = () => { flow.doc[i.dataset.doc] = i.value; touch(); });
        const s = g.nodes.find(n => n.type === 'start');
        $('#stTags', box).onchange = (e) => { s.startTags = [...e.target.selectedOptions].map(o => Number(o.value)); touch(); };
        $('#stTitle', box).oninput = (e) => { s.title = e.target.value; touch(); };
        return;
      }
      if (sel.kind === 'edge') {
        const e = g.edges.find(x => x.id === sel.id); if (!e) { sel = null; drawProps(); return; }
        box.innerHTML = `<h4>Arrow</h4>
          <label>Label<input data-e="label" value="${esc(e.label || '')}" placeholder="e.g. Yes"></label>
          <label>Condition <small class="muted">(empty = otherwise)</small><textarea data-e="condition" rows="2" class="mono" placeholder="e.g. days > 3">${esc(e.condition || '')}</textarea></label>
          <div class="err" id="eErr"></div>${varsHint()}<button class="btn danger small" id="delSel">Delete arrow</button>`;
        $$('[data-e]', box).forEach(inp => inp.oninput = () => { e[inp.dataset.e] = inp.value; touch(); draw(); if (inp.dataset.e === 'condition') $('#eErr').textContent = inp.value ? (FB.expr.check(inp.value) || '') : ''; });
        $('#delSel').onclick = removeSel;
        return;
      }
      const n = g.nodes.find(x => x.id === sel.id); if (!n) { sel = null; drawProps(); return; }
      const a = n.assignee || { type: 'initiator' };
      const formSel = (label) => `<label>${label}<select data-n="formId"><option value="">— choose form —</option>${forms.map(f => `<option value="${f.id}" ${Number(n.formId) === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>`;
      const target = n.formId ? forms.find(f => f.id === Number(n.formId)) : null;
      box.innerHTML = `<h4>${esc(NODE_TYPES[n.type].label)}</h4>
        <label>Name<input data-n="name" value="${esc(n.name)}"></label>
        ${n.type === 'task' ? `${formSel('Form')}
          <label>Assigned to<select id="aType">
            <option value="initiator" ${a.type === 'initiator' ? 'selected' : ''}>Person who started the process</option>
            <option value="tags" ${a.type === 'tags' ? 'selected' : ''}>Everyone with tags…</option>
            <option value="person" ${a.type === 'person' ? 'selected' : ''}>A specific person…</option>
            <option value="field" ${a.type === 'field' ? 'selected' : ''}>Person chosen in an earlier form field…</option></select></label>
          ${a.type === 'tags' ? `<label>Must have all of these tags${multiSelect('id="aTags"', FB.tagItems(), a.tagIds)}</label>
            <label>…and share these with the initiator${multiSelect('id="aSame"', meta.categories.map(c => ({ value: c, label: c })), a.sameAs)}</label>
            <p class="hint">Function: Manager + same Department → the initiator's own manager.</p>` : ''}
          ${a.type === 'person' ? `<label>Person<select id="aPerson">${meta.people.map(p => `<option value="${p.id}" ${Number(a.personId) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
          ${a.type === 'field' ? `<label>Field key of a Person field<input id="aField" class="mono" value="${esc(a.field || '')}" placeholder="e.g. budget_holder"></label>` : ''}
          <label>Due after (hours) <small class="muted">overdue tasks are flagged and a reminder is sent</small><input type="number" min="0" data-n="dueHours" value="${esc(n.dueHours || '')}"></label>` : ''}
        ${n.type === 'action' ? `<label>Formulas <small class="muted">(one per line: name = formula)</small><textarea data-n="assignments" rows="5" class="mono" placeholder='status = "Auto-approved"&#10;cost = days * 8 * 45'>${esc(n.assignments || '')}</textarea></label>` : ''}
        ${n.type === 'record' ? `${formSel('Form')}
          <label>Mode<select data-n="mode"><option value="create" ${n.mode !== 'update' ? 'selected' : ''}>Create a new record</option><option value="update" ${n.mode === 'update' ? 'selected' : ''}>Update an existing record</option></select></label>
          ${n.mode === 'update' ? `<label>Id of the record to update <small class="muted">(formula, e.g. a Link-to-record field)</small><input data-n="recordId" class="mono" value="${esc(n.recordId || '')}" placeholder="supplier"></label>` : ''}
          <label>Field values <small class="muted">(field = formula)</small><textarea data-n="mapping" rows="6" class="mono" placeholder="item = item&#10;amount = total_incl">${esc(n.mapping || '')}</textarea></label>
          ${target ? `<p class="hint">Fields of ${esc(target.name)}: ${target.fields.filter(f => f.type !== 'heading').map(f => `<code>${esc(f.key)}</code>`).join(' ')}</p>` : ''}` : ''}
        ${n.type === 'webhook' ? `<label>URL <small class="muted">(https://…)</small><input data-n="url" class="mono" value="${esc(n.url || '')}" placeholder="https://hooks.example.com/…"></label>
          <label>Data to send <small class="muted">(name = formula, empty = all variables)</small><textarea data-n="mapping" rows="4" class="mono" placeholder='text = "New order: " & item'>${esc(n.mapping || '')}</textarea></label>` : ''}
        ${n.type === 'decision' ? '<p class="hint">Select the arrows leaving this decision to set their conditions.</p>' : ''}
        ${n.type === 'end' ? '<p class="hint">The name of this End becomes the <code>outcome</code> of the process.</p>' : ''}
        ${['task', 'decision', 'action', 'record', 'webhook'].includes(n.type) ? `<label>Instructions / work instruction <small class="muted">(shown in the task and the handbook)</small><textarea data-n="instructions" rows="4">${esc(n.instructions || '')}</textarea></label>` : ''}
        ${n.type !== 'start' ? '<button class="btn danger small" id="delSel">Delete step</button>' : '<p class="hint">Click the background to edit who can start this process and its title.</p>'}
        <div class="err" id="nErr"></div>${varsHint()}`;
      $$('[data-n]', box).forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        const p = inp.dataset.n;
        n[p] = p === 'formId' ? (inp.value ? Number(inp.value) : null) : p === 'dueHours' ? (inp.value ? Number(inp.value) : null) : inp.value;
        if (['assignments', 'mapping'].includes(p)) $('#nErr').textContent = FB.logic.assignments(inp.value).map(x => FB.expr.check(x.expr) && `${x.name}: ${FB.expr.check(x.expr)}`).filter(Boolean).join(' · ');
        touch(); draw();
        if (p === 'mode' || (p === 'formId' && n.type === 'record')) drawProps();
      }));
      const at = $('#aType', box);
      if (at) at.onchange = () => { n.assignee = { type: at.value }; if (at.value === 'person' && meta.people[0]) n.assignee.personId = meta.people[0].id; touch(); draw(); drawProps(); };
      const upd = () => {
        n.assignee = { type: a.type };
        if ($('#aTags', box)) n.assignee.tagIds = [...$('#aTags', box).selectedOptions].map(o => Number(o.value));
        if ($('#aSame', box)) n.assignee.sameAs = [...$('#aSame', box).selectedOptions].map(o => o.value);
        if ($('#aPerson', box)) n.assignee.personId = Number($('#aPerson', box).value);
        if ($('#aField', box)) n.assignee.field = $('#aField', box).value.trim();
        touch();
      };
      ['#aTags', '#aSame', '#aPerson', '#aField'].forEach(s => { const x = $(s, box); if (x) x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', upd); });
      const d = $('#delSel', box); if (d) d.onclick = removeSel;
    }

    applyView(); draw(); drawProps();
    FB.whenShown(fit);
  };
})();
