/* Ordovia dashboards: widgets from the visual builder or SQL; the server runs every query. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, toast, modal, multiSelect } = FB.ui;

  const WIDGET_TYPES = { kpi: 'Number (KPI)', bar: 'Bar chart', hbar: 'Horizontal bars', line: 'Line chart', pie: 'Donut chart', table: 'Table' };
  const AGGS = { count: 'Count rows', sum: 'Sum of', avg: 'Average of', min: 'Minimum of', max: 'Maximum of' };
  const Dash = {};
  FB.dashboards = Dash;

  // ---------------- charts ----------------
  const fmtNum = (v, w) => {
    if (v == null) return '–';
    const d = w && w.decimals !== '' && w.decimals != null ? Number(w.decimals) : (Math.abs(v) < 100 ? 2 : 0);
    const s = typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : String(v);
    return (w && w.prefix || '') + s + (w && w.suffix || '');
  };
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const series = (res) => res.columns.slice(1).map((c, i) => ({ name: c, values: res.values.map(r => Number(r[i + 1]) || 0) }));

  function renderWidget(box, w, res) {
    if (!res) { box.innerHTML = '<div class="w-empty">…</div>'; return; }
    if (res.error) { box.innerHTML = `<div class="w-error">${esc(res.error)}</div>`; return; }
    if (w.type === 'table') { box.innerHTML = FB.ui.table(res, { max: 200 }); return; }
    if (w.type === 'kpi') {
      const v = res.values[0] ? res.values[0][0] : null;
      box.innerHTML = `<div class="kpi"><div class="kpi-value">${esc(fmtNum(v == null ? 0 : v, w))}</div>${w.caption ? `<div class="kpi-cap">${esc(w.caption)}</div>` : ''}</div>`;
      return;
    }
    if (!res.values.length) { box.innerHTML = '<div class="w-empty">No data yet</div>'; return; }
    if (res.columns.length < 2) { box.innerHTML = '<div class="w-error">Charts need two columns: label and value.</div>'; return; }
    const labels = res.values.map(r => r[0] == null ? '(empty)' : String(r[0]));
    const S = series(res);
    box.innerHTML = ({ bar: barChart, hbar: hbarChart, line: lineChart, pie: donutChart }[w.type] || barChart)(labels, S, w);
    const legend = S.length > 1 ? `<div class="legend">${S.map((s, i) => `<span><i class="sw c${i % 6}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    if (legend) box.insertAdjacentHTML('beforeend', legend);
  }
  Dash.renderWidget = renderWidget;

  function barChart(labels, S, w) {
    const W = 560, H = 260, L = 48, B = 46, T = 14, R = 8;
    const max = niceMax(Math.max(0, ...S.flatMap(s => s.values)));
    const pw = W - L - R, ph = H - T - B, n = labels.length, gw = pw / n, bw = Math.min(46, (gw * 0.75) / S.length);
    let out = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
    for (let i = 0; i <= 4; i++) {
      const y = T + ph - (ph * i) / 4;
      out += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="gridline"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="tick">${esc(fmtNum((max * i) / 4, { decimals: Number.isInteger(max / 4) ? 0 : (Number.isInteger(max / 2) ? 1 : 2) }))}</text>`;
    }
    labels.forEach((lb, i) => {
      const gx = L + gw * i + (gw - bw * S.length) / 2;
      S.forEach((s, j) => {
        const v = s.values[i], h = (Math.max(0, v) / max) * ph;
        out += `<rect x="${gx + j * bw}" y="${T + ph - h}" width="${bw - 2}" height="${h}" rx="3" class="bar c${j % 6}"><title>${esc(lb)} – ${esc(s.name)}: ${esc(fmtNum(v, w))}</title></rect>`;
      });
      const tl = lb.length > 12 ? lb.slice(0, 11) + '…' : lb;
      out += `<text x="${L + gw * i + gw / 2}" y="${H - B + 16}" text-anchor="middle" class="tick">${esc(n > 8 && i % Math.ceil(n / 8) ? '' : tl)}</text>`;
    });
    return out + '</svg>';
  }
  function hbarChart(labels, S, w) {
    const s = S[0], max = Math.max(1e-9, ...s.values);
    return `<div class="hbars">${labels.map((lb, i) => `<div class="hb-row" title="${esc(lb)}: ${esc(fmtNum(s.values[i], w))}">
      <span class="hb-label">${esc(lb)}</span><span class="hb-track"><i class="hb-bar" style="width:${Math.max(0, (s.values[i] / max) * 100).toFixed(1)}%"></i></span>
      <b class="hb-val">${esc(fmtNum(s.values[i], w))}</b></div>`).join('')}</div>`;
  }
  function lineChart(labels, S, w) {
    const W = 560, H = 260, L = 48, B = 46, T = 14, R = 30;
    const max = niceMax(Math.max(0, ...S.flatMap(s => s.values)));
    const pw = W - L - R, ph = H - T - B, n = labels.length;
    const x = (i) => L + (n === 1 ? pw / 2 : (pw * i) / (n - 1)), y = (v) => T + ph - (Math.max(0, v) / max) * ph;
    let out = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
    for (let i = 0; i <= 4; i++) {
      const yy = T + ph - (ph * i) / 4;
      out += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="gridline"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" class="tick">${esc(fmtNum((max * i) / 4, { decimals: Number.isInteger(max / 4) ? 0 : (Number.isInteger(max / 2) ? 1 : 2) }))}</text>`;
    }
    S.forEach((s, j) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      if (S.length === 1) out += `<polygon points="${x(0)},${T + ph} ${pts} ${x(n - 1)},${T + ph}" class="area c${j % 6}"/>`;
      out += `<polyline points="${pts}" class="line c${j % 6}"/>`;
      s.values.forEach((v, i) => { out += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" class="pt c${j % 6}"><title>${esc(labels[i])}: ${esc(fmtNum(v, w))}</title></circle>`; });
    });
    labels.forEach((lb, i) => { if (n <= 8 || i % Math.ceil(n / 8) === 0) out += `<text x="${x(i)}" y="${H - B + 16}" text-anchor="middle" class="tick">${esc(lb)}</text>`; });
    return out + '</svg>';
  }
  function donutChart(labels, S, w) {
    const vals = S[0].values.map(v => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const R = 90, r = 56, cx = 110, cy = 110;
    let a0 = -Math.PI / 2, out = `<div class="donut"><svg viewBox="0 0 220 220" class="chart donut-svg" role="img">`;
    vals.forEach((v, i) => {
      if (!v) return;
      const a1 = a0 + (v / total) * Math.PI * 2 - (vals.filter(Boolean).length > 1 ? 0.012 : 0);
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      const d = v === total
        ? `M${cx - R},${cy} a${R},${R} 0 1,0 ${R * 2},0 a${R},${R} 0 1,0 ${-R * 2},0 M${cx - r},${cy} a${r},${r} 0 1,1 ${r * 2},0 a${r},${r} 0 1,1 ${-r * 2},0`
        : `M${p(R, a0)} A${R},${R} 0 ${big} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${big} 0 ${p(r, a0)} Z`;
      out += `<path d="${d}" class="slice c${i % 6}" fill-rule="evenodd"><title>${esc(labels[i])}: ${esc(fmtNum(v, w))} (${Math.round((v / total) * 100)}%)</title></path>`;
      a0 += (v / total) * Math.PI * 2;
    });
    out += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-total">${esc(fmtNum(total === 1 && !vals.some(Boolean) ? 0 : vals.reduce((a, b) => a + b, 0), w))}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" class="tick">total</text></svg>`;
    out += `<ul class="donut-legend">${labels.map((lb, i) => `<li><i class="sw c${i % 6}"></i><span>${esc(lb)}</span><b>${esc(fmtNum(vals[i], w))}</b></li>`).join('')}</ul></div>`;
    return out;
  }

  // ---------------- pages ----------------
  Dash.listPage = async function (main) {
    const list = await FB.api.get('/dashboards');
    main.innerHTML = `<div class="page"><div class="page-head"><h1>Dashboards</h1>${FB.isAdmin() ? '<div class="actions"><button class="btn primary" id="dNew">+ New dashboard</button></div>' : ''}</div>
      <div id="dbFilters"></div><div id="dbList"></div></div>`;
    const st = { q: '', area: '', status: 'live' };
    const draw = () => {
      const shown = list.filter(d => FB.org.match(d, st, d.name));
      FB.org.register($('#dbList'), shown, [
        { label: 'Dashboard', cell: d => `<a href="#/dashboards/${d.id}"><b>${esc(d.name)}</b></a> ${FB.org.status(d.status)}`, sort: d => d.name.toLowerCase() },
        { label: 'Area', cell: FB.org.cell.areaChip, sort: d => FB.org.areaName(d.area_id) },
        { label: 'Widgets', cell: d => d.widgets, sort: d => d.widgets, cls: 'num' },
      ], { href: d => '#/dashboards/' + d.id, empty: 'No dashboards match.', one: 'dashboard', many: 'dashboards', total: list.length });
    };
    FB.org.filters($('#dbFilters'), st, { status: FB.isAdmin(), placeholder: 'Search dashboards…' }, draw);
    draw();
    const n = $('#dNew');
    if (n) n.onclick = () => FB.org.newItem('New dashboard', { placeholder: 'e.g. Operations overview', noArea: true }, async ({ name }) => { const r = await FB.api.post('/admin/dashboards', { name }); FB.go('#/dashboards/' + r.id); });
  };

  Dash.page = async function (main, id) {
    const d = await FB.api.get('/dashboards/' + id);
    d.access = d.access || {};
    let editing = false, sources = null;
    main.innerHTML = `<div class="page page-wide"><div class="page-head">
      <div><a href="#/dashboards" class="crumb">← Dashboards</a><h1 id="dTitle">${esc(d.name)}</h1></div>
      <div class="actions"><button class="btn" id="dRefresh">Refresh</button>${d.canEdit ? '<button class="btn" id="dEdit">Edit</button>' : ''}</div></div>
      <div id="dEditBar" class="edit-bar card" hidden>
        <label>Name<input id="dName" value="${esc(d.name)}"></label>
        <label>Visible for <small class="muted">(tags, empty = everyone)</small>${multiSelect('id="dAccess"', FB.tagItems(), d.access.viewTags, 3)}</label>
        <div id="dOrg"></div>
        <div class="edit-actions"><button class="btn primary" id="dAdd">+ Add widget</button><button class="btn ghost" id="dArchive">${d.status === 'archived' ? 'Restore' : 'Archive'}</button><button class="btn danger ghost" id="dDel" ${d.status === 'archived' ? '' : 'hidden'}>Delete…</button></div></div>
      <div class="dash-grid" id="dGrid"></div></div>`;
    const persist = async () => { try { await FB.api.put('/admin/dashboards/' + d.id, { name: d.name, widgets: d.widgets, access: d.access, area_id: d.area_id, owner_id: d.owner_id, status: d.status }); } catch (e) { toast(e.message, 'error'); } };
    $('#dRefresh').onclick = async () => { const fresh = await FB.api.get('/dashboards/' + id); d.results = fresh.results; draw(); };
    if (d.canEdit) {
      $('#dEdit').onclick = () => { editing = !editing; $('#dEdit').textContent = editing ? 'Done' : 'Edit'; $('#dEditBar').hidden = !editing; draw(); };
      $('#dName').onchange = (e) => { d.name = e.target.value; $('#dTitle').textContent = d.name; persist(); };
      $('#dAccess').onchange = (e) => { d.access.viewTags = [...e.target.selectedOptions].map(o => Number(o.value)); persist(); };
      $('#dAdd').onclick = () => editWidget(null);
      FB.org.bar($('#dOrg'), d, {}, persist);
      $('#dArchive').onclick = async () => { d.status = d.status === 'archived' ? 'active' : 'archived'; await persist(); FB.render(); };
      $('#dDel').onclick = async () => { if (confirm(`Delete dashboard “${d.name}” for good? This cannot be undone.`)) { try { await FB.api.del('/admin/dashboards/' + d.id); FB.go('#/dashboards'); } catch (e) { toast(e.message, 'error'); } } };
    }

    function draw() {
      const grid = $('#dGrid');
      grid.innerHTML = d.widgets.map((w, i) => `<div class="card widget w${w.w || 1}" data-i="${i}">
        <div class="w-head"><h3>${esc(w.title || 'Untitled')}</h3>${editing ? `<div class="w-tools">
          <button class="icon-btn" data-left="${i}" title="Move earlier">←</button><button class="icon-btn" data-right="${i}" title="Move later">→</button>
          <button class="icon-btn" data-edit="${i}" title="Edit">✎</button><button class="icon-btn danger" data-del="${i}" title="Remove">×</button></div>` : ''}</div>
        <div class="w-body"></div></div>`).join('') ||
        `<div class="empty-state card"><p>This dashboard is empty.</p>${d.canEdit ? '<p class="muted">Click <b>Edit</b> → <b>Add widget</b>.</p>' : ''}</div>`;
      $$('.widget', grid).forEach(c => { const w = d.widgets[Number(c.dataset.i)]; renderWidget($('.w-body', c), w, d.results[w.id]); });
      $$('[data-edit]', grid).forEach(b => b.onclick = () => editWidget(Number(b.dataset.edit)));
      $$('[data-del]', grid).forEach(b => b.onclick = () => { d.widgets.splice(Number(b.dataset.del), 1); persist(); draw(); });
      $$('[data-left]', grid).forEach(b => b.onclick = () => mv(Number(b.dataset.left), -1));
      $$('[data-right]', grid).forEach(b => b.onclick = () => mv(Number(b.dataset.right), 1));
    }
    function mv(i, k) { const j = i + k; if (j < 0 || j >= d.widgets.length) return; [d.widgets[i], d.widgets[j]] = [d.widgets[j], d.widgets[i]]; persist(); draw(); }

    async function editWidget(i) {
      if (!sources) {
        const forms = FB.state.meta.forms;
        sources = (await FB.api.get('/admin/catalog')).filter(o => o.type === 'view' || ['persons', 'tags', 'tasks', 'instances', 'submissions', 'events'].includes(o.name)).map(o => {
          const f = forms.find(x => 'form_' + x.slug === o.name);
          return { name: o.name, label: f ? `Form: ${f.name}` : ({ v_tasks: 'Tasks', v_instances: 'Processes', v_people: 'People & tags' }[o.name] || o.name), columns: o.columns, form: !!f };
        }).sort((a, b) => (b.form - a.form) || a.label.localeCompare(b.label));
      }
      const w = i == null ? { id: 'w' + Date.now(), title: 'New widget', type: 'bar', w: 1, mode: 'builder', agg: 'count', src: sources[0] && sources[0].name } : JSON.parse(JSON.stringify(d.widgets[i]));
      const body = document.createElement('div'); body.className = 'widget-editor';
      const m = modal(i == null ? 'Add widget' : 'Edit widget', body, { wide: true });
      let previewSeq = 0;
      async function preview() {
        const seq = ++previewSeq, box = $('#wePrev', body); if (!box) return;
        const pre = $('details pre', body); if (pre) pre.textContent = FB.logic.widgetSQL(w);
        const res = await FB.api.post('/admin/query', { widget: w }).catch(e => ({ error: e.message }));
        if (seq === previewSeq) renderWidget(box, w, res);
      }
      let timer;
      const later = () => { clearTimeout(timer); timer = setTimeout(preview, 300); };

      function drawEditor() {
        const src = sources.find(s => s.name === w.src) || { columns: [] }, cols = src.columns;
        body.innerHTML = `<div class="we-grid"><div class="we-form">
          <label>Title<input data-w="title" value="${esc(w.title || '')}"></label>
          <div class="row2"><label>Type<select data-w="type">${Object.entries(WIDGET_TYPES).map(([k, v]) => `<option value="${k}" ${k === w.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Width<select data-w="w">${[1, 2, 3].map(n => `<option value="${n}" ${Number(w.w || 1) === n ? 'selected' : ''}>${['Small', 'Medium', 'Full'][n - 1]}</option>`).join('')}</select></label></div>
          <div class="seg"><button class="${w.mode !== 'sql' ? 'on' : ''}" data-mode="builder">Builder</button><button class="${w.mode === 'sql' ? 'on' : ''}" data-mode="sql">SQL</button></div>
          ${w.mode === 'sql' ? `<label>SQL query <small class="muted">(first column = label, next columns = values)</small><textarea data-w="sql" rows="8" class="mono">${esc(w.sql || '')}</textarea></label>
            <p class="hint">Sources: ${sources.map(s => `<code title="${esc(s.columns.join(', '))}">${esc(s.name)}</code>`).join(' ')}</p>` : `
          <label>Data source<select data-w="src">${sources.map(s => `<option value="${esc(s.name)}" ${s.name === w.src ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
          ${w.type !== 'table' || w.groupBy ? `<div class="row2"><label>Measure<select data-w="agg">${Object.entries(AGGS).map(([k, v]) => `<option value="${k}" ${k === (w.agg || 'count') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${w.agg && w.agg !== 'count' ? `<label>Field<select data-w="field"><option value="">—</option>${cols.map(c => `<option ${c === w.field ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : '<span></span>'}</div>` : ''}
          ${w.type !== 'kpi' ? `<div class="row2"><label>Group by<select data-w="groupBy"><option value="">${w.type === 'table' ? '(show rows)' : '—'}</option>${cols.map(c => `<option ${c === w.groupBy ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>Group as<select data-w="groupFn"><option value="">value</option>${['day', 'month', 'year'].map(g => `<option value="${g}" ${w.groupFn === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label></div>` : ''}
          <label>Filter <small class="muted">(SQL WHERE, optional)</small><input data-w="where" class="mono" value="${esc(w.where || '')}" placeholder="status = 'open'"></label>
          <label>Max rows<input type="number" data-w="limit" value="${esc(w.limit || '')}" min="1"></label>`}
          <div class="row3"><label>Prefix<input data-w="prefix" value="${esc(w.prefix || '')}" placeholder="€ "></label><label>Suffix<input data-w="suffix" value="${esc(w.suffix || '')}" placeholder=" days"></label><label>Decimals<input type="number" data-w="decimals" value="${esc(w.decimals ?? '')}" min="0" max="6"></label></div>
          ${w.type === 'kpi' ? `<label>Caption<input data-w="caption" value="${esc(w.caption || '')}"></label>` : ''}
          ${w.mode !== 'sql' ? `<details><summary>Generated SQL</summary><pre class="code small"></pre><button class="btn small" id="toSql">Edit as SQL</button></details>` : ''}
          </div><div class="we-preview"><h4>Preview</h4><div class="card widget w1"><div class="w-head"><h3>${esc(w.title || '')}</h3></div><div class="w-body" id="wePrev"></div></div></div></div>
          <div class="form-actions"><button class="btn ghost" id="weCancel">Cancel</button><button class="btn primary" id="weSave">Save widget</button></div>`;
        preview();
        $$('[data-w]', body).forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
          const p = inp.dataset.w;
          w[p] = p === 'w' ? Number(inp.value) : inp.value;
          if (p === 'src') { w.field = ''; w.groupBy = ''; }
          if (inp.tagName === 'SELECT') drawEditor();
          else { if (p === 'title') $('.we-preview h3', body).textContent = w.title; later(); }
        }));
        $$('[data-mode]', body).forEach(b => b.onclick = () => { if (b.dataset.mode === 'sql' && !w.sql) w.sql = FB.logic.widgetSQL(w); w.mode = b.dataset.mode; drawEditor(); });
        const ts = $('#toSql', body); if (ts) ts.onclick = () => { w.sql = FB.logic.widgetSQL(w); w.mode = 'sql'; drawEditor(); };
        $('#weCancel', body).onclick = m.close;
        $('#weSave', body).onclick = async () => {
          const res = await FB.api.post('/admin/query', { widget: w }).catch(e => ({ error: e.message }));
          if (res.error) { toast('Query error: ' + res.error, 'error'); return; }
          if (i == null) d.widgets.push(w); else d.widgets[i] = w;
          d.results[w.id] = res;
          await persist(); m.close(); draw();
        };
      }
      drawEditor();
    }
    draw();
  };
})();
