// Companies: two sign-ups on one address must be completely separate.
// Run against a fresh local database:  BASE=http://127.0.0.1:8787 node scripts/smoke-tenants.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };

/** A browser: its own cookies. */
const browser = () => {
  const jar = new Map();
  const call = async (method, path, body, headers = {}, raw) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}), ...headers }, body: raw ? body : body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v) jar.delete(k); else jar.set(k, v); }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  return { jar, get: (p, h) => call('GET', p, undefined, h), post: (p, b, h) => call('POST', p, b, h), del: (p) => call('DELETE', p), raw: (p, b, h) => call('POST', p, b, { 'content-type': 'application/octet-stream', ...h }, true) };
};

const A = browser(), B = browser(), Z = browser();
let r;

console.log('two companies');
r = await Z.get('/api/session'); ok(r.data.user === null && r.data.settings.company === 'Ordovia', 'a visitor with no company sees sign-in / sign-up');
r = await Z.get('/api/home'); ok(r.status === 401, 'and nothing else');
r = await A.post('/api/setup', { company: 'Alpha BV', name: 'Alice', email: 'alice@alpha.test', password: 'alphapass1' }); ok(r.status === 200, 'company A signs up', r);
r = await B.post('/api/setup', { company: 'Beta BV', name: 'Bob', email: 'bob@beta.test', password: 'betapass12', demo: true }); ok(r.status === 200, 'company B signs up (with the example people)', r);
r = await A.get('/api/session'); ok(r.data.user && r.data.user.email === 'alice@alpha.test' && r.data.settings.company === 'Alpha BV', 'A is signed in to Alpha', r.data);
r = await B.get('/api/session'); ok(r.data.user && r.data.user.email === 'bob@beta.test' && r.data.settings.company === 'Beta BV', 'B is signed in to Beta', r.data);

console.log('what A makes, B cannot see');
r = await A.post('/api/admin/areas', { name: 'Alpha secret department' }); ok(r.status === 200, 'A makes an area', r);
r = await A.get('/api/meta'); ok(JSON.stringify(r.data).includes('Alpha secret department'), 'A sees it');
r = await B.get('/api/meta'); ok(!JSON.stringify(r.data).includes('Alpha secret department'), 'B does not');
r = await B.get('/api/home'); ok(r.status === 200 && r.data.flows.length > 0, 'B has its own example processes');
r = await A.get('/api/home'); ok(r.status === 200 && r.data.flows.length === 0, 'A starts clean');
r = await B.get('/api/admin/people'); ok(r.data.people.every(p => !/alpha/.test(p.email)), 'B\'s people list has no one from Alpha');

console.log('a session is only good inside its own company');
const aSession = A.jar.get('ordovia_session'), aTenant = A.jar.get('ordovia_tenant'), bTenant = B.jar.get('ordovia_tenant');
ok(aTenant && bTenant && aTenant !== bTenant && /^[a-f0-9]{12}$/.test(aTenant), 'each browser carries its company id', { aTenant, bTenant });
const cross = browser(); cross.jar.set('ordovia_session', aSession); cross.jar.set('ordovia_tenant', bTenant);
r = await cross.get('/api/home'); ok(r.status === 401, 'A\'s session cookie with B\'s company id is refused');
const fake = browser(); fake.jar.set('ordovia_session', aSession); fake.jar.set('ordovia_tenant', 'ffffffffffff');
r = await fake.get('/api/home'); ok(r.status === 401, 'a made-up company id is refused');

console.log('sign-in finds the right company by e-mail');
const A2 = browser();
r = await A2.post('/api/login', { email: 'alice@alpha.test', password: 'alphapass1' }); ok(r.status === 200, 'A signs in on a new device with only e-mail + password');
r = await A2.get('/api/session'); ok(r.data.settings.company === 'Alpha BV', 'and lands in Alpha');
r = await browser().post('/api/login', { email: 'alice@alpha.test', password: 'wrong' }); ok(r.status === 401, 'wrong password');
r = await browser().post('/api/login', { email: 'nobody@nowhere.test', password: 'whatever1' }); ok(r.status === 401 && r.data.error === 'Wrong e-mail or password', 'unknown e-mail gives the same answer');
r = await browser().post('/api/login', { email: 'anna@example.com', password: 'demo1234' }); ok(r.status === 401, 'example people cannot sign in without their company\'s browser');
const B2 = browser(); B2.jar.set('ordovia_tenant', bTenant);
r = await B2.post('/api/login', { email: 'anna@example.com', password: 'demo1234' }); ok(r.status === 200, 'but they can inside it');

console.log('one e-mail address, one company');
r = await browser().post('/api/setup', { company: 'Copy', name: 'Alice again', email: 'alice@alpha.test', password: 'alphapass1' }); ok(r.status === 409, 'signing up twice with the same address is refused', r);
r = await B.post('/api/admin/people', { name: 'Intruder', email: 'alice@alpha.test', password: 'password12', is_admin: false, active: true }); ok(r.status === 409, 'B cannot add A\'s address as a colleague', r);
r = await browser().post('/api/setup', { company: 'X', name: 'X', email: 'bad', password: 'password12' }); ok(r.status === 400, 'a bad address is refused');
r = await browser().post('/api/login', { email: 'zed@zed.test', password: 'password12' }); ok(r.status === 401, 'a refused sign-up left no company behind');
r = await A.post('/api/admin/people', { name: 'Carol', email: 'carol@alpha.test', password: 'carolpass12', is_admin: false, active: true }); ok(r.status === 200, 'A adds a colleague', r);
const C = browser(); r = await C.post('/api/login', { email: 'carol@alpha.test', password: 'carolpass12' }); r = await C.get('/api/session'); ok(r.data.settings.company === 'Alpha BV', 'the colleague signs in to Alpha');

console.log('files are separate');
r = await A.raw('/api/files?name=a.txt&type=text/plain', 'alpha file'); ok(r.status === 200 && r.data.id, 'A uploads a file', r);
const fid = r.data.id;
r = await A.get('/api/files/' + fid); ok(r.status === 200 && r.data === 'alpha file', 'A downloads it');
r = await B.get('/api/files/' + fid); ok(r.data !== 'alpha file', 'B asking for the same file number never gets A content', r.status);

console.log('API tokens and public links carry their company');
r = await A.get('/api/admin/people'); const aliceId = r.data.people.find(p => p.email === 'alice@alpha.test').id;
r = await A.post('/api/admin/tokens', { name: 'test', person_id: aliceId }); ok(r.status === 200 && /^ord_[a-f0-9]{12}[a-f0-9]{64}$/.test(r.data.token), 'a token carries the company id', r.data && r.data.token && r.data.token.length);
const tok = r.data.token;
r = await browser().get('/api/me/data', { authorization: 'Bearer ' + tok }); ok(r.status === 200 && JSON.stringify(r.data).includes('alice@alpha.test'), 'the token works with no cookie at all');
r = await browser().get('/api/me/data', { authorization: 'Bearer ord_' + 'a'.repeat(76) }); ok(r.status === 401, 'a made-up token is refused');
r = await browser().get('/api/public/request/' + 'a'.repeat(36)); ok(r.status === 404, 'a made-up public link does not exist');
r = await browser().get('/api/public/request/' + 'a'.repeat(24)); ok(r.status === 404, 'neither does an old-style one');

console.log('signing out');
r = await A.post('/api/logout', {}); r = await A.get('/api/home'); ok(r.status === 401, 'A is signed out');
r = await A.post('/api/login', { email: 'alice@alpha.test', password: 'alphapass1' }); ok(r.status === 200, 'and can sign in again');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
