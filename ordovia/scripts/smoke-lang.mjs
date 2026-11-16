// Language: Dutch by default, English on request; per person; templates and mails follow.
// Local server with --var DATA_REGION:local :  BASE=http://127.0.0.1:8787 node scripts/smoke-lang.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };
const browser = () => {
  const jar = new Map();
  const call = async (method, path, body) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v) jar.delete(k); else jar.set(k, v); }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
};
const run = Date.now().toString(36);
const NL = browser(), EN = browser(); let r;

console.log('Dutch is the default');
r = await NL.post('/api/setup', { company: 'Taal BV', name: 'Tessa', email: `tessa.${run}@taal.test`, password: 'password123' }); ok(r.status === 200, 'a company signs up without choosing a language');
r = await NL.get('/api/session'); ok(r.data.settings.lang === 'nl', 'its language is Dutch', r.data.settings);
r = await EN.post('/api/setup', { company: 'Language Ltd', name: 'Eve', email: `eve.${run}@lang.test`, password: 'password123', lang: 'en' }); ok(r.status === 200, 'another chooses English');
r = await EN.get('/api/session'); ok(r.data.settings.lang === 'en', 'its language is English');

console.log('a person can choose their own');
r = await NL.post('/api/me/language', { lang: 'xx' }); ok(r.status === 400, 'only nl and en');
r = await NL.get('/api/session'); ok(!r.data.user.lang, 'by default the person follows the company');
r = await NL.post('/api/me/language', { lang: 'en' }); ok(r.status === 200, 'she chooses English for herself');
r = await NL.get('/api/session'); ok(r.data.user.lang === 'en' && r.data.settings.lang === 'nl', 'the choice is hers; the company default stays', r.data);
r = await NL.post('/api/me/language', { lang: 'nl' });

console.log('templates come in the language of the person');
r = await NL.post('/api/admin/areas', { name: 'Veiligheid' });
r = await NL.post('/api/admin/templates/incident/preview', { area: 'Veiligheid' }); ok(r.status === 200 && JSON.stringify(r.data).includes('Incidentmelding'), 'the Dutch preview speaks Dutch', JSON.stringify(r.data).slice(0, 200));
r = await NL.post('/api/admin/templates/incident/apply', { area: 'Veiligheid' }); ok(r.status === 200, 'a Dutch template is added as a draft', r);
r = await NL.get('/api/admin/forms'); const forms = r.data.forms || r.data;
ok(forms.some(f => f.name === 'Incidentmelding') && !forms.some(f => f.name === 'Incident report'), 'its forms have Dutch names', forms.map(f => f.name));
const f = forms.find(x => x.name === 'Incidentmelding');
r = await NL.get('/api/admin/forms/' + f.id); const fields = r.data.fields || (r.data.form && r.data.form.fields) || [];
const kind = fields.find(x => x.key === 'kind'); ok(kind && kind.options.includes('Bijna-ongeval') && fields.find(x => x.key === 'title').label === 'Korte omschrijving', 'with Dutch labels and options, same field keys', fields.map(x => x.key + ':' + x.label).slice(0, 4));
r = await NL.get('/api/admin/flows'); const flows = r.data.flows || r.data; ok(flows.some(x => x.name === 'Incidentmelding & corrigerende maatregel'), 'and a Dutch process', flows.map(x => x.name));
r = await EN.post('/api/admin/templates/incident/apply', {}); ok(r.status === 200, 'the English company adds the same template');
r = await EN.get('/api/admin/forms'); ok((r.data.forms || r.data).some(x => x.name === 'Incident report'), 'in English');

console.log('mails follow the language');
r = await NL.post('/api/admin/people', { name: 'Jan Nieuw', email: `jan.${run}@taal.test`, is_admin: false, active: true }); ok(r.status === 200 && r.data.invite.sent, 'an invitation goes out');
r = await EN.post('/api/admin/people', { name: 'Joe New', email: `joe.${run}@lang.test`, is_admin: false, active: true });
const box = (await browser().get('/api/dev/outbox')).data;
const jan = box.find(x => x.to_addr === `jan.${run}@taal.test`), joe = box.find(x => x.to_addr === `joe.${run}@lang.test`);
ok(jan && /heeft je uitgenodigd/.test(jan.body) && /je Ordovia-account/.test(jan.subject), 'in Dutch for the Dutch company', jan && jan.subject);
ok(joe && /has invited you/.test(joe.body), 'in English for the English one', joe && joe.subject);

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
