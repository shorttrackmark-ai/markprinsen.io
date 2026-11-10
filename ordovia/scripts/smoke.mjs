// End-to-end smoke test against a running Ordovia (local: npm run dev, then `node scripts/smoke.mjs`).
// It sets up a demo workspace, so run it only against a FRESH local database, never against the live one.
//   BASE=http://localhost:8787 node scripts/smoke.mjs
const BASE = process.env.BASE || 'http://localhost:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
let cookie = '', failed = 0, n = 0;
async function call(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };
const get = (p) => call('GET', p), post = (p, b) => call('POST', p, b || {}), put = (p, b) => call('PUT', p, b), del = (p) => call('DELETE', p);

console.log('setup & login');
let r = await get('/api/session'); ok(r.data.setup === true, 'fresh workspace asks for setup', r.data);
r = await post('/api/setup', { company: 'Test BV', name: 'Tester', email: 'tester@example.com', password: 'testtest1', demo: true }); ok(r.status === 200, 'setup with demo data', r);
r = await get('/api/meta'); ok(r.status === 200 && r.data.areas.length === 3, 'meta lists the three demo areas', r.data.areas);
const forms = r.data.forms; ok(forms.every(f => f.status === 'active'), 'forms are active'); ok(forms.some(f => f.area_id), 'forms have an area');

console.log('areas');
r = await get('/api/areas'); ok(r.data.length === 3 && r.data[0].flows !== undefined, 'area overview with counts', r.data);
r = await post('/api/admin/areas', { name: 'Sales', description: 'Offers and orders' }); ok(r.status === 200 && r.data.id, 'create area', r); const salesId = r.data.id;
r = await post('/api/admin/areas', { name: 'sales' }); ok(r.status === 409, 'area names are unique (case-insensitive)', r);
r = await put('/api/admin/areas/' + salesId, { name: 'Sales & Marketing', description: 'x' }); ok(r.status === 200, 'rename area');

console.log('handbook, home');
r = await get('/api/handbook'); ok(r.data.length === 3 && r.data[0].owner && r.data[0].reviewDue, 'handbook has owner and review date', r.data[0]);
const flowId = r.data.find(f => f.name === 'Leave request').id;
r = await get('/api/home'); ok(r.data.flows.length === 3 && r.data.flows[0].area_id, 'home lists active processes with area');

console.log('lifecycle');
r = await del('/api/admin/forms/' + forms[0].id); ok(r.status === 409, 'a form cannot be deleted before it is archived', r.data);
r = await get('/api/admin/flows/' + flowId); const flow = r.data;
r = await put('/api/admin/flows/' + flowId, { name: flow.name, description: flow.description, graph: flow.graph, doc: flow.doc, status: 'archived' }); ok(r.status === 200 && r.data.status === 'archived', 'archive a process', r.data);
r = await get('/api/home'); ok(r.data.flows.length === 2, 'archived process is gone from Start a process');
r = await post('/api/flows/' + flowId + '/start'); ok(r.status === 409, 'archived process cannot be started', r.data);
r = await put('/api/admin/flows/' + flowId, { name: flow.name, description: flow.description, graph: flow.graph, doc: flow.doc, status: 'active' }); ok(r.status === 200 && r.data.status === 'active', 'reactivate it', r.data);
// an active process with a broken graph falls back to draft
const broken = JSON.parse(JSON.stringify(flow.graph)); broken.edges = broken.edges.slice(1);
r = await put('/api/admin/flows/' + flowId, { name: flow.name, description: flow.description, graph: broken, doc: flow.doc }); ok(r.data.status === 'draft' && r.data.note, 'broken active process becomes a draft', r.data);
r = await put('/api/admin/flows/' + flowId, { name: flow.name, description: flow.description, graph: broken, doc: flow.doc, status: 'active' }); ok(r.status === 400, 'cannot activate a process with issues', r.data);

console.log('versions');
r = await get(`/api/admin/flows/${flowId}/versions`); ok(r.data.length >= 2, 'history keeps versions', r.data);
const v1 = r.data[r.data.length - 1];
r = await post(`/api/admin/flows/${flowId}/restore`, { versionId: v1.id }); ok(r.status === 200, 'restore the first version', r.data);
r = await put('/api/admin/flows/' + flowId, { name: flow.name, description: flow.description, graph: flow.graph, doc: flow.doc, status: 'active' }); ok(r.data.status === 'active', 'active again');
r = await post(`/api/flows/${flowId}/review`); ok(r.status === 200, 'mark as reviewed');

console.log('health, search, audit');
r = await get('/api/admin/health'); ok(Array.isArray(r.data.items) && r.data.counts, 'health report', r.data.counts);
r = await get('/api/search?q=leave'); ok(r.data.results.some(x => x.type === 'Process') && r.data.results.some(x => x.type === 'Form'), 'search finds process and form', r.data.results.map(x => x.type));
r = await get('/api/search?q=' + encodeURIComponent('100%_')); ok(r.status === 200, 'search treats % and _ literally');
r = await get('/api/admin/audit'); ok(r.data.some(a => a.entity === 'process' && a.action === 'restore') && r.data.some(a => a.entity === 'area' && a.action === 'created'), 'audit log records changes', r.data.slice(0, 4));
r = await post('/api/admin/sql', { sql: 'select 1 as x' }); r = await get('/api/admin/audit'); ok(!r.data.some(a => a.action === 'ran' && /select 1/.test(a.detail || '')), 'read-only SQL is not logged');
r = await post('/api/admin/sql', { sql: "update settings set value = value where key = 'zzz'" }); r = await get('/api/admin/audit'); ok(r.data.some(a => a.action === 'ran'), 'SQL that writes is logged');

console.log('as a colleague');
cookie = '';
r = await post('/api/login', { email: 'bram@example.com', password: 'demo1234' }); ok(r.status === 200, 'colleague logs in');
r = await get('/api/admin/health'); ok(r.status === 403, 'health is for admins');
r = await get('/api/admin/audit'); ok(r.status === 403, 'audit is for admins');
r = await get('/api/handbook'); ok(r.data.every(f => f.status === 'active'), 'handbook shows only active processes');
r = await get('/api/search?q=leave'); ok(r.status === 200 && r.data.results.length > 0, 'colleague can search');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
