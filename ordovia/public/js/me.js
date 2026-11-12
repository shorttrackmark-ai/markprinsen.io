/* "What Ordovia knows about me": every person can see what is recorded about them, why, and download it. Part of the promise: no hidden tracking. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, fmtDate, download } = FB.ui;
  const api = FB.api;

  FB.route('/me', async (main) => {
    const d = await api.get('/me/data');
    const p = d.person;
    const list = (items, fn, empty) => (items.length ? `<ul class="plain-list">${items.slice(0, 12).map(fn).join('')}</ul>${items.length > 12 ? `<p class="small muted">…and ${items.length - 12} more (all of them are in the download).</p>` : ''}` : `<p class="muted small">${empty}</p>`);
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>What Ordovia knows about you</h1><p class="muted">${esc(d.about)}</p></div>
      <div class="actions"><button class="btn primary" id="meDl">Download all of it</button></div></div>
      <div class="two-col"><div>
        <h2>Your profile</h2><div class="card"><dl class="summary"><dt>Name</dt><dd>${esc(p.name)}</dd><dt>E-mail</dt><dd>${esc(p.email)}</dd><dt>Member since</dt><dd>${esc(fmtDate(p.since))}</dd>
          <dt>Tags</dt><dd>${p.tags.length ? p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ') : '–'}</dd>
          ${Object.entries(p.attributes).map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(String(v))}</dd>`).join('')}
          <dt>Away</dt><dd>${p.away_until ? `until ${esc(p.away_until)}${p.deputy ? ', ' + esc(p.deputy) + ' covers' : ''}` : 'no'}</dd></dl>
          <p class="small muted">Tags and attributes decide which tasks reach you and what you may see. An administrator keeps them up to date.</p></div>
        <h2>Tasks <span class="count">${d.tasks.completed.length}</span></h2><div class="card"><p class="small">${d.tasks.waiting_for_you} waiting for you now.</p>${list(d.tasks.completed, t => `<li><a href="#/task/${t.id}">${esc(t.name)}</a> <span class="muted small">· ${esc(t.case_title)} · ${esc(fmtDate(t.completed_at))}</span></li>`, 'You have not completed a task yet.')}
          <p class="small muted">Why: so each case shows who did which step, as the record of the process.</p></div>
        <h2>Cases you started <span class="count">${d.cases_started.length}</span></h2><div class="card">${list(d.cases_started, c => `<li><a href="#/processes/${c.id}">${esc(c.title)}</a> <span class="muted small">· ${esc(c.status)} · ${esc(fmtDate(c.created_at))}</span></li>`, 'None.')}</div>
      </div><div>
        <h2>Information you entered <span class="count">${d.information_entered.length}</span></h2><div class="card">${list(d.information_entered, r => `<li>${esc(r.form)} <span class="muted small">· ${esc(fmtDate(r.entered))}${r.case_id ? ` · <a href="#/processes/${r.case_id}">case ${r.case_id}</a>` : ''}</span></li>`, 'Nothing yet.')}
          <p class="small muted">Why: the data you put in forms is the shared, single source for the company. The full content is in the download.</p></div>
        <h2>Files, documents and processes</h2><div class="card"><p class="small"><b>${d.files_uploaded.length}</b> files uploaded · <b>${d.documents_you_own.length}</b> documents you own · <b>${d.processes_you_own.length}</b> processes you own</p>
          ${list(d.processes_you_own, f => `<li><a href="#/handbook/${f.id}">${esc(f.name)}</a> <span class="muted small">(${esc(f.status)})</span></li>`, '')}</div>
        <h2>Sign-ins and access</h2><div class="card"><p class="small"><b>${d.sign_ins.active}</b> active sign-in${d.sign_ins.active === 1 ? '' : 's'} · <b>${d.api_tokens_acting_as_you.length}</b> API token${d.api_tokens_acting_as_you.length === 1 ? '' : 's'} that act as you.</p>
          <p class="small muted">Ordovia records when something is <i>done</i> in a process. It does not record what you look at, how long you take to type, or what you do outside it.</p></div>
        ${d.changes_made_by_you_as_builder.length ? `<h2>Changes you made as a builder <span class="count">${d.changes_made_by_you_as_builder.length}</span></h2><div class="card">${list(d.changes_made_by_you_as_builder, a => `<li>${esc(a.action)} ${esc(a.entity)} <b>${esc(a.name || '')}</b> <span class="muted small">· ${esc(fmtDate(a.at))}</span></li>`, '')}</div>` : ''}
      </div></div>
      <p class="small muted">Something wrong or out of date? Ask your administrator to correct it. Records that belong to a finished case stay as they are, because the case is a record of what happened.</p></div>`;
    $('#meDl', main).onclick = () => download('ordovia-my-data.json', JSON.stringify(d, null, 2), 'application/json');
  });
})();
