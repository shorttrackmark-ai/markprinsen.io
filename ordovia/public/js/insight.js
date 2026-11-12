/* Ordovia process insight: how one process performs. Cycle time, where cases wait, how they end, how often steps run late.
 * Only per process (not general business intelligence): this is what only Ordovia knows. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $ } = FB.ui;
  const api = FB.api;

  const dur = (h) => (h == null ? '–' : h < 1 ? '< 1 hour' : h < 48 ? Math.round(h * 10) / 10 + ' hours' : Math.round(h / 24 * 10) / 10 + ' days');
  const tile = (value, label, tone) => `<div class="card kpi-card ${tone || ''}"><div class="kpi-value">${value}</div><div class="kpi-cap">${esc(label)}</div></div>`;
  const NEGATIVE = /reject|not approved|denied|declin|out of service|needs rework/i;

  FB.route('/handbook/:id/insight', async (main, { id }) => {
    const d = await api.get('/flows/' + Number(id) + '/insight');
    const maxWait = Math.max(1, ...d.steps.map(s => s.avgHours || 0)), maxMonth = Math.max(1, ...d.months.map(m => m.cases));
    main.innerHTML = `<div class="page"><div class="page-head"><div><a class="crumb" href="#/handbook/${Number(id)}">← ${esc(d.name)}</a><h1>Performance</h1>
      <p class="muted">How this process really runs, from every case so far${d.based ? ` (${d.based} finished)` : ''}. Use it to find where work waits and what to simplify.</p></div></div>
      <div class="kpi-row">${tile(d.runs.total, 'cases in total')}${tile(d.runs.running, 'running now')}${tile(dur(d.cycle.medianHours), 'typical time to finish (median)')}${tile(dur(d.cycle.p90Hours), '9 in 10 finish within')}${tile(d.lateRate + '%', 'of steps took longer than planned', d.lateRate >= 25 ? 'bad' : '')}${d.casesAgain ? tile(d.casesAgain, 'cases came back for correction') : ''}${d.runs.stuck ? tile(d.runs.stuck, 'stuck (needs a fix)', 'bad') : ''}</div>
      <h2>Where cases wait <span class="count">${d.steps.length}</span></h2>
      ${d.steps.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Step</th><th>Average wait</th><th></th><th class="num">Done</th><th class="num">Open</th><th class="num">Took longer</th><th class="num">Done again</th></tr></thead><tbody>${d.steps.map((s, i) => `<tr><td><b>${esc(s.name)}</b>${i === 0 && s.avgHours ? ' <span class="status s-draft">slowest</span>' : ''}</td><td>${esc(dur(s.avgHours))}</td><td class="bar-cell"><span class="hb-track"><span class="hb-bar" style="width:${Math.round(100 * (s.avgHours || 0) / maxWait)}%"></span></span></td><td class="num">${s.done}</td><td class="num">${s.open}</td><td class="num ${s.late ? 'warn-text' : ''}">${s.late}${s.late ? ` (${s.lateRate}%)` : ''}</td><td class="num ${s.again ? 'warn-text' : ''}">${s.again || ''}</td></tr>`).join('')}</tbody></table></div><p class="small muted">Wait = from the moment a step is given to someone until it is done. “Done again” counts how often a step had to be repeated in a case because information came back for correction; if a step shows it often, look at the form or the instructions of the step before it.</p>` : '<p class="muted">No steps have been done yet.</p>'}
      <div class="two-col"><div><h2>How cases end</h2>${d.outcomes.length ? `<div class="hbars">${d.outcomes.map(o => `<div class="hb-row"><span class="hb-label">${esc(o.name)}</span><span class="hb-track"><span class="hb-bar ${NEGATIVE.test(o.name) ? 'neg' : ''}" style="width:${o.pct}%"></span></span><span class="hb-val">${o.n} · ${o.pct}%</span></div>`).join('')}</div>` : '<p class="muted">No case has finished yet.</p>'}</div>
      <div><h2>Cases per month</h2><div class="hbars">${d.months.map(m => `<div class="hb-row"><span class="hb-label">${esc(m.month)}</span><span class="hb-track"><span class="hb-bar" style="width:${Math.round(100 * m.cases / maxMonth)}%"></span></span><span class="hb-val">${m.cases}</span></div>`).join('')}</div></div></div>
      ${d.cycle.fastestHours != null ? `<p class="small muted">Fastest case ${esc(dur(d.cycle.fastestHours))}, slowest ${esc(dur(d.cycle.slowestHours))}, average ${esc(dur(d.cycle.avgHours))}.</p>` : ''}</div>`;
  });
})();
