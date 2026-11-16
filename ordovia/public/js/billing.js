/* Plan & billing: the banner (trial, payment problem, read-only) and the page where an administrator chooses a plan. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, toast } = FB.ui;
  const api = FB.api;

  const eur = (n) => '€' + n;

  /** The strip at the top of a page. Everybody sees "read-only"; only administrators are nagged about plans. */
  FB.billingBar = (holder) => {
    const b = FB.state.settings && FB.state.settings.billing;
    if (!b || !b.banner) return;
    const admin = FB.isAdmin();
    const days = (n) => n + (n === 1 ? ' day' : ' days');
    const go = admin ? ' <a href="#/admin/billing"><b>Plan &amp; billing</b></a>' : ' Ask an administrator to choose a plan.';
    const text = {
      trial: admin ? `Free trial: ${days(b.daysLeft)} left.${go}` : '',
      trial_soon: admin ? `Your free trial ends in ${days(b.daysLeft)}.${go}` : '',
      trial_ended: `This workspace is read-only: the free trial has ended. You can still look at everything and export it.${go}`,
      lapsed: `This workspace is read-only: the subscription has ended. You can still look at everything and export it.${go}`,
      past_due: admin ? `The last payment did not go through. Please update the payment details within ${days(b.daysLeft)}. <a href="#/admin/billing"><b>Plan &amp; billing</b></a>` : '',
      ending: admin ? `The subscription ends in ${days(b.daysLeft)}. <a href="#/admin/billing"><b>Plan &amp; billing</b></a>` : '',
    }[b.banner];
    if (!text) return;
    const d = document.createElement('div');
    d.className = 'bill-bar ' + (['trial_ended', 'lapsed', 'past_due'].includes(b.banner) ? 'bad' : 'soft');
    d.innerHTML = text;
    holder.prepend(d);
  };

  FB.route('/admin/billing', async (main) => {
    const d = await api.get('/billing');
    const q = FB.query();
    const status = { off: 'Billing is not switched on', trial: 'Free trial', active: 'Active subscription', past_due: 'Payment problem', canceled: 'Cancelled' }[d.status] || d.status;
    const tierName = (id) => (d.tiers.find(t => t.id === id) || {}).name || '–';
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Plan &amp; billing</h1><p class="muted">One price per company, by number of people. Everybody in the company can be a user.</p></div>
      ${d.canManage ? '<div class="actions"><button class="btn" id="portal">Manage payment details &amp; invoices</button></div>' : ''}</div>
      ${q.get('done') ? '<div class="note ok">Thank you! Your subscription is being activated; this page updates in a moment.</div>' : ''}
      ${!d.on ? '<div class="card"><p>Billing is not switched on for this installation. Everything is open.</p></div>' : `
      <div class="card"><dl class="summary">
        <dt>Status</dt><dd><b>${esc(status)}</b>${d.banner === 'lapsed' || d.banner === 'trial_ended' ? ' – read-only' : ''}</dd>
        ${d.status === 'trial' ? `<dt>Free trial ends</dt><dd>${esc(String(d.trialEnds || '').slice(0, 10))}${d.daysLeft != null && d.daysLeft > 0 ? ' (' + d.daysLeft + ' days left)' : ''}</dd>` : ''}
        ${d.tier ? `<dt>Plan</dt><dd>${esc(tierName(d.tier))}${d.until ? ' · current period until ' + esc(String(d.until).slice(0, 10)) : ''}</dd>` : ''}
        <dt>People</dt><dd>${d.people} active</dd></dl></div>
      <h2>Plans</h2><div class="table-wrap"><table class="grid"><thead><tr><th>Plan</th><th>People</th><th>Price per month</th><th></th></tr></thead><tbody>
        ${d.tiers.map(t => `<tr class="${t.id === d.tier ? 'row-current' : ''}"><td><b>${esc(t.name)}</b></td><td>${t.maxPeople ? 'up to ' + t.maxPeople : 'more than 250'}</td>
          <td>${t.contact ? 'On request' : eur(t.priceEur) + (t.placeholder ? ' <span class="muted small">(placeholder)</span>' : '')}</td>
          <td>${t.contact ? '<span class="muted small">contact us</span>' : t.id === d.tier && d.status === 'active' ? '<span class="muted">your plan</span>' : t.available ? `<button class="btn small primary" data-tier="${t.id}" ${t.maxPeople && d.people > t.maxPeople ? 'disabled title="You have more people than this plan includes"' : ''}>Choose</button>` : '<span class="muted small">not orderable yet</span>'}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Prices exclude VAT; VAT is calculated at checkout. You can pay by iDEAL or SEPA direct debit. Cancel any time from the payment details page.</p>`}
      <h2>Usage this month</h2><div class="card"><dl class="summary"><dt>Active people</dt><dd>${d.usage.active_users}</dd><dt>Processes started</dt><dd>${d.usage.runs}</dd><dt>Files stored</dt><dd>${(d.usage.storage_bytes / 1048576).toFixed(1)} MB</dd></dl>
        <p class="small muted">We show this so there are no surprises. The price depends on the number of people only.</p></div></div>`;
    const jump = async (path, body, btn) => { try { btn.disabled = true; const r = await api.post(path, body); location.href = r.url; } catch (err) { btn.disabled = false; toast(err.message, 'error'); } };
    $$('[data-tier]', main).forEach(b => b.onclick = () => jump('/billing/checkout', { tier: b.dataset.tier }, b));
    const p = $('#portal', main); if (p) p.onclick = () => jump('/billing/portal', {}, p);
    if (q.get('done')) setTimeout(() => FB.loadMeta().then(() => FB.render()).catch(() => {}), 4000);
  }, { admin: true });
})();
