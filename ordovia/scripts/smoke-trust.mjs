// Trust: full export, backups, restoring, deleting a company, status and error reports.
// Local server with --var DATA_REGION:local :  BASE=http://127.0.0.1:8787 node scripts/smoke-trust.mjs
import { readZip } from '../src/zip.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };
const browser = () => {
  const jar = new Map();
  const call = async (method, path, body, headers = {}, raw) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v) jar.delete(k); else jar.set(k, v); }
    const buf = new Uint8Array(await r.arrayBuffer()); const text = new TextDecoder().decode(buf); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, buf, headers: r.headers };
  };
  return { jar, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), raw: (p, b, h) => call('POST', p, null, { 'content-type': 'application/octet-stream', ...h }, b) };
};
const run = Date.now().toString(36);
const A = browser(); let r;

console.log('a company with some data');
r = await A.post('/api/setup', { company: 'Vertrouwen BV', name: 'Vera', email: `vera.${run}@trust.test`, password: 'password123', demo: true, lang: 'en' }); ok(r.status === 200, 'signs up with the example people');
r = await A.raw('/api/files?name=notes.txt&type=text/plain', 'My notes for the export'); const fileId = r.data.id; ok(r.status === 200 && fileId, 'uploads a file');
r = await A.post('/api/admin/people', { name: 'Pia Pool', email: `pia.${run}@trust.test`, password: 'password123', is_admin: false, active: true }); ok(r.status === 200, 'adds a colleague');

console.log('the full export');
r = await A.get('/api/admin/export.zip'); ok(r.status === 200 && /zip/.test(r.headers.get('content-type')) && /attachment; filename="ordovia-vertrouwen_bv-/.test(r.headers.get('content-disposition')), 'is a ZIP download', r.headers.get('content-disposition'));
let files = await readZip(r.buf); const names = files.map(f => f.name);
ok(names.includes('README.txt') && names.includes('data.json'), 'with a readme and data.json', names.slice(0, 6));
ok(names.some(x => /^registers\/form_?.*\.csv$|^registers\//.test(x)), 'a CSV per register', names.filter(x => x.startsWith('registers/')).slice(0, 3));
const data = JSON.parse(new TextDecoder().decode(files.find(f => f.name === 'data.json').data));
ok(data.tables.persons.some(p => p.email === `pia.${run}@trust.test`) && data.tables.forms.length > 0 && data.tables.flows.length > 0 && data.tables.links, 'data.json has people, forms, processes and links');
ok(!JSON.stringify(data).includes('pbkdf2') && !JSON.stringify(data).includes('pw_hash') && !('sessions' in data.tables), 'but no password fingerprints and no sessions');
const stored = files.find(f => f.name.startsWith('files/') && /notes\.txt$/.test(f.name));
ok(stored && new TextDecoder().decode(stored.data) === 'My notes for the export', 'the uploaded file is in the export, byte for byte', names.filter(x => x.startsWith('files/')).slice(0, 4));
const csv = files.find(f => /^registers\/.*(supplier|leave)/.test(f.name)); ok(csv && csv.data[0] === 0xef && csv.data[1] === 0xbb && csv.data[2] === 0xbf && /,/.test(new TextDecoder().decode(csv.data).split('\r\n')[0]), 'CSV opens in Excel (BOM, comma for an English company)');
const colleague = browser(); await colleague.post('/api/login', { email: `pia.${run}@trust.test`, password: 'password123' });
r = await colleague.get('/api/admin/export.zip'); ok(r.status === 403, 'only an administrator can export');
r = await browser().get('/api/admin/export.zip'); ok(r.status === 401, 'and only when signed in');

console.log('backups and restoring');
r = await A.get('/api/admin/backups'); ok(r.status === 200 && Array.isArray(r.data), 'there is a list of backups');
r = await A.post('/api/admin/backups', {}); ok(r.status === 200 && /manual/.test(r.data.name), 'a backup can be made now', r.data);
const backup = r.data.name;
r = await A.get('/api/admin/backups'); ok(r.data.some(b => b.name === backup && b.size > 1000), 'and shows in the list');
r = await A.post('/api/admin/areas', { name: 'After the backup' }); ok(r.status === 200, 'something changes afterwards');
r = await A.post('/api/admin/people', { name: 'Late Comer', email: `late.${run}@trust.test`, password: 'password123', is_admin: false, active: true });
r = await A.post('/api/admin/restore', { name: backup, confirm: 'wrong name' }); ok(r.status === 400, 'restoring needs the company name typed');
r = await A.post('/api/admin/restore', { name: 'no-such-backup', confirm: 'Vertrouwen BV' }); ok(r.status === 404, 'and an existing backup');
r = await A.post('/api/admin/restore', { name: backup, confirm: 'vertrouwen bv' }); ok(r.status === 200 && r.data.rows > 100, 'the company is restored', r.data);
r = await A.get('/api/home'); ok(r.status === 401, 'everybody has to sign in again');
const A2 = browser(); r = await A2.post('/api/login', { email: `vera.${run}@trust.test`, password: 'password123' }); ok(r.status === 200, 'Vera signs in with her own password');
r = await A2.get('/api/meta'); ok(!JSON.stringify(r.data).includes('After the backup'), 'the change made after the backup is gone');
ok(r.data.forms.length > 3 && r.data.areas.length >= 3, 'the rest is back: forms and areas');
r = await A2.get('/api/admin/people'); ok(r.data.people.some(p => p.email === `pia.${run}@trust.test`) && !r.data.people.some(p => p.email === `late.${run}@trust.test`), 'Pia is back, the late comer is not');
r = await browser().post('/api/login', { email: `late.${run}@trust.test`, password: 'password123' }); ok(r.status === 401, 'the late comer cannot sign in any more');
r = await A2.get('/api/admin/backups'); ok(r.data.some(b => /^before-restore-/.test(b.name)), 'a safety copy of the state before the restore was kept');
r = await A2.get('/api/data'); r = await A2.get('/api/forms/1/records'); ok(r.status === 200, 'registers work again (their views were rebuilt)');
const C = browser(); r = await C.post('/api/setup', { company: 'Newcomer', name: 'Late', email: `late.${run}@trust.test`, password: 'password123' }); ok(r.status === 200, 'the late comer\'s address is free for a new company');

console.log('status and error reports');
r = await browser().get('/api/status'); ok(r.status === 200 && r.data.status === 'operational' && r.data.components.every(c => c.ok) && typeof r.data.errors_24h === 'number', 'the status page data says operational', r.data);
r = await browser().post('/api/client-error', { page: '/processes/12?x=1', message: 'Cannot read properties of undefined' }); ok(r.status === 200, 'the browser can report a problem');
r = await browser().get('/api/status'); ok(r.data.errors_24h >= 1, 'and it is counted');
ok(!/\?x=1|12/.test(JSON.stringify(r.data)), 'without any content');

console.log('leaving');
r = await A2.post('/api/admin/delete-company', { confirm: 'nope' }); ok(r.status === 400, 'deleting needs the company name typed');
r = await A2.post('/api/admin/delete-company', { confirm: 'Vertrouwen BV' }); ok(r.status === 200, 'the company is deleted');
r = await browser().post('/api/login', { email: `vera.${run}@trust.test`, password: 'password123' }); ok(r.status === 401, 'nobody can sign in to it any more');
r = await browser().post('/api/login', { email: `pia.${run}@trust.test`, password: 'password123' }); ok(r.status === 401, 'not the colleagues either');
r = await A2.get('/api/home'); ok(r.status === 401, 'the old session is dead');
r = await colleague.get('/api/session'); ok(r.status === 200 && r.data.user === null, 'a colleague browser that still has the old cookie just sees the sign-in page', r);
r = await colleague.get('/api/home'); ok(r.status === 401, 'and nothing else');
const D = browser(); r = await D.post('/api/setup', { company: 'Vertrouwen again', name: 'Vera', email: `vera.${run}@trust.test`, password: 'password123' }); ok(r.status === 200, 'the address can be used for a new company');
r = await D.get('/api/meta'); ok(r.data.forms.length === 0 && r.data.people.length === 1, 'which starts empty');
r = await C.get('/api/home'); ok(r.status === 200, 'another company is not affected');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
