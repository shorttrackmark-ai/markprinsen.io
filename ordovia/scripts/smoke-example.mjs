// The example under the same address: a browser that enters the example sees its own database; the real workspace is untouched.
// Run against a FRESH local database that has both D1s migrated (ordovia and ordovia-demo):  BASE=http://127.0.0.1:8787 node scripts/smoke-example.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };
const jar = new Map();   // a browser's cookies
async function call(method, path, body) {
  const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  for (const sc of r.headers.getSetCookie()) { const [kv, ...attrs] = sc.split(';'); const [k, v] = kv.split('='); if (/max-age=0/i.test(attrs.join(';')) || !v) jar.delete(k); else jar.set(k, v); }
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

let r = await call('GET', '/api/session'); ok(r.data.setup === true && r.data.settings.canTryExample === true && r.data.settings.demoSite === false, 'a fresh real workspace offers the example', r.data);
r = await call('POST', '/api/demo/enter', { as: 'anna' }); ok(r.status === 200, 'enter the example as Anna', r);
r = await call('GET', '/api/session'); ok(r.data.setup === false && r.data.settings.demoSite === true && r.data.user && r.data.user.email === 'anna@example.com' && r.data.settings.canTryExample === false, 'the example answers with its own data and sign-in', r.data);
r = await call('GET', '/api/home'); ok(r.status === 200 && r.data.flows.length === 3, 'Anna sees the three example processes');
r = await call('GET', '/api/admin/people'); ok(r.status === 403, 'Anna is a colleague, not an administrator');
r = await call('POST', '/api/demo/leave'); ok(r.status === 200, 'leave the example');
r = await call('GET', '/api/session'); ok(r.data.setup === true && r.data.user === null && r.data.settings.demoSite === false, 'back in the untouched real workspace: still waiting for setup', r.data);
r = await fetch(BASE + '/api/session'); const d2 = await r.json(); ok(d2.setup === true && d2.settings.demoSite === false, 'other visitors still see the real workspace');
r = await call('POST', '/api/demo/enter', { as: 'admin' }); r = await call('POST', '/api/logout'); r = await call('GET', '/api/session'); ok(r.data.settings.demoSite === true && r.data.user === null, 'signing out of the example stays in the example');
console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
