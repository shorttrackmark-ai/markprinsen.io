// Document approval: draft -> approved -> published. Local server with --var DATA_REGION:local :  BASE=http://127.0.0.1:8787 node scripts/smoke-approval.mjs
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
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: (p, b) => call('POST', p, null, { 'content-type': 'application/octet-stream' }, b) };
};
const run = Date.now().toString(36);
const A = browser(), B = browser(), E = browser(); let r;
const upload = async (who, name, text) => (await who.raw('/api/files?name=' + name + '&type=text/plain', text)).data.id;

r = await A.post('/api/setup', { company: 'Goedkeuring BV', name: 'Ada', email: `ada.${run}@appr.test`, password: 'password123', lang: 'en' }); ok(r.status === 200, 'a company signs up');
r = await A.post('/api/admin/areas', { name: 'Quality' }); const area = r.data.id;
r = await A.post('/api/admin/people', { name: 'Bob Second', email: `bob.${run}@appr.test`, password: 'password123', is_admin: true, active: true }); const bobId = r.data.id;
r = await A.post('/api/admin/people', { name: 'Eve Employee', email: `eve.${run}@appr.test`, password: 'password123', is_admin: false, active: true }); const eveId = r.data.id;
await B.post('/api/login', { email: `bob.${run}@appr.test`, password: 'password123' }); await E.post('/api/login', { email: `eve.${run}@appr.test`, password: 'password123' });

console.log('approval is off by default');
r = await A.post('/api/admin/documents', { name: 'Free policy', kind: 'policy', area_id: area, fileId: await upload(A, 'free.txt', 'v1') }); ok(r.status === 200 && !r.data.needsApproval, 'a document is published straight away');
r = await E.get('/api/documents'); ok(r.data.some(d => d.name === 'Free policy'), 'and everyone sees it');

console.log('switch it on');
r = await A.put('/api/admin/settings', { doc_approval: true }); ok(r.status === 200, 'an administrator turns approval on');
r = await A.post('/api/admin/documents', { name: 'Safety norm', kind: 'norm', area_id: area, owner_id: eveId, fileId: await upload(A, 'norm1.txt', 'norm version one') }); ok(r.status === 200 && r.data.needsApproval, 'a new document starts as a draft', r.data);
const doc = r.data.id;
r = await E.get('/api/documents'); ok(r.data.some(d => d.id === doc), 'its owner sees it');
const E2 = browser(); await E2.post('/api/setup', { company: 'Other', name: 'Other', email: `o.${run}@appr.test`, password: 'password123' });
r = await A.post('/api/admin/people', { name: 'Fred Other', email: `fred.${run}@appr.test`, password: 'password123', is_admin: false, active: true }); const F = browser(); await F.post('/api/login', { email: `fred.${run}@appr.test`, password: 'password123' });
r = await F.get('/api/documents'); ok(!r.data.some(d => d.id === doc), 'a colleague does not see the draft');
r = await F.get('/api/documents/' + doc); ok(r.status === 404, 'not even by its address');
r = await A.get('/api/documents/' + doc); const fileId = r.data.versions[0].file_id; ok(r.data.versions[0].stage === 'draft' && r.data.canApprove && r.data.approval, 'an administrator sees it is a draft');
r = await F.get('/api/files/' + fileId); ok(r.status === 403, 'the draft file is closed to a colleague');
r = await E.get('/api/files/' + fileId); ok(r.status === 200, 'but open to the owner');
r = await A.get('/api/admin/health'); ok(JSON.stringify(r.data).includes('waits for approval'), 'Health lists what waits for approval');

console.log('approve and publish');
r = await E.post(`/api/documents/${doc}/versions/1/approve`, {}); ok(r.status === 403, 'the owner (not an administrator) cannot approve');
r = await E.post(`/api/documents/${doc}/versions/1/publish`, {}); ok(r.status === 409, 'and nothing can be published before it is approved');
r = await A.post(`/api/documents/${doc}/versions/1/approve`, {}); ok(r.status === 403 && /two pairs of eyes/.test(r.data.error), 'who uploaded it cannot approve it when there is another administrator', r.data);
r = await B.post(`/api/documents/${doc}/versions/1/approve`, {}); ok(r.status === 200, 'another administrator approves');
r = await F.get('/api/documents'); ok(!r.data.some(d => d.id === doc), 'still not visible: approved is not published');
r = await E.post(`/api/documents/${doc}/versions/1/publish`, {}); ok(r.status === 200, 'the owner publishes');
r = await F.get('/api/documents'); ok(r.data.some(d => d.id === doc && d.status === 'active'), 'now everybody sees it');
r = await F.get('/api/files/' + fileId); ok(r.status === 200, 'and can open the file');

console.log('a new version waits');
r = await E.post(`/api/documents/${doc}/versions`, { fileId: await upload(E, 'norm2.txt', 'norm version two'), note: 'update' }); ok(r.status === 200 && r.data.version === 2 && r.data.needsApproval, 'the owner uploads version 2: a draft');
r = await F.get('/api/documents/' + doc); ok(r.data.version === 1 && r.data.versions.length === 1 && r.data.versions[0].stage === 'published', 'colleagues keep seeing version 1 only');
r = await F.get('/api/documents'); const row = r.data.find(d => d.id === doc); ok(row.file_id === fileId, 'and the library points at the published file');
r = await A.get('/api/documents'); ok(r.data.find(d => d.id === doc).pending === 1, 'administrators see that something waits');
r = await B.post(`/api/documents/${doc}/versions/2/approve`, {}); ok(r.status === 200, 'approved');
r = await A.post(`/api/documents/${doc}/versions/2/publish`, {}); ok(r.status === 200, 'published by an administrator');
r = await F.get('/api/documents/' + doc); ok(r.data.version === 2 && r.data.versions.length === 2, 'now version 2 is the current one, version 1 is history');
r = await F.get('/api/documents'); ok(r.data.find(d => d.id === doc).file_id !== fileId, 'the library points at the new file');
r = await A.post(`/api/documents/${doc}/versions/1/approve`, {}); ok(r.status === 409, 'a published version cannot be approved again');
r = await A.del(`/api/documents/${doc}/versions/2`); ok(r.status === 409, 'a published version cannot be removed');

console.log('remove an unpublished version');
r = await E.post(`/api/documents/${doc}/versions`, { fileId: await upload(E, 'norm3.txt', 'oops'), note: 'wrong' }); ok(r.data.version === 3, 'version 3 is a draft');
r = await F.del(`/api/documents/${doc}/versions/3`); ok(r.status === 403, 'a colleague cannot remove it');
r = await E.del(`/api/documents/${doc}/versions/3`); ok(r.status === 200, 'the owner removes it');
r = await E.get('/api/documents/' + doc); ok(r.data.versions.length === 2, 'it is gone');
r = await E.post(`/api/documents/${doc}/versions`, { fileId: await upload(E, 'norm4.txt', 'again'), note: 'again' }); ok(r.data.version === 3, 'the next draft gets the next number');

console.log('the audit log');
r = await A.get('/api/admin/audit'); const audit = JSON.stringify(r.data); ok(/approved/.test(audit) && /published/.test(audit) && /new draft/.test(audit), 'approvals and publications are recorded');

console.log('a single administrator may approve their own upload');
const S = browser(); await S.post('/api/setup', { company: 'Solo BV', name: 'Solo', email: `solo.${run}@appr.test`, password: 'password123', lang: 'en' });
r = await S.post('/api/admin/areas', { name: 'Ops' }); const sa = r.data.id; await S.put('/api/admin/settings', { doc_approval: true });
r = await S.post('/api/admin/documents', { name: 'Solo doc', kind: 'policy', area_id: sa, fileId: await upload(S, 's.txt', 's') }); const sd = r.data.id;
r = await S.post(`/api/documents/${sd}/versions/1/approve`, {}); ok(r.status === 200, 'so nobody is locked out');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
