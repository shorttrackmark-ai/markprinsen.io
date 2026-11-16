// The status page: live checks from /api/status, and an optional notice from status-notice.json (edit that file to announce maintenance or a problem).
(function () {
  'use strict';
  let lang = 'nl'; try { if (localStorage.getItem('ordovia_lang') === 'en') lang = 'en'; } catch (e) { /* ignore */ }
  document.documentElement.lang = lang;
  const T = {
    nl: { h: 'Status van Ordovia', operational: 'Alles werkt', degraded: 'Verminderde werking', outage: 'Storing', app: 'De app', database: 'Database', files: 'Bestandsopslag', up: 'werkt', down: 'storing', checked: 'Gecontroleerd', errors: 'Foutmeldingen in de laatste 24 uur', hour: 'laatste uur', fail: 'De status kon niet worden opgehaald.' },
    en: { h: 'Ordovia status', operational: 'All systems operational', degraded: 'Degraded performance', outage: 'Outage', app: 'The app', database: 'Database', files: 'File storage', up: 'working', down: 'problem', checked: 'Checked', errors: 'Error reports in the last 24 hours', hour: 'last hour', fail: 'The status could not be loaded.' },
  }[lang];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  fetch('status-notice.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(n => {
    const m = n && (n[lang] || n.nl || n.en); if (m) { $('notice').textContent = m; $('notice').hidden = false; }
  }).catch(() => {});
  fetch('/api/status', { cache: 'no-store' }).then(r => r.json()).then(d => {
    $('h').textContent = T.h + ' – ' + T[d.status];
    $('h').style.color = d.status === 'operational' ? '#1b6e3c' : '#b3261e';
    $('at').textContent = T.checked + ': ' + d.at + ' UTC';
    $('rows').innerHTML = [['app', true, null]].concat(d.components.map(c => [c.name, c.ok, c.ms])).map(([n, ok, ms]) =>
      `<tr><td>${esc(T[n] || n)}</td><td style="color:${ok ? '#1b6e3c' : '#b3261e'}">${ok ? T.up : T.down}${ms != null ? ' · ' + ms + ' ms' : ''}</td></tr>`).join('');
    $('errs').textContent = T.errors + ': ' + d.errors_24h + ' (' + T.hour + ': ' + d.errors_1h + ')';
  }).catch(() => { $('h').textContent = T.h + ' – ' + T.outage; $('at').textContent = T.fail; });
})();
