// The website: landing and pricing in two languages, the app under /app/, the plans from one place, the legal pages and the status page.
// BASE=http://127.0.0.1:8787 node scripts/smoke-site.mjs   (any server; read-only)
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };
const page = async (path) => { const r = await fetch(BASE + path, { redirect: 'follow' }); return { status: r.status, text: await r.text(), headers: r.headers, url: r.url }; };

console.log('the pages');
let r = await page('/'); ok(r.status === 200 && /lang="nl"/.test(r.text) && /Het procedurehandboek dat echt draait/.test(r.text), 'the Dutch landing page is at the root', r.status);
ok(/\/app\/#\/signup/.test(r.text) && /\/app\/#\/try/.test(r.text) && /data-plans/.test(r.text), 'with Start free, Try the example and the plans');
ok((r.text.match(/\/img\/app-[a-z]+\.png/g) || []).length >= 3, 'and three screenshots');
r = await page('/en/'); ok(r.status === 200 && /lang="en"/.test(r.text) && /The process handbook that actually runs/.test(r.text), 'the English one is under /en/');
r = await page('/prijzen'); ok(r.status === 200 && /Eén vast bedrag per bedrijf/.test(r.text), 'Dutch pricing page');
r = await page('/en/pricing'); ok(r.status === 200 && /One fixed price per company/.test(r.text), 'English pricing page');
for (const p of ['/img/app-taken.png', '/img/app-proces.png', '/img/app-dashboard.png']) { const x = await fetch(BASE + p); ok(x.status === 200 && /png/.test(x.headers.get('content-type')), p + ' is served'); }
r = await page('/app/'); ok(r.status === 200 && /id="main"/.test(r.text) && /src="\/js\/app\.js/.test(r.text), 'the app is at /app/ with absolute asset paths');
for (const p of ['/js/app.js', '/js/nl.js', '/css/app.css', '/site.css', '/site.js']) { const x = await fetch(BASE + p); ok(x.status === 200, p + ' is served'); }
r = await page('/app/#/signup'); ok(r.status === 200, 'the sign-up entrance opens the app');

console.log('legal and status');
for (const p of ['/legal/terms.nl.html', '/legal/terms.en.html', '/legal/privacy.nl.html', '/legal/privacy.en.html', '/legal/dpa.nl.html', '/legal/dpa.en.html']) {
  r = await page(p); ok(r.status === 200 && /CONCEPT|DRAFT/.test(r.text) && /legal\.css/.test(r.text), p + ' is there and marked as a draft');
}
r = await page('/status.html'); ok(r.status === 200 && /status\.js/.test(r.text), 'the status page');

console.log('plans from one place');
r = await fetch(BASE + '/api/plans'); const d = await r.json();
ok(r.status === 200 && d.trialDays === 14 && d.tiers.map(t => t.id).join() === 'small,team,business,enterprise', 'four plans and the trial length', d);
ok(d.tiers.every(t => t.priceEur === null), 'prices that are still placeholders are not shown on the website', d.tiers.map(t => t.priceEur));
ok(d.tiers[0].maxPeople === 10 && d.tiers[3].maxPeople === null && d.tiers[3].contact, 'with the number of people per plan');

console.log('headers');
r = await fetch(BASE + '/');
ok(/default-src 'self'/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-frame-options') === 'DENY', 'the strict browser rules apply to the website too');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
