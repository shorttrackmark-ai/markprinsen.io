/* Ordovia forms: renderer (live logic, server-validated) and visual builder. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, el, toast, modal, multiSelect } = FB.ui;

  const TYPES = {
    text: { label: 'Text', icon: 'Aa' }, textarea: { label: 'Long text', icon: '¶' }, number: { label: 'Number', icon: '#' },
    email: { label: 'E-mail', icon: '@' }, date: { label: 'Date', icon: '▦' }, select: { label: 'Dropdown', icon: '▾' },
    radio: { label: 'Choice', icon: '◉' }, checkbox: { label: 'Yes / no', icon: '☑' }, person: { label: 'Person', icon: '☺' },
    record: { label: 'Link to record', icon: '⛓' }, file: { label: 'File upload', icon: '+' }, calc: { label: 'Calculation', icon: 'ƒ' }, heading: { label: 'Section heading', icon: 'H' },
  };
  const Forms = { TYPES };
  FB.forms = Forms;

  /** Client-side profile of a person from the directory (for formulas like manager.department). */
  FB.profileOf = (pid) => {
    const p = FB.state.meta.people.find(x => x.id === Number(pid)); if (!p) return {};
    const out = { id: p.id, name: p.name };
    for (const tid of p.tagIds) {
      const t = FB.state.meta.tags.find(x => x.id === tid); if (!t) continue;
      const k = t.category.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      out[k] = out[k] == null ? t.value : [].concat(out[k], t.value);
    }
    return out;
  };

  /** Fetch lookup options and render. */
  Forms.open = async function (container, form, opts = {}) {
    const needs = form.fields.some(f => f.type === 'person' || f.type === 'record');
    const options = needs ? await FB.api.get(`/forms/${form.id}/options`) : {};
    return Forms.render(container, form, { ...opts, options });
  };

  /**
   * Render a fillable form. opts: { options, context, values, readOnly, submitLabel, onSubmit(input) → Promise, onCancel }
   * The browser gives instant feedback; the server repeats every calculation and check before saving.
   */
  Forms.render = function (container, form, opts = {}) {
    const fields = form.fields;
    const context = opts.context || {};
    const options = opts.options || {};
    const raw = Object.assign({}, opts.values || {});
    let state = { values: raw, visible: {}, ctx: {} };
    const ro = !!opts.readOnly;
    const root = el('<form class="fb-form" novalidate></form>');

    const taken = new Set();   // fields filled in from an earlier step (enter once)
    for (const f of fields) {
      const pf = opts.prefill && opts.prefill[f.key];
      if (pf && raw[f.key] === undefined && f.type !== 'calc' && f.type !== 'heading') { raw[f.key] = pf.value; taken.add(f.key); if (pf.label !== undefined) raw[f.key + '_label'] = pf.label; }
      else if (raw[f.key] === undefined && f.default && f.type !== 'calc') raw[f.key] = FB.expr.safe(f.default, { ...context, ...raw });
    }

    function fieldHTML(f, i) {
      const id = `ff_${i}_${f.key}`, v = raw[f.key], dis = ro ? 'disabled' : '';
      const req = f.required ? '<span class="req" title="Required">*</span>' : '';
      const help = (f.help ? `<div class="help">${esc(f.help)}</div>` : '') + (taken.has(f.key) ? `<div class="help prefilled">Taken over from “${esc(opts.prefill[f.key].from)}”. Change it if it is not right.</div>` : '');
      const attr = (k, x) => (x !== '' && x != null ? `${k}="${esc(x)}"` : '');
      let input;
      switch (f.type) {
        case 'heading': return `<div class="ff-heading" data-key="${esc(f.key)}"><h3>${esc(f.label)}</h3>${help}</div>`;
        case 'textarea': input = `<textarea id="${id}" name="${esc(f.key)}" rows="3" ${dis} ${attr('maxlength', f.maxLength)} placeholder="${esc(f.placeholder || '')}">${esc(v ?? '')}</textarea>`; break;
        case 'number': input = `<input id="${id}" name="${esc(f.key)}" type="number" step="any" ${attr('min', f.min)} ${attr('max', f.max)} value="${esc(v ?? '')}" ${dis}>`; break;
        case 'email': case 'date': case 'text': input = `<input id="${id}" name="${esc(f.key)}" type="${f.type}" value="${esc(v ?? '')}" ${dis} placeholder="${esc(f.placeholder || '')}" ${f.type !== 'date' ? attr('maxlength', f.maxLength) : ''}>`; break;
        case 'select': input = `<select id="${id}" name="${esc(f.key)}" ${dis}><option value="">— choose —</option>${(f.options || []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
        case 'radio': input = `<div class="radios">${(f.options || []).map(o => `<label class="radio"><input type="radio" name="${esc(f.key)}" value="${esc(o)}" ${o === v ? 'checked' : ''} ${dis}><span>${esc(o)}</span></label>`).join('')}</div>`; break;
        case 'checkbox': input = `<label class="check"><input id="${id}" type="checkbox" name="${esc(f.key)}" ${v ? 'checked' : ''} ${dis}><span>${esc(f.checkLabel || 'Yes')}</span></label>`; break;
        case 'person': case 'record':
          input = `<select id="${id}" name="${esc(f.key)}" ${dis}><option value="">— choose ${f.type === 'person' ? 'person' : 'record'} —</option>${(options[f.key] || []).map(o => `<option value="${o.id}" ${Number(v) === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`; break;
        case 'file': input = `<div class="file-field" data-file="${esc(f.key)}"><input type="hidden" name="${esc(f.key)}" value="${esc(v ?? '')}"><span class="file-name">${v && raw[f.key + '_label'] ? `<a href="/api/files/${esc(v)}" target="_blank" rel="noopener">${esc(raw[f.key + '_label'])}</a>` : '<span class="muted">No file chosen</span>'}</span>${ro ? '' : `<label class="btn small file-pick">Choose file<input type="file" hidden></label><button type="button" class="btn small ghost" data-fclear ${v ? '' : 'hidden'}>Remove</button>`}</div>`; break;
        case 'calc': input = `<output id="${id}" class="calc" data-calc="${esc(f.key)}"></output>`; break;
        default: input = `<input id="${id}" name="${esc(f.key)}" value="${esc(v ?? '')}" ${dis}>`;
      }
      const lbl = f.type === 'checkbox' || f.type === 'radio' ? `<div class="lbl">${esc(f.label)}${req}</div>` : `<label class="lbl" for="${id}">${esc(f.label)}${req}</label>`;
      return `<div class="ff ff-${f.type} ${f.width === 'half' ? 'half' : ''}" data-key="${esc(f.key)}">${lbl}${input}${help}<div class="err"></div></div>`;
    }

    root.innerHTML = `<div class="ff-grid">${fields.map(fieldHTML).join('')}</div><div class="form-errors" hidden></div>` +
      (ro ? '' : `<div class="form-actions">${opts.onCancel ? '<button type="button" class="btn ghost" data-cancel>Cancel</button>' : ''}<button type="submit" class="btn primary">${esc(opts.submitLabel || 'Submit')}</button></div>`);

    function read() {
      for (const f of fields) {
        if (f.type === 'heading' || f.type === 'calc') continue;
        if (f.type === 'radio') { const c = root.querySelector(`input[name="${CSS.escape(f.key)}"]:checked`); raw[f.key] = c ? c.value : null; continue; }
        const inp = root.querySelector(`[name="${CSS.escape(f.key)}"]`);
        if (!inp) continue;
        if (f.type === 'checkbox') raw[f.key] = inp.checked;
        else if (f.type === 'number') raw[f.key] = inp.value === '' ? null : Number(inp.value);
        else if (f.type === 'person' || f.type === 'record' || f.type === 'file') raw[f.key] = inp.value === '' ? null : Number(inp.value);
        else raw[f.key] = inp.value === '' ? null : inp.value;
      }
    }
    function linked() {
      const out = {};
      for (const f of fields) {
        if (f.type !== 'person' && f.type !== 'record') continue;
        const o = (options[f.key] || []).find(x => x.id === raw[f.key]);
        if (!o) continue;
        out[f.key + '_label'] = o.name;
        for (const [k, val] of Object.entries(o.data || {})) out[f.key + '.' + k] = val;
      }
      return out;
    }
    function refresh() {
      state = FB.logic.compute(fields, raw, context, linked());
      for (const f of fields) {
        const box = root.querySelector(`[data-key="${CSS.escape(f.key)}"]`);
        if (!box) continue;
        box.hidden = !state.visible[f.key];
        if (f.type === 'calc') {
          const v = state.values[f.key];
          const d = f.decimals != null && f.decimals !== '' ? Number(f.decimals) : 2;
          $('output', box).textContent = v == null ? '–' : typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
        }
      }
    }
    function validate() {
      read(); refresh();
      const errors = FB.logic.validate(fields, state.values, state.visible, state.ctx);
      for (const f of fields) {
        const box = root.querySelector(`.ff[data-key="${CSS.escape(f.key)}"]`);
        if (!box) continue;
        $('.err', box).textContent = errors[f.key] || '';
        box.classList.toggle('invalid', !!errors[f.key]);
      }
      const formErrors = Object.keys(errors).length ? [] : FB.logic.checks(form, state.ctx);
      const banner = $('.form-errors', root);
      banner.innerHTML = formErrors.map(m => `<div>⚠ ${esc(m)}</div>`).join(''); banner.hidden = !formErrors.length;
      return !Object.keys(errors).length && !formErrors.length;
    }
    const input = () => { const out = {}; for (const f of fields) if (f.type !== 'heading' && f.type !== 'calc') out[f.key] = raw[f.key] ?? null; return out; };

    root.addEventListener('input', () => { read(); refresh(); });
    root.addEventListener('change', () => { read(); refresh(); });
    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) {
        toast($('.form-errors', root).textContent.replace('⚠', '').trim() || 'Please check the highlighted fields.', 'error');
        const bad = $('.invalid, .form-errors:not([hidden])', root); if (bad) bad.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (!opts.onSubmit) return;
      const btn = $('button[type=submit]', root); btn.disabled = true;
      try { await opts.onSubmit(input(), state.values); }
      catch (err) { if (!FB.showServerErrors(root, err)) toast(err.message, 'error'); }
      finally { btn.disabled = false; }
    });
    const cancel = $('[data-cancel]', root); if (cancel) cancel.onclick = () => opts.onCancel();

    // file fields: upload at once (the file waits until the form is saved), show its name, allow removing it
    for (const box of $$('[data-file]', root)) {
      const key = box.dataset.file, hidden = $('input[type=hidden]', box), pick = $('input[type=file]', box), clear = $('[data-fclear]', box), nameEl = $('.file-name', box);
      if (!pick) continue;
      pick.onchange = async () => {
        const file = pick.files[0]; if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast('Files can be at most 10 MB.', 'error'); pick.value = ''; return; }
        nameEl.innerHTML = '<span class="muted">Uploading…</span>';
        try {
          const r = await fetch('/api/files?name=' + encodeURIComponent(file.name) + '&type=' + encodeURIComponent(file.type || ''), { method: 'POST', headers: { 'x-ordovia': '1' }, credentials: 'same-origin', body: file });
          const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
          hidden.value = d.id; raw[key + '_label'] = d.name; nameEl.innerHTML = `<a href="/api/files/${d.id}" target="_blank" rel="noopener">${esc(d.name)}</a> <span class="muted small">${FB.ui.fmtSize(d.size)}</span>`; clear.hidden = false; read(); refresh();
        } catch (err) { nameEl.innerHTML = '<span class="muted">No file chosen</span>'; hidden.value = ''; toast(err.message, 'error'); }
        pick.value = '';
      };
      clear.onclick = () => { hidden.value = ''; delete raw[key + '_label']; nameEl.innerHTML = '<span class="muted">No file chosen</span>'; clear.hidden = true; read(); refresh(); };
    }

    container.appendChild(root);
    read(); refresh();
    return { root, validate, input };
  };

  /** Read-only summary of stored data. */
  Forms.summary = function (form, data) {
    data = data || {};
    return `<dl class="summary">${form.fields.filter(f => f.type !== 'heading').map(f => {
      let v = data[f.key];
      if ((f.type === 'person' || f.type === 'record') && data[f.key + '_label']) v = data[f.key + '_label'];
      if (v == null) return '';
      if (f.type === 'file') return `<dt>${esc(f.label)}</dt><dd><a href="/api/files/${esc(v)}" target="_blank" rel="noopener">${esc(data[f.key + '_label'] || 'File')}</a></dd>`;
      return `<dt>${esc(f.label)}</dt><dd>${FB.ui.fmtVal(v)}</dd>`;
    }).join('')}</dl>`;
  };

  // ---------------------------------------------------------------- builder
  function newField(type, fields) {
    const base = type === 'heading' ? 'section' : type;
    let key = base, n = 2;
    while (fields.some(f => f.key === key)) key = base + '_' + n++;
    const f = { key, label: TYPES[type].label, type, required: false };
    if (type === 'select' || type === 'radio') f.options = ['Option A', 'Option B'];
    if (type === 'calc') f.formula = '';
    return f;
  }

  Forms.builder = async function (main, formId) {
    const { form, others, usedIn, usedByForms, usedInDash } = await FB.api.get('/admin/forms/' + formId);
    form.checks = form.checks || [];
    form.access = form.access || {};
    let sel = form.fields.length ? 0 : -1, dirty = false, tab = 'fields';
    const recordCache = {};

    main.innerHTML = `<div class="page page-wide">
      <div class="page-head">
        <div><a href="#/admin/forms" class="crumb">← Forms</a><input class="title-input" id="fName" value="${esc(form.name)}" aria-label="Form name"></div>
        <div class="actions"><span class="muted small">SQL view <code>form_${esc(form.slug)}</code></span>
          ${FB.org.status(form.status)}<button class="btn ghost" id="fArchive">${form.status === 'archived' ? 'Restore' : 'Archive'}</button><button class="btn danger ghost" id="fDel" ${form.status === 'archived' ? '' : 'hidden'}>Delete…</button><a class="btn" href="#/data/${form.id}">Data</a><button class="btn primary" id="fSave">Save</button></div>
      </div>
      <input class="desc-input" id="fDesc" placeholder="Description (optional)" value="${esc(form.description || '')}">
      <div id="fOrg"></div>
      <label class="check class-flag"><input type="checkbox" id="fClass" ${form.is_class ? 'checked' : ''}><span><b>This is a class of objects</b> (machine, vehicle, supplier…): every record gets its own page under Objects, and processes can work on it.</span></label>
      ${(usedIn.length || usedByForms.length || usedInDash.length) ? `<p class="muted small">Used in: ${[...usedIn.map(x => `<a href="#/admin/flows/${x.id}">${esc(x.name)}</a>${x.status === 'archived' ? ' (archived)' : ''}`), ...usedByForms.map(x => `form <a href="#/admin/forms/${x.id}">${esc(x.name)}</a>`), ...usedInDash.map(x => `dashboard <a href="#/dashboards/${x.id}">${esc(x.name)}</a>`)].join(' · ')}</p>` : '<p class="muted small">Not used anywhere yet.</p>'}
      <div class="seg tabs"><button data-tab="fields" class="on">Fields</button><button data-tab="checks">Logic checks</button><button data-tab="access">Access</button></div>
      <div id="fBody"></div></div>`;

    const touch = () => { dirty = true; $('#fSave').textContent = 'Save*'; };
    $('#fName').oninput = (e) => { form.name = e.target.value; touch(); };
    $('#fDesc').oninput = (e) => { form.description = e.target.value; touch(); };
    $('#fSave').onclick = save;
    FB.org.bar($('#fOrg'), form, {}, touch);
    $('#fClass').onchange = (e) => { form.is_class = e.target.checked ? 1 : 0; touch(); };
    $('#fArchive').onclick = async () => {
      form.status = form.status === 'archived' ? 'active' : 'archived';
      if (form.status === 'archived' && !confirm('Archive this form? Nobody can add records to it any more; the data stays and can be restored.')) { form.status = 'active'; return; }
      await save(); FB.render();
    };
    $('#fDel').onclick = async () => {
      if (!confirm(`Delete form “${form.name}” and ALL its records for good? This cannot be undone.`)) return;
      try { await FB.api.del('/admin/forms/' + form.id); await FB.loadMeta(); FB.go('#/admin/forms'); } catch (e) { toast(e.message, 'error'); }
    };
    $$('[data-tab]', main).forEach(b => b.onclick = () => { tab = b.dataset.tab; $$('[data-tab]', main).forEach(x => x.classList.toggle('on', x === b)); drawBody(); });
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
    const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('keydown', onKey); window.addEventListener('beforeunload', beforeUnload);
    FB.cleanup.push(() => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); });

    async function save() {
      if (!form.name.trim()) { toast('Give the form a name', 'error'); return; }
      const problems = FB.logic.lint(form);
      if (problems.length) { toast(problems[0], 'error'); return; }
      try {
        await FB.api.put('/admin/forms/' + form.id, { name: form.name, description: form.description, fields: form.fields, checks: form.checks, access: form.access, area_id: form.area_id, owner_id: form.owner_id, status: form.status, is_class: form.is_class ? 1 : 0 });
        dirty = false; $('#fSave').textContent = 'Save'; toast('Form saved', 'ok'); FB.loadMeta();
      } catch (e) { toast(e.message, 'error'); }
    }

    function drawBody() {
      const body = $('#fBody');
      if (tab === 'fields') {
        body.innerHTML = `<div class="builder">
          <aside class="palette card"><h4>Add field</h4>${Object.entries(TYPES).map(([k, t]) => `<button class="pal-btn" data-add="${k}"><span class="pal-ico">${t.icon}</span>${t.label}</button>`).join('')}</aside>
          <section class="card fields-col"><h4>Fields</h4><ol id="fList" class="field-list"></ol><div id="fProps"></div></section>
          <section class="card preview-col"><h4>Live preview</h4><div id="fPreview"></div></section></div>`;
        $$('[data-add]', body).forEach(b => b.onclick = () => { form.fields.splice(sel + 1, 0, newField(b.dataset.add, form.fields)); sel++; touch(); drawList(); drawProps(); drawPreview(); });
        drawList(); drawProps(); drawPreview();
      } else if (tab === 'checks') {
        body.innerHTML = `<div class="card narrow"><h3>Logic checks</h3>
          <p class="muted">Rules across several fields, enforced on the server before anything is saved – in a process or directly. Each rule must be <b>true</b>; otherwise the message is shown.</p>
          <div id="cList"></div><button class="btn" id="cAdd">+ Add check</button>
          <div class="hint">Names: ${form.fields.filter(f => f.type !== 'heading').map(f => `<code>${esc(f.key)}</code>`).join(' ')} · linked data like <code>supplier.country</code> · process data like <code>initiator.department</code></div></div>`;
        const drawChecks = () => {
          $('#cList').innerHTML = form.checks.map((c, i) => `<div class="check-row"><input class="mono" data-c="rule" data-i="${i}" value="${esc(c.rule || '')}" placeholder="e.g. end_date >= start_date">
            <input data-c="message" data-i="${i}" value="${esc(c.message || '')}" placeholder="Message when the rule is false"><button class="icon-btn danger" data-cdel="${i}" title="Remove">×</button>
            <div class="err">${c.rule ? esc(FB.expr.check(c.rule) || '') : ''}</div></div>`).join('') || '<p class="muted">No checks yet.</p>';
          $$('[data-c]', body).forEach(inp => inp.oninput = () => { form.checks[Number(inp.dataset.i)][inp.dataset.c] = inp.value; touch(); if (inp.dataset.c === 'rule') inp.parentElement.querySelector('.err').textContent = inp.value ? (FB.expr.check(inp.value) || '') : ''; });
          $$('[data-cdel]', body).forEach(b => b.onclick = () => { form.checks.splice(Number(b.dataset.cdel), 1); touch(); drawChecks(); });
        };
        $('#cAdd').onclick = () => { form.checks.push({ rule: '', message: '' }); touch(); drawChecks(); };
        drawChecks();
      } else {
        body.innerHTML = `<div class="card narrow"><h3>Access</h3>
          <label>Who can see <b>all</b> records <small class="muted">(empty = everyone; others only see their own)</small>${multiSelect('id="aView"', FB.tagItems(), form.access.viewTags)}</label>
          <label class="check"><input type="checkbox" id="aDirect" ${form.access.direct !== false ? 'checked' : ''}><span>Records can be added directly (outside a process)</span></label>
          <label>Who can add records directly <small class="muted">(empty = everyone)</small>${multiSelect('id="aAdd"', FB.tagItems(), form.access.addTags)}</label>
          <p class="hint">Administrators can always see and edit everything. Ctrl/Cmd-click to select several tags.</p></div>`;
        const upd = () => {
          form.access = { viewTags: [...$('#aView').selectedOptions].map(o => Number(o.value)), addTags: [...$('#aAdd').selectedOptions].map(o => Number(o.value)), direct: $('#aDirect').checked };
          touch();
        };
        ['#aView', '#aAdd', '#aDirect'].forEach(s => $(s).onchange = upd);
      }
    }

    function drawList() {
      const list = $('#fList');
      list.innerHTML = form.fields.map((f, i) => `<li class="${i === sel ? 'sel' : ''}" data-i="${i}">
        <span class="pal-ico">${TYPES[f.type] ? TYPES[f.type].icon : '?'}</span>
        <span class="fl-label">${esc(f.label)}<small>${esc(f.key)}${f.required ? ' · required' : ''}${f.visibleIf ? ' · conditional' : ''}${f.validate ? ' · rule' : ''}</small></span>
        <span class="fl-actions"><button class="icon-btn" data-up="${i}" title="Move up">↑</button><button class="icon-btn" data-down="${i}" title="Move down">↓</button><button class="icon-btn danger" data-del="${i}" title="Delete">×</button></span></li>`).join('') ||
        '<li class="muted empty">Add fields from the left.</li>';
      $$('li[data-i]', list).forEach(li => li.onclick = (e) => { if (e.target.closest('button')) return; sel = Number(li.dataset.i); drawList(); drawProps(); });
      $$('[data-up]', list).forEach(b => b.onclick = () => move(Number(b.dataset.up), -1));
      $$('[data-down]', list).forEach(b => b.onclick = () => move(Number(b.dataset.down), 1));
      $$('[data-del]', list).forEach(b => b.onclick = () => { const i = Number(b.dataset.del); form.fields.splice(i, 1); sel = Math.min(sel, form.fields.length - 1); touch(); drawList(); drawProps(); drawPreview(); });
    }
    function move(i, d) { const j = i + d; if (j < 0 || j >= form.fields.length) return; [form.fields[i], form.fields[j]] = [form.fields[j], form.fields[i]]; sel = j; touch(); drawList(); drawPreview(); }

    function drawProps() {
      const box = $('#fProps');
      const f = form.fields[sel];
      if (!f) { box.innerHTML = ''; return; }
      const names = form.fields.filter(x => x !== f && x.type !== 'heading').map(x => x.key);
      const recForm = f.recordForm ? others.find(o => o.id === Number(f.recordForm)) : null;
      box.innerHTML = `<div class="props"><h4>Field settings</h4>
        <label>Label<input data-p="label" value="${esc(f.label)}"></label>
        <label>Key <small class="muted">(name in SQL &amp; formulas)</small><input data-p="key" class="mono" value="${esc(f.key)}"></label>
        <label>Type<select data-p="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        ${f.type === 'heading' ? '' : `<div class="row2"><label class="check"><input type="checkbox" data-p="required" ${f.required ? 'checked' : ''}><span>Required</span></label>
          <label class="check"><input type="checkbox" data-p="width" ${f.width === 'half' ? 'checked' : ''}><span>Half width</span></label></div>`}
        ${f.type === 'select' || f.type === 'radio' ? `<label>Options <small class="muted">(one per line)</small><textarea data-p="options" rows="4">${esc((f.options || []).join('\n'))}</textarea></label>` : ''}
        ${f.type === 'number' ? `<div class="row2"><label>Min<input type="number" data-p="min" value="${esc(f.min ?? '')}"></label><label>Max<input type="number" data-p="max" value="${esc(f.max ?? '')}"></label></div>
          <label class="check"><input type="checkbox" data-p="integer" ${f.integer ? 'checked' : ''}><span>Whole numbers only</span></label>` : ''}
        ${f.type === 'text' ? `<label>Format <small class="muted">(checked, and written in one standard way)</small><select data-p="format"><option value="">Free text</option>${Object.entries(FB.logic.FORMATS).map(([k, x]) => `<option value="${k}" ${f.format === k ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
          ${f.format ? '' : `<label>Required pattern <small class="muted">(regular expression, optional)</small><input data-p="pattern" class="mono" value="${esc(f.pattern || '')}" placeholder="e.g. ^[A-Z]{3}-[0-9]{4}$"></label>${f.pattern ? `<label>Message when it does not match<input data-p="patternMsg" value="${esc(f.patternMsg || '')}" placeholder="e.g. Use three letters, a dash and four digits"></label>` : ''}`}` : ''}
        ${['text', 'textarea', 'email'].includes(f.type) ? `<div class="row2"><label>Minimum length <small class="muted">(characters)</small><input type="number" min="0" data-p="minLength" value="${esc(f.minLength ?? '')}"></label><label>Maximum length<input type="number" min="1" data-p="maxLength" value="${esc(f.maxLength ?? '')}"></label></div>` : ''}
        ${f.type === 'date' ? `<div class="row2"><label>Earliest date <small class="muted">(formula)</small><input data-p="minDate" class="mono" value="${esc(f.minDate || '')}" placeholder="e.g. TODAY()"></label><label>Latest date <small class="muted">(formula)</small><input data-p="maxDate" class="mono" value="${esc(f.maxDate || '')}" placeholder="e.g. ADDDAYS(TODAY(), 90)"></label></div>` : ''}
        ${['text', 'textarea', 'email', 'number'].includes(f.type) ? `<label>Placeholder <small class="muted">(grey example text)</small><input data-p="placeholder" value="${esc(f.placeholder || '')}"></label>` : ''}
        ${f.type === 'file' ? '<p class="hint">People upload a file (up to 10 MB: PDF, Office, images, text). It is stored with the record and opens from the data view. Not available in public web forms.</p>' : ''}
        ${f.type === 'checkbox' ? `<label>Checkbox text<input data-p="checkLabel" value="${esc(f.checkLabel || '')}" placeholder="Yes"></label>` : ''}
        ${f.type === 'calc' ? `<label>Formula <small class="muted">e.g. quantity * unit_price</small><textarea data-p="formula" rows="2" class="mono">${esc(f.formula || '')}</textarea></label>
          <label>Decimals<input type="number" data-p="decimals" value="${esc(f.decimals ?? '')}" min="0" max="6"></label>` : ''}
        ${f.type === 'person' ? `<label>Only people with tags${multiSelect('data-p="personTags"', FB.tagItems(), f.personTags)}</label>
          <p class="hint">Formulas can read the chosen person's tags: <code>${esc(f.key)}.department</code>. A later process step can be assigned to this person.</p>` : ''}
        ${f.type === 'record' ? `<label>Linked form<select data-p="recordForm"><option value="">— choose —</option>${others.map(o => `<option value="${o.id}" ${Number(f.recordForm) === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
          ${recForm ? `<label>Show field<select data-p="recordLabel"><option value="">(automatic)</option>${recForm.fields.filter(x => x.type !== 'heading').map(x => `<option value="${esc(x.key)}" ${x.key === f.recordLabel ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
          <p class="hint">Formulas can read the linked record: ${recForm.fields.filter(x => x.type !== 'heading').slice(0, 4).map(x => `<code>${esc(f.key)}.${esc(x.key)}</code>`).join(' ')}</p>` : ''}` : ''}
        ${!['heading', 'calc'].includes(f.type) ? `<label>Default value <small class="muted">(formula)</small><input data-p="default" class="mono" value="${esc(f.default || '')}" placeholder='e.g. TODAY() or "Sales"'></label>` : ''}
        <div class="lbl-row"><b>Show this field only when</b></div><div id="visCond"></div>
        ${['text', 'textarea', 'number', 'email', 'date', 'select', 'radio', 'person', 'record'].includes(f.type) ? `<label>Validation rule <small class="muted">(formula, must be true)</small><input data-p="validate" class="mono" value="${esc(f.validate || '')}" placeholder="e.g. end_date >= start_date"></label>
          <label>Validation message<input data-p="validateMsg" value="${esc(f.validateMsg || '')}"></label>` : ''}
        <label>Help text<input data-p="help" value="${esc(f.help || '')}"></label>
        ${!['heading', 'calc', 'file'].includes(f.type) ? `<label>Take over from earlier steps <small class="muted">(enter information once)</small><select data-p="prefill"><option value="" ${f.prefill == null ? 'selected' : ''}>Automatic: when an earlier step has the same field</option><option value="yes" ${f.prefill === true ? 'selected' : ''}>Always, when an earlier step has it</option><option value="no" ${f.prefill === false ? 'selected' : ''}>Never: this is a new answer each time</option></select></label>` : ''}
        <div class="err" id="exprErr"></div>
        <div class="hint">Names: ${names.map(k => `<code>${esc(k)}</code>`).join(' ') || '–'}<br>Functions: ${FB.expr.functions.map(n => `<code>${n}</code>`).join(' ')}</div></div>`;

      const vc = $('#visCond', box);
      if (vc) FB.cond.render(vc, { expr: f.visibleIf || '', fields: form.fields.filter(x => x !== f && x.type !== 'heading' && x.key).map(x => ({ key: x.key, label: x.label || x.key, type: x.type, options: x.options })), empty: 'Always shown.',
        onChange: (x) => { if (x) f.visibleIf = x; else delete f.visibleIf; $('#exprErr', box).textContent = x ? (FB.expr.check(x) || '') : ''; touch(); drawList(); drawPreview(); } });
      $$('[data-p]', box).forEach(inp => {
        const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
          const p = inp.dataset.p;
          let v = inp.value;
          if (p === 'required') v = inp.checked;
          else if (p === 'width') v = inp.checked ? 'half' : '';
          else if (p === 'options') v = inp.value.split('\n').map(s => s.trim()).filter(Boolean);
          else if (p === 'personTags') v = [...inp.selectedOptions].map(o => Number(o.value));
          else if (p === 'recordForm') v = inp.value ? Number(inp.value) : null;
          else if (p === 'key') v = inp.value.trim();
          else if (p === 'prefill') v = inp.value === 'yes' ? true : inp.value === 'no' ? false : undefined;
          f[p] = v;
          if (p === 'type' && (v === 'select' || v === 'radio') && !f.options) f.options = ['Option A', 'Option B'];
          if (p === 'type' || p === 'recordForm') drawProps();
          if (['formula', 'visibleIf', 'default', 'validate', 'minDate', 'maxDate'].includes(p)) $('#exprErr', box).textContent = v ? (FB.expr.check(v) || '') : '';
          if (p === 'key') inp.classList.toggle('bad', !FB.logic.KEY_RE.test(v));
          touch(); drawList(); drawPreview();
        });
      });
    }

    async function previewOptions() {
      const out = {};
      for (const f of form.fields) {
        if (f.type === 'person') out[f.key] = FB.state.meta.people.filter(p => (f.personTags || []).every(t => p.tagIds.includes(Number(t)))).map(p => ({ id: p.id, name: p.name, data: FB.profileOf(p.id) }));
        if (f.type === 'record' && f.recordForm) {
          const target = others.find(o => o.id === Number(f.recordForm));
          if (!target) continue;
          if (!recordCache[target.id]) {
            const r = await FB.api.get(`/forms/${target.id}/records`).catch(() => ({ columns: [], values: [] }));
            recordCache[target.id] = r.values.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
          }
          const labelKey = f.recordLabel || (target.fields.find(x => ['text', 'email', 'select'].includes(x.type)) || {}).key;
          out[f.key] = recordCache[target.id].map(d => ({ id: d.id, name: labelKey && d[labelKey] != null ? String(d[labelKey]) : `${target.name} #${d.id}`, data: d }));
        }
      }
      return out;
    }
    let previewSeq = 0;
    async function drawPreview() {
      const seq = ++previewSeq;
      const options = await previewOptions();
      if (seq !== previewSeq) return;
      const p = $('#fPreview'); if (!p) return;
      p.innerHTML = '';
      try {
        Forms.render(p, form, { options, submitLabel: 'Test the logic', onSubmit: (data, computed) => { modal('Preview – nothing is saved', `<p class="muted">All rules passed. The server would store:</p><pre class="code">${esc(JSON.stringify(computed, null, 2))}</pre>`); } });
      } catch (e) { p.innerHTML = `<pre class="error">${esc(e.message)}</pre>`; }
    }
    drawBody();
  };
})();
