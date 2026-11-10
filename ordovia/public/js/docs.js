/* Ordovia document library: norms, policies, work instructions, templates – with versions, owners and review dates. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, fmtDate, fmtSize, toast, modal } = FB.ui;
  const api = FB.api;
  const KINDS = [['norm', 'Norm / standard'], ['policy', 'Policy'], ['procedure', 'Procedure'], ['instruction', 'Work instruction'], ['template', 'Template'], ['other', 'Other']];
  const kindLabel = (k) => (KINDS.find(x => x[0] === k) || [0, k])[1];
  const people = () => (FB.state.meta && FB.state.meta.people) || [];
  const areas = () => (FB.state.meta && FB.state.meta.areas) || [];

  /** Compact list of documents (name, kind, version, size) with a link to open each file. */
  FB.org.docLinks = (docs) => `<ul class="doc-links">${docs.map(d => `<li><a href="#/documents/${d.id}">${esc(d.name)}</a>${d.section ? ` <b class="doc-section">› ${esc(d.section)}</b>` : ''} <span class="muted small">${esc(kindLabel(d.kind))}${d.version ? ' · v' + d.version : ''}</span>${d.file_id ? ` <a class="small" href="/api/files/${d.file_id}" target="_blank" rel="noopener" title="${esc(d.file_name || '')}">open file${d.size ? ' (' + esc(fmtSize(d.size)) + ')' : ''}</a>` : ''}</li>`).join('')}</ul>`;

  async function uploadFile(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Files can be at most 10 MB.');
    const r = await fetch('/api/files?name=' + encodeURIComponent(file.name) + '&type=' + encodeURIComponent(file.type || ''), { method: 'POST', headers: { 'x-ordovia': '1' }, credentials: 'same-origin', body: file });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Upload failed');
    return d;
  }

  // ---------------------------------------------------------------- library
  FB.route('/documents', async (main) => {
    const list = await api.get('/documents');
    const st = { q: '', area: '', status: 'live', kind: '', folder: '' };
    const folders = [...new Set(list.map(d => d.folder).filter(Boolean))].sort();
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Documents</h1><p class="muted">The company library: norms, policies, work instructions and templates. Every document has an owner, a version history and a review date – and is shown at the process steps where it matters.</p></div>
      ${FB.isAdmin() ? '<div class="actions"><button class="btn primary" id="dcNew">+ Upload document</button></div>' : ''}</div>
      <div id="dcFilters"></div><div id="dcList"></div></div>`;
    const draw = () => {
      const shown = list.filter(d => FB.org.match(d, st, [d.name, d.description, d.owner, d.file_name, d.folder, kindLabel(d.kind)].join(' ')) && (!st.kind || d.kind === st.kind) && (!st.folder || (st.folder === '-' ? !d.folder : d.folder === st.folder || (d.folder || '').startsWith(st.folder + ' / '))));
      $('#dcList', main).innerHTML = FB.org.groupedCards(shown, d => d.area_id, d => `<a class="card link-card" href="#/documents/${d.id}"><h3>${esc(d.name)} ${FB.org.status(d.status)}</h3>
        <p class="small muted">${d.folder ? '📁 ' + esc(d.folder) + ' · ' : ''}${esc(kindLabel(d.kind))} · v${d.version}${d.file_name ? ' · ' + esc(d.file_name) : ''}</p>
        <p class="muted small">${d.owner ? 'Owner: ' + esc(d.owner) : 'No owner'}${d.overdue ? ' · <span class="warn-text">review due</span>' : ''}</p></a>`, 'No documents match.');
    };
    FB.org.filters($('#dcFilters', main), st, { status: FB.isAdmin(), placeholder: 'Search documents…' }, draw);
    const kindSel = document.createElement('select'); kindSel.innerHTML = '<option value="">All kinds</option>' + KINDS.map(k => `<option value="${k[0]}">${esc(k[1])}</option>`).join('');
    kindSel.onchange = () => { st.kind = kindSel.value; draw(); }; $('.filters', main).appendChild(kindSel);
    if (folders.length) {
      const folderSel = document.createElement('select'); folderSel.innerHTML = '<option value="">All folders</option>' + folders.map(x => `<option value="${esc(x)}">📁 ${esc(x)}</option>`).join('') + '<option value="-">Not in a folder</option>';
      folderSel.onchange = () => { st.folder = folderSel.value; draw(); }; $('.filters', main).appendChild(folderSel);
    }
    FB.state.docFolders = folders;
    draw();
    const nb = $('#dcNew', main); if (nb) nb.onclick = () => newDocument(st.area && st.area !== 'none' ? Number(st.area) : null);
  });

  const folderList = () => `<datalist id="dcFolders">${(FB.state.docFolders || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;

  function newDocument(areaId) {
    const m = modal('Upload document', `<form id="ndf"><label>File <small class="muted">(PDF, Word, Excel, PowerPoint, image or text; up to 10 MB)</small><input type="file" name="file" required></label>
      <label>Name<input name="name" required placeholder="e.g. ISO 9001 – quality manual"></label>
      <div class="row2"><label>Kind<select name="kind">${KINDS.map(k => `<option value="${k[0]}">${esc(k[1])}</option>`).join('')}</select></label>
      <label>Area<select name="area_id"><option value="">– none –</option>${areas().map(a => `<option value="${a.id}" ${a.id === areaId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
      <div class="row2"><label>Owner<select name="owner_id">${people().map(p => `<option value="${p.id}" ${p.id === FB.state.user.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Review every<span class="inline-unit"><input type="number" name="review_months" min="0" max="60" value="12"> months</span></label></div>
      <label>Folder <small class="muted">(optional; use “Quality / ISO 9001” for a sub-folder)</small><input name="folder" list="dcFolders" maxlength="90" placeholder="e.g. Quality">${folderList()}</label>
      <label>Description <small class="muted">(optional)</small><input name="description"></label>
      <div class="form-actions"><button class="btn primary">Upload</button></div></form>`);
    const f = $('#ndf', m.root);
    f.file.onchange = () => { if (!f.name.value && f.file.files[0]) f.name.value = f.file.files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button', f); btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        const up = await uploadFile(f.file.files[0]);
        const r = await api.post('/admin/documents', { name: f.name.value, kind: f.kind.value, area_id: f.area_id.value || null, owner_id: Number(f.owner_id.value), review_months: Number(f.review_months.value), folder: f.folder.value, description: f.description.value, fileId: up.id });
        m.close(); await FB.loadMeta(); FB.go('#/documents/' + r.id);
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Upload'; }
    };
  }

  // ---------------------------------------------------------------- one document
  FB.route('/documents/:id', async (main, { id }) => {
    const d = await api.get('/documents/' + Number(id));
    const cur = d.versions[0];
    main.innerHTML = `<div class="page"><div class="page-head"><div><a class="crumb" href="#/documents">← Documents</a><h1>${esc(d.name)} ${FB.org.status(d.status)}</h1>
      <p class="muted">${d.folder ? '📁 ' + esc(d.folder) + ' · ' : ''}${esc(kindLabel(d.kind))} · version ${d.version}${d.area ? ` · <a href="#/area/${d.area_id}">${esc(d.area)}</a>` : ''} · owner ${esc(d.owner || '–')}</p>
      ${d.reviewDue ? `<p class="small ${d.overdue ? 'warn-text' : 'muted'}">${d.overdue ? '⚠ Review was due' : 'Next review'} ${esc(d.reviewDue)}${d.reviewed_at ? ` · last reviewed ${esc(fmtDate(d.reviewed_at).slice(0, 10))}` : ''}</p>` : ''}</div>
      <div class="actions">${cur && cur.file_id ? `<a class="btn primary" href="/api/files/${cur.file_id}" target="_blank" rel="noopener">Open</a><a class="btn" href="/api/files/${cur.file_id}?download=1">Download</a>` : ''}
        ${d.canManage ? '<button class="btn" id="dvNew">Upload new version</button><button class="btn" id="dvReview">Mark as reviewed</button>' : ''}${FB.isAdmin() ? '<button class="btn ghost" id="dvEdit">Edit</button>' : ''}</div></div>
      ${d.description ? `<p>${esc(d.description)}</p>` : ''}
      <div class="two-col"><div><h3>Versions</h3><div class="table-wrap"><table class="grid"><thead><tr><th>Version</th><th>File</th><th>Uploaded</th><th>By</th><th>Note</th></tr></thead><tbody>
        ${d.versions.map(v => `<tr><td>v${v.version}</td><td>${v.file_id ? `<a href="/api/files/${v.file_id}" target="_blank" rel="noopener">${esc(v.file_name)}</a> <span class="muted small">${esc(fmtSize(v.size))}</span>` : '–'}</td><td>${esc(fmtDate(v.uploaded_at))}</td><td>${esc(v.who || '–')}</td><td class="muted small">${esc(v.note || '')}</td></tr>`).join('')}</tbody></table></div></div>
      <div><h3>Used in</h3>${d.usedIn.length ? `<ul class="doc-links">${d.usedIn.map(u => `<li><a href="#/handbook/${u.id}">${esc(u.flow)}</a> <span class="muted small">step “${esc(u.step)}”</span>${u.section ? ` <b class="doc-section">› ${esc(u.section)}</b>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Not linked to any process step yet. In a flow, select a step and choose this document under “Documents at this step”.</p>'}</div></div></div>`;
    const nv = $('#dvNew', main);
    if (nv) nv.onclick = () => {
      const m = modal('Upload new version', `<form id="nvf"><p class="muted small">The previous version stays in the history. Uploading counts as a review.</p><label>File<input type="file" name="file" required></label><label>What changed? <small class="muted">(optional)</small><input name="note"></label><div class="form-actions"><button class="btn primary">Upload</button></div></form>`);
      const f = $('#nvf', m.root);
      f.onsubmit = async (e) => { e.preventDefault(); const b = $('button', f); b.disabled = true; try { const up = await uploadFile(f.file.files[0]); await api.post(`/documents/${d.id}/versions`, { fileId: up.id, note: f.note.value }); m.close(); toast('New version saved', 'ok'); FB.render(); } catch (err) { toast(err.message, 'error'); b.disabled = false; } };
    };
    const rv = $('#dvReview', main); if (rv) rv.onclick = async () => { try { await api.post(`/documents/${d.id}/review`); toast('Marked as reviewed', 'ok'); FB.render(); } catch (e) { toast(e.message, 'error'); } };
    const ed = $('#dvEdit', main);
    if (ed) ed.onclick = () => {
      const m = modal('Edit document', `<form id="edf"><label>Name<input name="name" required value="${esc(d.name)}"></label>
        <div class="row2"><label>Kind<select name="kind">${KINDS.map(k => `<option value="${k[0]}" ${k[0] === d.kind ? 'selected' : ''}>${esc(k[1])}</option>`).join('')}</select></label>
        <label>Status<select name="status">${['draft', 'active', 'archived'].map(s => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
        <div class="row2"><label>Area<select name="area_id"><option value="">– none –</option>${areas().map(a => `<option value="${a.id}" ${a.id === d.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label>Owner<select name="owner_id"><option value="">– nobody –</option>${people().map(p => `<option value="${p.id}" ${p.id === d.owner_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
        <div class="row2"><label>Review every<span class="inline-unit"><input type="number" name="review_months" min="0" max="60" value="${d.review_months}"> months</span></label><label>Folder<input name="folder" list="dcFolders" maxlength="90" value="${esc(d.folder || '')}">${folderList()}</label></div>
        <label>Description<input name="description" value="${esc(d.description || '')}"></label>
        <div class="form-actions">${d.status === 'archived' ? '<button type="button" class="btn danger ghost" id="edDel">Delete for good…</button>' : ''}<button class="btn primary">Save</button></div></form>`);
      const f = $('#edf', m.root);
      f.onsubmit = async (e) => { e.preventDefault(); try { await api.put('/admin/documents/' + d.id, { name: f.name.value, kind: f.kind.value, status: f.status.value, area_id: f.area_id.value || null, owner_id: f.owner_id.value || null, review_months: Number(f.review_months.value), folder: f.folder.value, description: f.description.value }); m.close(); await FB.loadMeta(); toast('Saved', 'ok'); FB.render(); } catch (err) { toast(err.message, 'error'); } };
      const del = $('#edDel', m.root); if (del) del.onclick = async () => { if (confirm('Delete this document and all its versions and files for good?')) { try { await api.del('/admin/documents/' + d.id); m.close(); await FB.loadMeta(); FB.go('#/documents'); } catch (err) { toast(err.message, 'error'); } } };
    };
  });
})();
