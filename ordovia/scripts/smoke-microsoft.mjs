// Microsoft sign-in against a MOCK Microsoft login server (it signs real tokens). Start a local server like this (mock on MOCK_PORT, default 9412):
//   wrangler dev --var DATA_REGION:local --var MS_CLIENT_ID:client-123 --var MS_CLIENT_SECRET:secret-xyz
//        --var MS_AUTHORITY:http://127.0.0.1:9412/organizations --var MS_ISSUER_BASE:http://127.0.0.1:9412
// then:  BASE=http://127.0.0.1:8787 node scripts/smoke-microsoft.mjs
import http from 'node:http';
import crypto from 'node:crypto';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
const MOCK_PORT = Number(process.env.MOCK_PORT || 9412), CLIENT = 'client-123', SECRET = 'secret-xyz';
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };

// ---- the mock Microsoft
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'mock-' + crypto.randomBytes(4).toString('hex'), jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig' };
const codes = new Map();
const b64u = (b) => Buffer.from(b).toString('base64url');
const idToken = (claims, key = privateKey) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' })), p = b64u(JSON.stringify(claims)); return h + '.' + p + '.' + b64u(crypto.sign('sha256', Buffer.from(h + '.' + p), key)); };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    if (u.pathname === '/organizations/discovery/v2.0/keys') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ keys: [jwk] })); }
    if (u.pathname === '/organizations/oauth2/v2.0/token') {
      const f = new URLSearchParams(body), c = codes.get(f.get('code')); codes.delete(f.get('code'));
      const bad = (m) => { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: m })); };
      if (!c || f.get('client_id') !== CLIENT || f.get('client_secret') !== SECRET || f.get('redirect_uri') !== c.redirect) return bad('invalid_grant');
      if (crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') !== c.challenge) return bad('pkce');
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ id_token: idToken({ aud: CLIENT, iss: `http://127.0.0.1:${MOCK_PORT}/${c.who.tid}/v2.0`, tid: c.who.tid, oid: c.who.oid, name: c.who.name, nonce: c.wrongNonce ? 'wrong' : c.nonce, exp: Math.floor(Date.now() / 1000) + 600, nbf: Math.floor(Date.now() / 1000) - 5 }) }));
    }
    res.statusCode = 404; res.end();
  });
}).listen(MOCK_PORT);
/** "The person picks an account at Microsoft": from the authorize address to the callback address. */
const pick = (authorizeUrl, who, opts = {}) => {
  const u = new URL(authorizeUrl); const code = crypto.randomBytes(8).toString('hex');
  codes.set(code, { who, nonce: u.searchParams.get('nonce'), challenge: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri'), wrongNonce: opts.wrongNonce });
  const cb = new URL(u.searchParams.get('redirect_uri')); cb.searchParams.set('code', code); cb.searchParams.set('state', opts.state || u.searchParams.get('state'));
  return cb.toString();
};

const browser = () => {
  const jar = new Map();
  const call = async (method, urlOrPath, body, headers = {}) => {
    const url = urlOrPath.startsWith('http') ? urlOrPath : BASE + urlOrPath;
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v) jar.delete(k); else jar.set(k, v); }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, location: r.headers.get('location') };
  };
  return { jar, get: (p, h) => call('GET', p, undefined, h), post: (p, b) => call('POST', p, b) };
};
/** Start at the app, go to "Microsoft", pick an account, come back. */
const roundTrip = async (br, startPath, who, opts) => {
  const s = await br.get(startPath); if (s.status !== 302) return { start: s };
  const back = await br.get(pick(s.location, who, opts));
  return { start: s, back };
};
const run = Date.now().toString(36);
const rid = () => crypto.randomUUID();
const T1 = crypto.randomUUID(), T2 = crypto.randomUUID();
const wim = { tid: T1, oid: rid(), name: 'Wim' }, stranger = { tid: T2, oid: rid(), name: 'Stranger' }, newbie = { tid: T1, oid: rid(), name: 'Newbie' };
let r;

console.log('Microsoft sign-in is on');
r = await browser().get('/api/session'); ok(r.data.settings.microsoft === true, 'the app knows the button may be shown');

console.log('link a Microsoft account to a person');
const A = browser();
r = await A.post('/api/setup', { company: 'Microsoft BV', name: 'Wim Wachten', email: `wim.${run}@ms.test`, password: 'password123', lang: 'en' }); ok(r.status === 200, 'a company signs up');
r = await browser().get('/api/ms/start?mode=link'); ok(r.status === 401, 'linking needs a signed-in person');
r = await A.get('/api/ms/start?mode=link'); ok(r.status === 302 && r.location.startsWith(`http://127.0.0.1:${MOCK_PORT}/organizations/oauth2/v2.0/authorize?`), 'the app sends the person to Microsoft');
const u = new URL(r.location); ok(u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('client_id') === CLIENT && u.searchParams.get('state') && u.searchParams.get('nonce'), 'with state, nonce and PKCE');
ok(A.jar.has('ordovia_oauth'), 'and a cookie that ties the attempt to this browser');
const linkBack = await A.get(pick(r.location, wim)); ok(linkBack.status === 302 && /\/app\/#\/me$/.test(linkBack.location), 'back from Microsoft: the person lands on their account page', linkBack.location);
r = await A.get('/api/session'); ok(r.data.user.ms_linked === 1, 'the account is linked');

console.log('sign in with it');
const B = browser(); let rt = await roundTrip(B, '/api/ms/start?mode=login', wim); ok(rt.back.status === 302 && /\/app\/#\/$/.test(rt.back.location), 'a new browser signs in with Microsoft only');
r = await B.get('/api/session'); ok(r.data.user && r.data.user.email === `wim.${run}@ms.test` && r.data.settings.company === 'Microsoft BV', 'and is in the right company as the right person');
const C = browser(); rt = await roundTrip(C, '/api/ms/start?mode=login', stranger); ok(/ms-unknown/.test(rt.back.location), 'an unknown Microsoft account is not let in', rt.back.location);
r = await C.get('/api/session'); ok(r.data.user === null, 'and is not signed in');
const sameOidOtherTenant = { tid: T2, oid: wim.oid, name: 'Impostor' }; const C2 = browser(); rt = await roundTrip(C2, '/api/ms/start?mode=login', sameOidOtherTenant); ok(/ms-unknown/.test(rt.back.location), 'the same user id in another Microsoft tenant is a different account');

console.log('what goes wrong must not work');
const D = browser(); const s1 = await D.get('/api/ms/start?mode=login');
r = await D.get(pick(s1.location, wim, { state: 'forged' })); ok(/ms-failed/.test(r.location), 'a made-up state is refused');
const D2 = browser(); const s2 = await D2.get('/api/ms/start?mode=login'); const cb2 = pick(s2.location, wim);
r = await browser().get(cb2); ok(/ms-failed/.test(r.location), 'a callback from another browser (no cookie) is refused');
r = await D2.get(cb2); ok(/ms-failed/.test(r.location), '(and that attempt is used up)');
const D3 = browser(); const s3 = await D3.get('/api/ms/start?mode=login'); const cb3 = pick(s3.location, wim);
r = await D3.get(cb3); ok(/\/app\/#\/$/.test(r.location), 'the real one works once');
const D4 = browser(); await D4.get(cb3); r = await D3.get(cb3); ok(/ms-failed/.test(r.location), 'and a replay does not');
const E = browser(); rt = await roundTrip(E, '/api/ms/start?mode=login', wim, { wrongNonce: true }); ok(/ms-failed/.test(rt.back.location), 'a token for another attempt (nonce) is refused');
r = await E.get('/api/session'); ok(r.data.user === null, 'nobody is signed in by it');
r = await browser().get('/api/ms/callback?error=access_denied&state=x'); ok(/ms-failed/.test(r.location), 'a refusal at Microsoft ends in a friendly page');

console.log('one Microsoft account, one person');
r = await A.post('/api/admin/people', { name: 'Pia Pool', email: `pia.${run}@ms.test`, password: 'password123', is_admin: false, active: true });
const P = browser(); await P.post('/api/login', { email: `pia.${run}@ms.test`, password: 'password123' });
rt = await roundTrip(P, '/api/ms/start?mode=link', wim); ok(/ms-taken/.test(rt.back.location), 'Wim\'s Microsoft account cannot also be linked to Pia', rt.back.location);
r = await P.get('/api/session'); ok(!r.data.user.ms_linked, 'Pia stays unlinked');
rt = await roundTrip(P, '/api/ms/start?mode=link', { tid: T1, oid: rid(), name: 'Pia' }); ok(/#\/me$/.test(rt.back.location), 'her own account links');
const A2 = browser(); await A2.post('/api/login', { email: `wim.${run}@ms.test`, password: 'password123' });
r = await A2.post('/api/me/microsoft/unlink', {}); ok(r.status === 200, 'Wim unlinks');
rt = await roundTrip(browser(), '/api/ms/start?mode=login', wim); ok(/ms-unknown/.test(rt.back.location), 'after that his Microsoft account no longer signs in');

console.log('invitation with a Microsoft account (no password)');
r = await A.post('/api/admin/people', { name: 'Nina Nieuw', email: `nina.${run}@ms.test`, is_admin: false, active: true });
const box = (await browser().get('/api/dev/outbox')).data; const mail = box.find(x => x.to_addr === `nina.${run}@ms.test`); const tok = (/#\/account\/([a-f0-9]{52})/.exec(mail.body) || [])[1];
r = await browser().get('/api/public/account/' + tok); ok(r.data.microsoft === true, 'the invitation page offers Microsoft');
const N = browser(); rt = await roundTrip(N, '/api/ms/start?mode=invite&token=' + tok, newbie); ok(/\/app\/#\/$/.test(rt.back.location), 'she accepts the invitation with her Microsoft account');
r = await N.get('/api/session'); ok(r.data.user && r.data.user.name === 'Nina Nieuw' && r.data.user.ms_linked === 1, 'and is signed in as the invited person', r.data.user);
r = await browser().get('/api/public/account/' + tok); ok(r.status === 404, 'the invitation is used up');
r = await N.post('/api/me/microsoft/unlink', {}); ok(r.status === 400 && /no password/.test(r.data.error), 'she cannot unlink until she has a password (no lock-out)');
rt = await roundTrip(browser(), '/api/ms/start?mode=invite&token=' + 'f'.repeat(52), newbie); ok(rt.start.status === 404, 'a made-up invitation does not start anything');

console.log('left behind');
r = await A.get('/api/admin/audit'); const audit = JSON.stringify(r.data); ok(/Microsoft account linked/.test(audit) && /accepted with a Microsoft account/.test(audit) && !new RegExp(wim.oid).test(audit), 'the audit log records linking, without Microsoft ids');

mock.close();
console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
