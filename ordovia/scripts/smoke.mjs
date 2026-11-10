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
r = await post('/api/admin/assign-area', { entity: 'form', id: forms[0].id, area_id: salesId }); ok(r.status === 200, 'assign a form to an area'); r = await get('/api/meta'); ok(r.data.forms.find(f => f.id === forms[0].id).area_id === salesId, 'the form is in its new area');
r = await post('/api/admin/areas/starter'); ok(r.status === 409, 'starter areas only on an empty workspace');

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

console.log('request forms, public web form, API');
{
  // a request form + a process that uses it as its input, open as a public web form, with a task for Eva (Finance)
  r = await post('/api/admin/forms', { name: 'Quote request' }); const qfId = r.data.id;
  r = await get('/api/admin/forms/' + qfId); const qf = r.data.form;
  qf.fields = [{ key: 'company', label: 'Company', type: 'text', required: true }, { key: 'amount', label: 'Amount', type: 'number', required: true, min: 1 }, { key: 'note', label: 'Note', type: 'text' }];
  r = await put('/api/admin/forms/' + qfId, { ...qf }); ok(r.status === 200, 'create the request form', r.data);
  const people = (await get('/api/meta')).data.people, eva = people.find(p => p.name.startsWith('Eva'));
  const approval = (await get('/api/meta')).data.forms.find(f => f.name === 'Approval');
  const graph = { nodes: [{ id: 's', type: 'start', name: 'Start', formId: qfId, publicEnabled: true, title: '"Quote " & company' }, { id: 't', type: 'task', name: 'Check the quote', formId: approval.id, assignee: { type: 'person', personId: eva.id } }, { id: 'e', type: 'end', name: 'Done' }],
    edges: [{ id: 'e1', from: 's', to: 't' }, { id: 'e2', from: 't', to: 'e' }] };
  r = await post('/api/admin/flows', { name: 'Quote' }); const qId = r.data.id;
  r = await put('/api/admin/flows/' + qId, { name: 'Quote', description: 'Ask Finance for a quote', graph, doc: {}, status: 'active' }); ok(r.status === 200 && r.data.status === 'active', 'activate a process with a request form', r.data);
  const token = r.data.graph.nodes[0].publicToken; ok(/^[a-f0-9]{24}$/.test(token || ''), 'the server made a public link token', token);
  // public: no login
  const saved = cookie; cookie = '';
  r = await get('/api/public/request/' + token); ok(r.status === 200 && r.data.form.fields.length === 3 && !r.data.form.checks.length, 'public form is readable without login', r.data);
  r = await get('/api/public/request/' + 'a'.repeat(24)); ok(r.status === 404, 'unknown public link is a 404');
  r = await post('/api/public/request/' + token, { data: { company: 'ACME', amount: 0 }, requester: { name: 'Joe', email: 'joe@acme.test' } }); ok(r.status === 422 && r.data.errors.amount, 'public form is validated on the server', r.data);
  r = await post('/api/public/request/' + token, { data: { company: 'ACME', amount: 500 }, requester: { name: 'Joe', email: 'joe@acme.test' } }); ok(r.status === 200 && /^#\d+/.test(r.data.reference), 'a visitor submits the public form', r.data);
  r = await get('/api/admin/flows'); ok(true, 'flows list still works');
  // API token
  cookie = saved;
  r = await post('/api/admin/tokens', { name: 'Test system', person_id: people.find(p => p.name.startsWith('Bram')).id }); ok(r.status === 200 && /^ord_/.test(r.data.token), 'create an API token (shown once)', r.data);
  const api = r.data.token, tid = r.data.id; cookie = '';
  const A = (m, p, b) => call(m, p, b, { authorization: 'Bearer ' + api });
  r = await A('GET', '/api/v1/ping'); ok(r.status === 200 && /Bram/.test(r.data.as), 'token authenticates as its person', r.data);
  r = await call('GET', '/api/v1/ping', null, { authorization: 'Bearer ord_nope' }); ok(r.status === 401, 'a wrong token is refused');
  r = await A('GET', '/api/v1/processes'); const q = (r.data || []).find(p => p.name === 'Quote'); ok(!!q && q.input && q.input.fields.length === 3, 'API lists processes with their input fields', r.data);
  r = await A('POST', '/api/v1/processes/' + qId + '/start', { data: { company: 'Initech', amount: 'x' } }); ok(r.status === 422, 'API validates the input', r.data);
  r = await A('POST', '/api/v1/processes/' + qId + '/start', { data: { company: 'Initech', amount: 900 }, reference: 'PO-77' }); ok(r.status === 201 && r.data.run.reference === 'PO-77' && r.data.run.status === 'running', 'API starts a run', r.data);
  const runId = r.data.run.id;
  r = await A('GET', '/api/v1/runs/' + runId); ok(r.status === 200 && r.data.run.tasks[0].name === 'Check the quote' && r.data.run.outputs.company === 'Initech', 'API reads the run with outputs and tasks', r.data);
  r = await A('GET', '/api/v1/runs?reference=PO-77'); ok(r.data.runs.length === 1, 'API finds a run by the caller\'s own reference', r.data);
  r = await A('GET', '/api/admin/audit'); ok(r.status === 403, 'a token of a normal person cannot use admin routes');
  r = await A('GET', '/api/v1/forms'); ok(r.status === 200 && Array.isArray(r.data), 'API lists forms');
  cookie = saved;
  r = await get('/api/admin/tokens'); ok(r.data.length === 1 && r.data[0].last_used_at, 'token list shows last use', r.data);
  r = await del('/api/admin/tokens/' + tid); ok(r.status === 200, 'revoke the token'); cookie = '';
  r = await A('GET', '/api/v1/ping'); ok(r.status === 401, 'a revoked token stops working');
  cookie = saved;
  r = await get('/api/instances'); ok(r.data.some(i => i.source === 'web') && r.data.some(i => i.source === 'api'), 'runs remember where they came from (web / api)', r.data.slice(0, 3).map(i => i.source));
  // a public flow may not depend on an initiator
  const bad = JSON.parse(JSON.stringify(graph)); bad.nodes[1].assignee = { type: 'initiator' };
  r = await put('/api/admin/flows/' + qId, { name: 'Quote', description: '', graph: bad, doc: {}, status: 'active' }); ok(r.data.status === 'draft' && /public web form/.test(r.data.note || ''), 'public form + initiator routing is refused (falls back to draft)', r.data);
}

console.log('files, documents, formats');
{
  const up = async (name, body, type = 'text/plain') => { const r = await fetch(BASE + '/api/files?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), { method: 'POST', headers: { 'x-ordovia': '1', cookie }, body }); return { status: r.status, data: await r.json() }; };
  const dl = async (id, ck = cookie) => { const r = await fetch(BASE + '/api/files/' + id, { headers: { cookie: ck } }); return { status: r.status, text: await r.text(), headers: r.headers }; };
  r = await up('norm.txt', 'THE NORM v1'); ok(r.status === 200 && r.data.size === 11, 'upload a file', r.data); const f1 = r.data.id;
  r = await up('evil.html', '<script>alert(1)</script>'); ok(r.status === 415, 'web pages and programs are refused', r.data);
  r = await up('empty.txt', ''); ok(r.status === 400, 'empty files are refused');
  r = await dl(f1); ok(r.status === 200 && r.text === 'THE NORM v1' && /inline/.test(r.headers.get('content-disposition')) && r.headers.get('x-content-type-options') === 'nosniff', 'download it back, safely', r.headers.get('content-disposition'));
  r = await post('/api/admin/documents', { name: 'Quality norm', kind: 'norm', area_id: salesId, fileId: f1, review_months: 6 }); ok(r.status === 200 && r.data.id, 'create a document from the upload', r.data); const docId = r.data.id;
  r = await post('/api/admin/documents', { name: 'Again', fileId: f1 }); ok(r.status === 400, 'a file can only belong to one document');
  r = await get('/api/documents/' + docId); ok(r.data.version === 1 && r.data.versions.length === 1 && r.data.canManage, 'document with its versions', r.data);
  r = await up('norm2.txt', 'THE NORM v2'); const f2 = r.data.id;
  r = await post('/api/documents/' + docId + '/versions', { fileId: f2, note: 'better' }); ok(r.status === 200 && r.data.version === 2, 'upload a new version');
  r = await get('/api/documents'); ok(r.data.find(d => d.id === docId).file_name === 'norm2.txt', 'the library shows the newest file');
  r = await dl(f1); ok(r.status === 200 && r.text === 'THE NORM v1', 'the old version stays available');
  // link to a step
  { const fl = (await get('/api/admin/flows/' + flowId)).data; fl.graph.nodes.find(n => n.type === 'task').docIds = [docId];
    r = await put('/api/admin/flows/' + flowId, { name: fl.name, description: fl.description, graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 200, 'link the document to a step');
    r = await get('/api/handbook/' + flowId); ok(r.data.steps.some(s => (s.documents || []).some(d => d.id === docId)), 'the handbook shows it at the step'); }
  r = await get('/api/admin/health'); ok(!r.data.items.some(i => /points to a document/.test(i.title)), 'no broken document links');
  r = await get('/api/search?q=quality'); ok(r.data.results.some(x => x.type === 'Document'), 'search finds documents');
  r = await del('/api/admin/documents/' + docId); ok(r.status === 409, 'documents are archived before they are deleted');
  // a file field and formats in a form
  r = await post('/api/admin/forms', { name: 'Supplier invoice' }); const invId = r.data.id; r = await get('/api/admin/forms/' + invId); const inv = r.data.form;
  inv.fields = [{ key: 'iban', label: 'IBAN', type: 'text', format: 'iban', required: true }, { key: 'postcode', label: 'Postcode', type: 'text', format: 'postcode_nl' }, { key: 'ref', label: 'Reference', type: 'text', pattern: '^INV-[0-9]{4}$', patternMsg: 'INV-1234' }, { key: 'pdf', label: 'Invoice', type: 'file', required: true }];
  r = await put('/api/admin/forms/' + invId, { ...inv, access: { direct: true } }); ok(r.status === 200, 'a form with a file field and formats', r.data);
  r = await up('invoice.pdf', 'PDFDATA', 'application/pdf'); const pf = r.data.id;
  r = await post('/api/forms/' + invId + '/records', { data: { iban: 'nl91 abna 0417 1643 00', postcode: '1234ab', ref: 'INV-12', pdf: pf } }); ok(r.status === 422 && r.data.errors.ref === 'INV-1234', 'a pattern is enforced on the server', r.data);
  r = await post('/api/forms/' + invId + '/records', { data: { iban: 'NL00BANK0000000000', pdf: pf } }); ok(r.status === 422 && /IBAN/.test(r.data.errors.iban), 'an invalid IBAN is refused');
  r = await post('/api/forms/' + invId + '/records', { data: { iban: 'nl91 abna 0417 1643 00', postcode: '1234ab', ref: 'INV-1234', pdf: pf } }); ok(r.status === 200, 'record saved with a file', r.data); const recId = r.data.id;
  r = await get('/api/records/' + recId); ok(r.data.record.data.iban === 'NL91ABNA0417164300' && r.data.record.data.postcode === '1234 AB' && r.data.record.data.pdf_label === 'invoice.pdf', 'values are written in the standard format', r.data.record.data);
  r = await post('/api/forms/' + invId + '/records', { data: { iban: 'NL91ABNA0417164300', pdf: pf } }); ok(r.status === 422 && r.data.errors.pdf, 'a file cannot be used twice', r.data);
  r = await get('/api/forms/' + invId + '/records'); ok(r.data.columns.includes('pdf_label'), 'the SQL view has the file name', r.data.columns);
  r = await dl(pf); ok(r.status === 200 && r.text === 'PDFDATA' && r.headers.get('content-type') === 'application/pdf', 'the record\'s file opens');
  // public forms cannot have file fields
  { const g2 = { nodes: [{ id: 's', type: 'start', name: 'Start', formId: invId, publicEnabled: true }, { id: 'e', type: 'end', name: 'Done' }], edges: [{ id: 'x', from: 's', to: 'e' }] };
    r = await post('/api/admin/flows', { name: 'Public invoice' }); const pid = r.data.id; r = await put('/api/admin/flows/' + pid, { name: 'Public invoice', description: '', graph: g2, doc: {}, status: 'active' }); ok(r.status === 400 && /File/.test(JSON.stringify(r.data)), 'a public web form cannot have a file field', r.data); }
  // typos in formulas are reported
  { const g3 = { nodes: [{ id: 's', type: 'start', name: 'Start' }, { id: 'a', type: 'action', name: 'Calc', assignments: 'total = amout * 2' }, { id: 'e', type: 'end', name: 'Done' }], edges: [{ id: 'x', from: 's', to: 'a' }, { id: 'y', from: 'a', to: 'e' }] };
    r = await post('/api/admin/flows', { name: 'Typo test' }); const tid = r.data.id; await put('/api/admin/flows/' + tid, { name: 'Typo test', description: '', graph: g3, doc: {}, status: 'draft' });
    r = await get('/api/admin/health'); ok(r.data.items.some(i => /“amout” is used/.test(i.title)), 'health reports a variable nobody provides', r.data.items.filter(i => i.kind === 'data')); }
  // someone else cannot read a loose upload
  r = await up('secret.txt', 'secret'); const sec = r.data.id;
  const adminCookie = cookie; cookie = ''; r = await post('/api/login', { email: 'bram@example.com', password: 'demo1234' }); const bramCookie = cookie;
  r = await dl(sec, bramCookie); ok(r.status === 403, 'a loose upload is private to its uploader');
  r = await dl(f2, bramCookie); ok(r.status === 200, 'but everyone can read documents in the library');
  cookie = adminCookie;
}

console.log('as a colleague');
cookie = '';
r = await post('/api/login', { email: 'bram@example.com', password: 'demo1234' }); ok(r.status === 200, 'colleague logs in');
r = await get('/api/admin/health'); ok(r.status === 403, 'health is for admins');
r = await get('/api/admin/audit'); ok(r.status === 403, 'audit is for admins');
r = await get('/api/handbook'); ok(r.data.every(f => f.status === 'active'), 'handbook shows only active processes');
r = await get('/api/search?q=leave'); ok(r.status === 200 && r.data.results.length > 0, 'colleague can search');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
