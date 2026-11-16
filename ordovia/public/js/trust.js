/* Trust: take your data away, back-ups, restoring, leaving – and quiet reports of problems in the browser. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, toast, modal, fmtDate } = FB.ui;
  const api = FB.api;

  /** The three cards on the Settings page. */
  FB.trustCards = async (host) => {
    const demo = FB.state.settings.demoSite;
    const backups = demo ? [] : await api.get('/admin/backups').catch(() => []);
    const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
    host.innerHTML = `
      <div class="card narrow"><h3>Your data</h3>
        <p class="muted">Everything of your company is stored in its own database in the EU. Take it all with you at any time: one ZIP with all data (data.json), every register as a CSV file for Excel, and all uploaded files. Passwords are not included.</p>
        ${demo ? '<p class="muted">Not in the example.</p>' : '<a class="btn primary" href="/api/admin/export.zip" download>Download everything (ZIP)</a>'}</div>
      <div class="card narrow"><h3>Back-ups</h3>
        <p class="muted">Every night a back-up is made and kept for 30 days. Restoring puts the company back as it was at that moment: later changes are lost, and everybody has to sign in again. Right before a restore a copy of the current state is kept as well.</p>
        ${demo ? '' : `<p><button class="btn" id="bkNow">Back up now</button></p>
        ${backups.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Back-up</th><th>Size</th><th></th></tr></thead><tbody>${backups.map(b => `<tr><td>${esc(b.name)}</td><td>${size(b.size)}</td><td><button class="btn small" data-restore="${esc(b.name)}">Restore…</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No back-ups yet; the first one is made tonight.</p>'}`}</div>
      <div class="card narrow danger-zone"><h3>Leave Ordovia</h3>
        <p class="muted">Delete the company with all its data, files and back-ups, for good. This cannot be undone. Download the ZIP above first. Your subscription (if any) is stopped.</p>
        ${demo ? '' : '<button class="btn danger" id="delCo">Delete the company…</button>'}</div>`;
    const company = FB.state.settings.company || '';
    const confirmBox = (title, intro, button, go) => {
      const m = modal(title, `<form id="cf"><p>${intro}</p><label>Type the name of the company to confirm: <b>${esc(company)}</b><input name="confirm" autocomplete="off" required></label>
        <div class="form-actions"><button class="btn danger">${button}</button></div></form>`);
      $('#cf', m.root).onsubmit = async (e) => { e.preventDefault(); try { await go(e.target.confirm.value); m.close(); } catch (err) { toast(err.message, 'error'); } };
    };
    const now = $('#bkNow', host);
    if (now) now.onclick = async () => { try { await api.post('/admin/backups', {}); toast('Back-up made', 'ok'); FB.render(); } catch (err) { toast(err.message, 'error'); } };
    $$('[data-restore]', host).forEach(b => b.onclick = () => confirmBox('Restore ' + b.dataset.restore,
      'The company goes back to how it was in this back-up. Everything changed since is lost, and everybody has to sign in again.', 'Restore',
      async (confirm) => { await api.post('/admin/restore', { name: b.dataset.restore, confirm }); toast('Restored. Please sign in again.', 'ok'); setTimeout(() => location.reload(), 800); }));
    const del = $('#delCo', host);
    if (del) del.onclick = () => confirmBox('Delete the company', 'All data, files and back-ups are removed for good. This cannot be undone.', 'Delete everything',
      async (confirm) => { await api.post('/admin/delete-company', { confirm }); toast('The company has been deleted.', 'ok'); setTimeout(() => { location.hash = '#/'; location.reload(); }, 1200); });
  };

  /** Legal pages and status, in the reader's language. */
  FB.legalLinks = () => {
    const nl = FB.i18n.lang === 'nl', l = nl ? 'nl' : 'en';
    return `<p class="small muted center legal-links" data-notranslate><a href="/legal/terms.${l}.html" target="_blank" rel="noopener">${nl ? 'Voorwaarden' : 'Terms'}</a> · <a href="/legal/privacy.${l}.html" target="_blank" rel="noopener">Privacy</a> · <a href="/legal/dpa.${l}.html" target="_blank" rel="noopener">${nl ? 'Verwerkersovereenkomst' : 'Data processing agreement'}</a> · <a href="/status.html" target="_blank" rel="noopener">Status</a></p>`;
  };

  // problems in the browser are reported (only what went wrong and on which page), at most three per visit
  const seen = new Set();
  const report = (message) => {
    const m = String(message || '').slice(0, 200);
    if (!m || seen.has(m) || seen.size >= 3) return;
    seen.add(m);
    try { fetch('/api/client-error', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-ordovia': '1' }, body: JSON.stringify({ page: (location.hash || '#/').slice(1), message: m }) }).catch(() => {}); } catch (e) { /* ignore */ }
  };
  window.addEventListener('error', (e) => report(e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason && e.reason.message ? e.reason.message : e.reason));
  void fmtDate;
})();
