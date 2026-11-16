// Accounts: invitations, forgotten passwords, e-mail change, password change, sign-in rate limit.
// Needs a LOCAL server started with --var DATA_REGION:local (mails land in an outbox the test can read):  BASE=http://127.0.0.1:8787 node scripts/smoke-accounts.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };
const browser = () => {
  const jar = new Map();
  const call = async (method, path, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v) jar.delete(k); else jar.set(k, v); }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  return { jar, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
};
const outbox = async () => (await browser().get('/api/dev/outbox')).data;
const tokenIn = (mail) => (/#\/account\/([a-f0-9]{52})/.exec(mail.body) || [])[1];
const run = Date.now().toString(36);
const A = browser(); let r;

console.log('invitation');
r = await A.post('/api/setup', { company: 'Accounts BV', name: 'Admin', email: `admin.${run}@acc.test`, password: 'adminpass1', lang: 'en' }); ok(r.status === 200, 'a company signs up');
r = await A.post('/api/admin/people', { name: 'Nina New', email: `nina.${run}@acc.test`, is_admin: false, active: true }); ok(r.status === 200 && r.data.invite && r.data.invite.sent === true && !r.data.invite.link, 'adding a person without a password sends an invitation', r.data);
const nina = r.data.id;
let mails = await outbox(); let m = mails.find(x => x.to_addr === `nina.${run}@acc.test`);
ok(m && /invited you/.test(m.body) && tokenIn(m), 'the mail holds a personal link', m && m.subject);
const invTok = tokenIn(m);
r = await browser().post('/api/login', { email: `nina.${run}@acc.test`, password: 'anything123' }); ok(r.status === 401, 'she cannot sign in before choosing a password');
r = await A.get('/api/admin/people'); ok(r.data.people.find(p => p.id === nina).invited_at, 'the people list shows her as invited');
const N = browser();
r = await N.get('/api/public/account/' + invTok); ok(r.status === 200 && r.data.kind === 'invite' && r.data.name === 'Nina New' && r.data.company === 'Accounts BV', 'the link opens without signing in', r.data);
r = await N.post('/api/public/account/' + invTok, { password: 'short' }); ok(r.status === 400, 'a short password is refused');
r = await N.post('/api/public/account/' + invTok, { password: 'ninapass12' }); ok(r.status === 200, 'she chooses her password');
r = await N.get('/api/session'); ok(r.data.user && r.data.user.name === 'Nina New' && r.data.settings.company === 'Accounts BV', 'and is signed in to the company');
r = await N.post('/api/public/account/' + invTok, { password: 'ninapass13' }); ok(r.status === 404, 'the link works only once');
r = await A.get('/api/admin/people'); ok(!r.data.people.find(p => p.id === nina).invited_at, 'she is no longer "invited"');
r = await A.post('/api/admin/people/' + nina + '/invite', {}); ok(r.status === 400, 'no second invitation once she has a password');
r = await A.post('/api/admin/people', { name: 'Omar Open', email: `omar.${run}@acc.test`, is_admin: false, active: true }); const omar = r.data.id;
r = await A.post('/api/admin/people/' + omar + '/invite', {}); ok(r.status === 200 && r.data.sent, 'an invitation can be sent again');
mails = await outbox(); const omarMails = mails.filter(x => x.to_addr === `omar.${run}@acc.test`); ok(omarMails.length >= 2, 'a new mail went out');
r = await browser().get('/api/public/account/' + tokenIn(omarMails[omarMails.length - 1])); ok(r.status === 404, 'the old link stopped working');
r = await browser().get('/api/public/account/' + tokenIn(omarMails[0])); ok(r.status === 200, 'the new one works');
r = await browser().get('/api/public/account/' + 'f'.repeat(52)); ok(r.status === 404, 'a made-up link does not work');
r = await browser().get('/api/public/account/' + 'f'.repeat(10)); ok(r.status === 404, 'neither does a malformed one');

console.log('forgotten password');
const before = (await outbox()).length;
r = await browser().post('/api/forgot', { email: `nobody.${run}@acc.test` }); ok(r.status === 200 && r.data.ok, 'an unknown address gets the same friendly answer');
ok((await outbox()).length === before, 'and no mail is sent');
const N2 = browser(); await N2.post('/api/login', { email: `nina.${run}@acc.test`, password: 'ninapass12' });
r = await browser().post('/api/forgot', { email: `nina.${run}@acc.test` }); ok(r.status === 200, 'a known address gets that answer too');
m = (await outbox()).find(x => x.to_addr === `nina.${run}@acc.test` && /Reset/.test(x.subject)); ok(m && tokenIn(m), 'and a reset mail');
const rst = tokenIn(m);
r = await browser().post('/api/public/account/' + rst, { password: 'newninapass1' }); ok(r.status === 200, 'she chooses a new password');
r = await N.get('/api/home'); ok(r.status === 401, 'every device that was signed in is signed out');
r = await N2.get('/api/home'); ok(r.status === 401, '(also the second one)');
r = await browser().post('/api/login', { email: `nina.${run}@acc.test`, password: 'ninapass12' }); ok(r.status === 401, 'the old password no longer works');
r = await browser().post('/api/login', { email: `nina.${run}@acc.test`, password: 'newninapass1' }); ok(r.status === 200, 'the new one does');
r = await browser().post('/api/public/account/' + rst, { password: 'again12345' }); ok(r.status === 404, 'a reset link works once');

console.log('own password and e-mail address');
const S1 = browser(), S2 = browser();
await S1.post('/api/login', { email: `nina.${run}@acc.test`, password: 'newninapass1' }); await S2.post('/api/login', { email: `nina.${run}@acc.test`, password: 'newninapass1' });
r = await S1.post('/api/me/password', { current: 'wrong', password: 'thirdpass123' }); ok(r.status === 403, 'changing the password needs the current one');
r = await S1.post('/api/me/password', { current: 'newninapass1', password: 'thirdpass123' }); ok(r.status === 200, 'changed');
r = await S1.get('/api/home'); ok(r.status === 200, 'this device stays signed in');
r = await S2.get('/api/home'); ok(r.status === 401, 'other devices are signed out');
r = await S1.post('/api/me/email', { email: `taken.${run}@acc.test`, password: 'wrong' }); ok(r.status === 403, 'changing the address needs the password');
r = await S1.post('/api/me/email', { email: `admin.${run}@acc.test`, password: 'thirdpass123' }); ok(r.status === 409, 'an address that is in use is refused');
r = await S1.post('/api/me/email', { email: `nina2.${run}@acc.test`, password: 'thirdpass123' }); ok(r.status === 200 && r.data.sent, 'a confirmation goes to the new address');
m = (await outbox()).find(x => x.to_addr === `nina2.${run}@acc.test`); ok(m && /Confirm/.test(m.subject), 'the mail arrived at the NEW address');
r = await browser().post('/api/login', { email: `nina.${run}@acc.test`, password: 'thirdpass123' }); ok(r.status === 200, 'until confirmed the old address still works');
r = await browser().post('/api/public/account/' + tokenIn(m), {}); ok(r.status === 200, 'she confirms');
r = await browser().post('/api/login', { email: `nina2.${run}@acc.test`, password: 'thirdpass123' }); ok(r.status === 200, 'the new address signs in');
r = await browser().post('/api/login', { email: `nina.${run}@acc.test`, password: 'thirdpass123' }); ok(r.status === 401, 'the old address no longer does');
const B = browser(); r = await B.post('/api/setup', { company: 'Other BV', name: 'Other', email: `nina.${run}@acc.test`, password: 'otherpass12' }); ok(r.status === 200, 'the old address is free for another company again');

console.log('too many attempts');
const victim = `nina2.${run}@acc.test`; let last;
for (let i = 0; i < 8; i++) last = await browser().post('/api/login', { email: victim, password: 'wrongwrong' + i });
ok(last.status === 401, 'eight wrong passwords are answered normally');
r = await browser().post('/api/login', { email: victim, password: 'thirdpass123' }); ok(r.status === 429, 'then even the right one is paused for a while', r);
r = await browser().post('/api/login', { email: `admin.${run}@acc.test`, password: 'adminpass1' }); ok(r.status === 200, 'someone else can still sign in');
r = await A.get('/api/admin/audit'); const audit = JSON.stringify(r.data);
ok(/invitation accepted/.test(audit) && /password reset by link/.test(audit) && /own password changed/.test(audit) && /e-mail address changed/.test(audit), 'the audit log has the account events');
ok(/8 failed sign-ins/.test(audit), 'and the pause');
ok(!/thirdpass|ninapass|pbkdf2/.test(audit), 'but never a password');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
