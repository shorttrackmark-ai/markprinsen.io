/* Ordovia links: connect anything to anything. One panel, used everywhere: on a document, an object, a process, a step.
 * Both ends show the link, so a document lists where it is used and a step lists what it needs. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, toast, modal } = FB.ui;
  const api = FB.api;
  const Org = FB.org;

  /** One linked item as a list entry: picture, kind, name (a link), the part that matters (chapter, page), the condition, and a remove button. */
  Org.linkItem = (it, canEdit) => `<li class="link-item ${it.gone ? 'gone' : ''}">${it.image ? `<img class="link-thumb" src="/api/files/${esc(it.image)}" alt="" loading="lazy">` : ''}
    <span class="link-body"><span class="link-kind">${esc(it.kind || (it.gone ? 'Removed' : ''))}</span> <a href="${esc(it.href || '#/')}"><b>${esc(it.label)}</b></a>${it.sub_label ? ` <span class="muted">› ${esc(it.sub_label)}</span>` : ''}${it.note ? ` <span class="doc-section">› ${esc(it.note)}</span>` : ''}${it.showIf ? ` <span class="small muted">· only when <code>${esc(it.showIf)}</code></span>` : ''}${it.derived ? ' <span class="small muted">· set in the flow</span>' : ''}</span>
    ${canEdit && it.linkId ? `<button type="button" class="icon-btn danger" data-unlink="${it.linkId}" title="Remove this link">×</button>` : ''}</li>`;
  /** A read-only list of linked items (task page, handbook steps). */
  Org.linkList = (items) => (items && items.length ? `<ul class="link-list">${items.map(i => Org.linkItem(i, false)).join('')}</ul>` : '');

  /**
   * The links panel. ref = { type: 'document' | 'object' | 'flow', id, sub }.
   * opts: { title, bare (no heading), canEdit (default: what the server says), outLabel, inLabel, allowFlowSteps }
   */
  Org.links = async (host, ref, opts) => {
    opts = opts || {};
    const q = `type=${encodeURIComponent(ref.type)}&id=${Number(ref.id)}${ref.sub ? '&sub=' + encodeURIComponent(ref.sub) : ''}`;
    const d = await api.get('/links?' + q);
    const canEdit = opts.canEdit === undefined ? d.canEdit : opts.canEdit && d.canEdit;
    const total = d.out.length + d.in.length;
    host.innerHTML = `<div class="links-panel">${opts.bare ? '' : `<h2>${esc(opts.title || 'Links')} <span class="count">${total}</span></h2>`}
      ${d.out.length ? `<h4>${esc(opts.outLabel || 'Refers to')}</h4><ul class="link-list">${d.out.map(i => Org.linkItem(i, canEdit)).join('')}</ul>` : ''}
      ${d.in.length ? `<h4>${esc(opts.inLabel || 'Referred to by')}</h4><ul class="link-list">${d.in.map(i => Org.linkItem(i, canEdit)).join('')}</ul>` : ''}
      ${total ? '' : '<p class="muted small">Nothing linked yet.</p>'}
      ${canEdit ? '<button type="button" class="btn small" data-addlink>+ Link</button>' : ''}</div>`;
    const refresh = () => Org.links(host, ref, opts);
    $$('[data-unlink]', host).forEach(b => b.onclick = async () => { try { await api.del('/links/' + b.dataset.unlink); refresh(); } catch (e) { toast(e.message, 'error'); } });
    const add = $('[data-addlink]', host);
    if (add) add.onclick = () => pick(ref, refresh);
  };

  /** Search for the other end, choose the part that matters, and optionally when it applies. */
  function pick(ref, done) {
    const m = modal('Link to…', `<div class="row2"><label>What<select id="lkType"><option value="">Everything</option><option value="document">Documents &amp; photos</option><option value="object">Objects</option><option value="flow">Processes &amp; steps</option></select></label>
      <label>Search<input id="lkQ" type="search" placeholder="name…" autocomplete="off"></label></div>
      <div id="lkResults" class="lk-results"></div>
      <form id="lkForm" hidden><p>Linking to <b id="lkChosen"></b></p>
        <label id="lkStepRow" hidden>Which step? <small class="muted">(optional)</small><select id="lkStep"></select></label>
        <label>Which part matters? <small class="muted">(chapter, page, remark – optional)</small><input id="lkNote" maxlength="120" placeholder="e.g. Chapter 4.2 – Cleaning"></label>
        <label>Only when <small class="muted">(formula over the data of the process – optional)</small><input id="lkIf" class="mono" maxlength="300" placeholder="e.g. total_incl > 1000"></label>
        <div class="form-actions"><button type="button" class="btn ghost" id="lkBack">Back</button><button class="btn primary">Link</button></div></form>`, { wide: true });
    const root = m.root;
    let timer = null, chosen = null, last = [];
    const search = async () => {
      const r = await api.get(`/link-search?type=${encodeURIComponent($('#lkType', root).value)}&q=${encodeURIComponent($('#lkQ', root).value)}`);
      last = r.results.filter(x => !(x.type === ref.type && x.id === Number(ref.id) && !ref.sub));
      $('#lkResults', root).innerHTML = last.length ? `<ul class="link-list">${last.map((x, i) => `<li class="link-item"><button type="button" class="lk-pick" data-i="${i}">${x.image ? `<img class="link-thumb" src="/api/files/${esc(x.image)}" alt="">` : ''}<span class="link-kind">${esc(x.kind)}</span> <b>${esc(x.label)}</b></button></li>`).join('')}</ul>` : '<p class="muted">Nothing found.</p>';
      $$('.lk-pick', root).forEach(b => b.onclick = () => choose(last[Number(b.dataset.i)]));
    };
    const choose = (x) => {
      chosen = x;
      $('#lkChosen', root).textContent = x.kind + ': ' + x.label;
      const steps = x.steps || [];
      $('#lkStepRow', root).hidden = !steps.length;
      $('#lkStep', root).innerHTML = '<option value="">The whole process</option>' + steps.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
      $('#lkResults', root).hidden = true; $('.row2', root).hidden = true; $('#lkForm', root).hidden = false;
      $('#lkNote', root).focus();
    };
    $('#lkBack', root).onclick = () => { $('#lkForm', root).hidden = true; $('#lkResults', root).hidden = false; $('.row2', root).hidden = false; };
    $('#lkQ', root).oninput = () => { clearTimeout(timer); timer = setTimeout(search, 200); };
    $('#lkType', root).onchange = search;
    $('#lkForm', root).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.post('/links', { a: { type: ref.type, id: Number(ref.id), sub: ref.sub || null }, b: { type: chosen.type, id: chosen.id, sub: $('#lkStep', root).value || null }, note: $('#lkNote', root).value, showIf: $('#lkIf', root).value });
        m.close(); toast('Linked', 'ok'); done();
      } catch (err) { toast(err.message, 'error'); }
    };
    search();
    $('#lkQ', root).focus();
  }
})();
