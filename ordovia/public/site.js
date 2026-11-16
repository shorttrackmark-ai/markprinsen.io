// The website: keeps old links working, shows the plans from the one place that knows them (/api/plans), remembers the language.
(function () {
  'use strict';
  // links from before the app moved ( /#/processes/12 ) still work
  if (/^#\/./.test(location.hash)) { location.replace('/app/' + location.hash); return; }
  const lang = document.documentElement.lang === 'en' ? 'en' : 'nl';
  try { localStorage.setItem('ordovia_lang', lang); } catch (e) { /* ignore */ }
  const T = {
    nl: { upto: (n) => 'tot ' + n + ' mensen', more: 'meer dan 250 mensen', price: (p) => '€ ' + p + ' per maand', soon: 'prijs volgt binnenkort', ask: 'op aanvraag', excl: 'Prijzen zijn exclusief btw.' },
    en: { upto: (n) => 'up to ' + n + ' people', more: 'more than 250 people', price: (p) => '€ ' + p + ' per month', soon: 'price coming soon', ask: 'on request', excl: 'Prices exclude VAT.' },
  }[lang];
  const els = document.querySelectorAll('[data-plans]');
  if (!els.length) return;
  fetch('/api/plans').then(r => r.json()).then(d => {
    els.forEach(el => {
      el.innerHTML = d.tiers.map(t => `<tr><td><b>${t.name}</b></td><td>${t.maxPeople ? T.upto(t.maxPeople) : T.more}</td><td>${t.contact ? T.ask : t.priceEur ? T.price(t.priceEur) : T.soon}</td></tr>`).join('');
    });
    document.querySelectorAll('[data-trial-days]').forEach(e => { e.textContent = d.trialDays; });
  }).catch(() => {});
})();
