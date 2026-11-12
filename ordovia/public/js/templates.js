/* Ordovia templates: ready-made processes by theme. Pick one, choose the area, and it is added as a draft you can adapt. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, toast, modal } = FB.ui;
  const api = FB.api;

  FB.route('/admin/templates', async (main) => {
    const d = await api.get('/admin/templates');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Templates</h1><p class="muted">Start from a process that works, not from a blank page. A template adds a ready-made process with its forms as a <b>draft</b>: look at it, adapt it to how your company works, and activate it when it is right.</p></div>
      <div class="actions"><a class="btn" href="#/admin/ai">Describe your own with AI</a></div></div>
      ${d.packs.map(p => { const list = d.templates.filter(t => t.pack === p); return list.length ? `<h2>${esc(p)} <span class="count">${list.length}</span></h2><div class="cards">${list.map(t => `<div class="card tpl-card"><h3>${esc(t.name)} ${t.added ? '<span class="status s-active">added</span>' : ''}</h3><p class="small">${esc(t.summary)}</p>
        <p class="muted small">${t.steps} steps · forms: ${t.forms.map(esc).join(', ')}</p><div class="row-actions"><button class="btn small primary" data-tpl="${esc(t.id)}">${t.added ? 'Add again' : 'Add to my workspace'}</button></div></div>`).join('')}</div>` : ''; }).join('')}</div>`;
    $$('[data-tpl]', main).forEach(b => b.onclick = () => add(d, d.templates.find(t => t.id === b.dataset.tpl)));
  }, { admin: true });

  function add(d, t) {
    const m = modal(t.name, `<p class="muted">${esc(t.summary)}</p>
      <label>Area <small class="muted">(who it belongs to; a new area is created if it does not exist)</small><input id="tpArea" list="tpAreas" value="${esc(t.area)}"><datalist id="tpAreas">${d.areas.map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>
      <div id="tpPreview"></div>`);
    const root = m.root;
    let timer = null;
    const preview = async () => {
      const box = $('#tpPreview', root);
      let r; try { r = await api.post(`/admin/templates/${t.id}/preview`, { area: $('#tpArea', root).value }); } catch (e) { box.innerHTML = `<p class="danger-text">${esc(e.message)}</p>`; return; }
      if (!r.ok) { box.innerHTML = `<ul class="issues">${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`; return; }
      const s = r.summary;
      box.innerHTML = `<h4>This will be created <span class="status s-draft">draft</span></h4>
        ${s.flows.map(f => `<ol class="ai-outline">${f.steps.map(x => `<li><b>${esc(x.name)}</b> <span class="tag">${esc(x.type)}</span>${x.who ? ` <span class="muted">${esc(x.who)}</span>` : ''}</li>`).join('')}</ol>`).join('')}
        ${s.forms.length ? `<p class="small"><b>Forms:</b> ${s.forms.map(f => esc(f.name) + (f.isClass ? ' (class)' : '')).join(' · ')}${s.usedForms.length ? ` · <span class="muted">already in your workspace and reused: ${s.usedForms.map(esc).join(', ')}</span>` : ''}</p>` : ''}
        ${s.tags.length ? `<p class="small"><b>New tags to give to people:</b> ${s.tags.map(x => `<span class="tag">${esc(x.category)}: ${esc(x.value)}</span>`).join(' ')}<br><span class="muted">Tasks go to people with these tags, so add them under People &amp; tags.</span></p>` : ''}
        ${r.warnings.length ? `<ul class="issues">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="form-actions"><button class="btn primary" id="tpGo">Add as draft</button></div>`;
      $('#tpGo', box).onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Adding…';
        try { const x = await api.post(`/admin/templates/${t.id}/apply`, { area: $('#tpArea', root).value }); m.close(); await FB.loadMeta(); toast('Added as a draft. Adapt it and activate it when it is right.', 'ok'); FB.go('#/admin/flows/' + x.flows[0].id); }
        catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = 'Add as draft'; }
      };
    };
    $('#tpArea', root).oninput = () => { clearTimeout(timer); timer = setTimeout(preview, 300); };
    preview();
  }
})();
