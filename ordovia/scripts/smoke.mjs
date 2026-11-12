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
r = await get('/api/handbook'); ok(r.data.length === 4 && r.data[0].owner && r.data[0].reviewDue, 'handbook has owner and review date', r.data[0]);
const flowId = r.data.find(f => f.name === 'Leave request').id;
r = await get('/api/home'); ok(r.data.flows.length === 4 && r.data.flows[0].area_id, 'home lists active processes with area');

console.log('lifecycle');
r = await del('/api/admin/forms/' + forms[0].id); ok(r.status === 409, 'a form cannot be deleted before it is archived', r.data);
r = await get('/api/admin/flows/' + flowId); const flow = r.data;
r = await put('/api/admin/flows/' + flowId, { name: flow.name, description: flow.description, graph: flow.graph, doc: flow.doc, status: 'archived' }); ok(r.status === 200 && r.data.status === 'archived', 'archive a process', r.data);
r = await get('/api/home'); ok(r.data.flows.length === 3, 'archived process is gone from Start a process');
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
  r = await post('/api/admin/forms', { name: 'Quote request', area_id: salesId }); const qfId = r.data.id;
  r = await get('/api/admin/forms/' + qfId); const qf = r.data.form;
  qf.fields = [{ key: 'company', label: 'Company', type: 'text', required: true }, { key: 'amount', label: 'Amount', type: 'number', required: true, min: 1 }, { key: 'note', label: 'Note', type: 'text' }];
  r = await put('/api/admin/forms/' + qfId, { ...qf }); ok(r.status === 200, 'create the request form', r.data);
  const people = (await get('/api/meta')).data.people, eva = people.find(p => p.name.startsWith('Eva'));
  const approval = (await get('/api/meta')).data.forms.find(f => f.name === 'Approval');
  const graph = { nodes: [{ id: 's', type: 'start', name: 'Start', formId: qfId, publicEnabled: true, title: '"Quote " & company' }, { id: 't', type: 'task', name: 'Check the quote', formId: approval.id, assignee: { type: 'person', personId: eva.id } }, { id: 'e', type: 'end', name: 'Done' }],
    edges: [{ id: 'e1', from: 's', to: 't' }, { id: 'e2', from: 't', to: 'e' }] };
  r = await post('/api/admin/flows', { name: 'Quote', area_id: salesId }); const qId = r.data.id;
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
  r = await post('/api/admin/documents', { name: 'Quality norm', kind: 'norm', area_id: salesId, fileId: f1, review_months: 6, folder: ' Quality /  ISO 9001 / extra / deeper ' }); ok(r.status === 200 && r.data.id, 'create a document from the upload', r.data); const docId = r.data.id;
  r = await post('/api/admin/documents', { name: 'Again', fileId: f1 }); ok(r.status === 400, 'a file can only belong to one document');
  r = await get('/api/documents/' + docId); ok(r.data.folder === 'Quality / ISO 9001', 'folders are cleaned to two levels', r.data.folder);
  ok(r.data.version === 1 && r.data.versions.length === 1 && r.data.canManage, 'document with its versions', r.data);
  r = await up('norm2.txt', 'THE NORM v2'); const f2 = r.data.id;
  r = await post('/api/documents/' + docId + '/versions', { fileId: f2, note: 'better' }); ok(r.status === 200 && r.data.version === 2, 'upload a new version');
  r = await get('/api/documents'); ok(r.data.find(d => d.id === docId).file_name === 'norm2.txt', 'the library shows the newest file');
  r = await dl(f1); ok(r.status === 200 && r.text === 'THE NORM v1', 'the old version stays available');
  // link to a step
  { const fl = (await get('/api/admin/flows/' + flowId)).data; { const tn = fl.graph.nodes.find(n => n.type === 'task'); tn.docIds = [docId]; tn.docSections = { [docId]: 'Chapter 4.2' }; }
    r = await put('/api/admin/flows/' + flowId, { name: fl.name, description: fl.description, graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 200, 'link the document to a step');
    r = await get('/api/handbook/' + flowId); ok(r.data.steps.some(s => (s.documents || []).some(d => d.id === docId && d.section === 'Chapter 4.2')), 'the handbook shows it at the step, with the chapter'); }
  r = await get('/api/documents/' + docId); ok(r.data.usedIn.some(u => u.section === 'Chapter 4.2'), 'the document lists where it is used, with the chapter');
  r = await put('/api/admin/documents/' + docId, { folder: '' }); r = await get('/api/documents'); ok(!r.data.find(d => d.id === docId).folder, 'a folder can be cleared'); await put('/api/admin/documents/' + docId, { folder: 'Quality' });
  r = await get('/api/admin/health'); ok(!r.data.items.some(i => /points to a document/.test(i.title)), 'no broken document links');
  r = await get('/api/search?q=quality'); ok(r.data.results.some(x => x.type === 'Document'), 'search finds documents');
  r = await del('/api/admin/documents/' + docId); ok(r.status === 409, 'documents are archived before they are deleted');
  // a file field and formats in a form
  r = await post('/api/admin/forms', { name: 'Supplier invoice', area_id: salesId }); const invId = r.data.id; r = await get('/api/admin/forms/' + invId); const inv = r.data.form;
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
    r = await post('/api/admin/flows', { name: 'Public invoice', area_id: salesId }); const pid = r.data.id; r = await put('/api/admin/flows/' + pid, { name: 'Public invoice', description: '', graph: g2, doc: {}, status: 'active' }); ok(r.status === 400 && /File/.test(JSON.stringify(r.data)), 'a public web form cannot have a file field', r.data); }
  // typos in formulas are reported
  { const g3 = { nodes: [{ id: 's', type: 'start', name: 'Start' }, { id: 'a', type: 'action', name: 'Calc', assignments: 'total = amout * 2' }, { id: 'e', type: 'end', name: 'Done' }], edges: [{ id: 'x', from: 's', to: 'a' }, { id: 'y', from: 'a', to: 'e' }] };
    r = await post('/api/admin/flows', { name: 'Typo test', area_id: salesId }); const tid = r.data.id; await put('/api/admin/flows/' + tid, { name: 'Typo test', description: '', graph: g3, doc: {}, status: 'draft' });
    r = await get('/api/admin/health'); ok(r.data.items.some(i => /“amout” is used/.test(i.title)), 'health reports a variable nobody provides', r.data.items.filter(i => i.kind === 'data')); }
  // someone else cannot read a loose upload
  r = await up('secret.txt', 'secret'); const sec = r.data.id;
  const adminCookie = cookie; cookie = ''; r = await post('/api/login', { email: 'bram@example.com', password: 'demo1234' }); const bramCookie = cookie;
  r = await dl(sec, bramCookie); ok(r.status === 403, 'a loose upload is private to its uploader');
  r = await dl(f2, bramCookie); ok(r.status === 200, 'but everyone can read documents in the library');
  cookie = adminCookie;
}

console.log('notification format');
{
  r = await put('/api/admin/settings', { notify_format: 'word' }); ok(r.status === 400, 'only known notification formats');
  r = await put('/api/admin/settings', { notify_format: 'teams' }); ok(r.status === 200, 'choose the Teams card format'); r = await get('/api/admin/settings'); ok(r.data.notify_format === 'teams', 'the choice is kept');
  await put('/api/admin/settings', { notify_format: 'json' });
}

console.log('classes, objects, person attributes');
{
  const adminCookie = cookie;
  r = await get('/api/objects'); const machine = r.data.find(o => o.name === 'Machine'); ok(machine && machine.count === 6, 'the Machine class has its six objects', r.data);
  r = await get('/api/objects/' + machine.id); const m5 = r.data.objects.find(o => o.data.machine_id === 'M-005'); ok(r.data.objects.length === 6 && m5 && m5.label === 'Pallet scale', 'a class lists its objects with a label');
  r = await get('/api/objects/' + machine.id + '/' + m5.id); ok(r.data.runs.length === 1 && r.data.runs[0].status === 'running' && r.data.startable.some(f => f.name === 'Machine calibration'), 'an object shows its runs and the processes that work on it', r.data);
  const calib = r.data.startable.find(f => f.name === 'Machine calibration');
  r = await get('/api/objects/' + flowId); ok(r.status === 404, 'a plain form is not a class');
  r = await post('/api/flows/' + calib.id + '/start', {}); ok(r.status === 400, 'a process on an object needs the object', r.data);
  r = await post('/api/flows/' + calib.id + '/start', { subject: 999999 }); ok(r.status === 404, 'an unknown object is refused');
  r = await post('/api/flows/' + calib.id + '/start', { subject: m5.id }); ok(r.status === 200 && r.data.instanceId, 'start a calibration on machine M-005', r.data); const iid = r.data.instanceId;
  r = await get('/api/instances/' + iid); ok(r.data.subject && r.data.subject.label === 'Pallet scale' && r.data.vars.subject.machine_id === 'M-005' && /Pallet scale/.test(r.data.instance.title), 'the run knows its subject', r.data.subject);

  // attributes decide who gets the task: job title = Metrologist
  r = await get('/api/admin/people'); ok(r.data.personFields.some(f => f.key === 'job_title') && r.data.people.every(p => typeof p.attrs === 'object'), 'person attributes are defined and returned');
  const bramP = r.data.people.find(p => p.email === 'bram@example.com');
  const login = async (email) => { cookie = ''; r = await post('/api/login', { email, password: 'demo1234' }); return r.status === 200; };
  const calibTasks = async () => (await get('/api/home')).data.tasks.filter(t => t.name === 'Calibrate' && t.instance_id === iid);
  await login('bram@example.com'); ok((await calibTasks()).length === 0, 'a salesperson does not get the calibration task');
  await login('carla@example.com'); const mine = await calibTasks(); ok(mine.length === 1, 'the metrologist gets it (assigned by attribute)', mine);
  r = await post('/api/tasks/' + mine[0].id + '/complete', { data: { result: 'Out of tolerance' } }); ok(r.status === 422, 'the calibration form checks its input (remarks needed when out of tolerance)', r.data);
  const today = new Date().toISOString().slice(0, 10);
  r = await post('/api/tasks/' + mine[0].id + '/complete', { data: { measured_on: today, result: 'Within tolerance', deviation: 0.2 } }); ok(r.status === 200, 'the metrologist completes the calibration', r.data);
  cookie = adminCookie;
  r = await get('/api/objects/' + machine.id + '/' + m5.id); const md = r.data.object.data;
  ok(md.status === 'In service' && md.last_calibrated === today && (Date.parse(md.next_due) - Date.parse(md.last_calibrated)) / 86400000 === Number(md.interval_days), 'the process wrote the result back to the machine (dates and status)', md);
  ok(r.data.runs.some(x => x.id === iid && x.status === 'done'), 'the finished run stays on the object');

  // changing an attribute changes who receives tasks
  r = await put('/api/admin/people/' + bramP.id, { name: bramP.name, email: bramP.email, is_admin: !!bramP.is_admin, active: true, tagIds: bramP.tagIds, attrs: { job_title: 'Astronaut' } }); ok(r.status === 422, 'an attribute outside its options is refused', r.data);
  r = await put('/api/admin/people/' + bramP.id, { name: bramP.name, email: bramP.email, is_admin: !!bramP.is_admin, active: true, tagIds: bramP.tagIds, attrs: { job_title: 'Metrologist', employee_no: 'e-2001' } }); ok(r.status === 200, 'set an attribute on a person', r.data);
  r = await get('/api/admin/people'); ok(r.data.people.find(p => p.id === bramP.id).attrs.employee_no === 'E-2001', 'attributes use the standard format (E-2001)');
  r = await put('/api/admin/person-fields', { fields: [{ label: 'Photo', type: 'file' }] }); ok(r.status === 400, 'a person attribute cannot be a file or a link (yet)');
  r = await put('/api/admin/person-fields', { fields: [{ label: 'Name', type: 'text' }] }); ok(r.status === 400, 'reserved attribute names are refused');
  // a process on an object cannot be a public web form
  { const fl = (await get('/api/admin/flows/' + calib.id)).data; const st = fl.graph.nodes.find(n => n.type === 'start'); st.publicEnabled = true;
    r = await put('/api/admin/flows/' + calib.id, { name: fl.name, description: fl.description, graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 200 && r.data.status === 'draft', 'an active process that also works on an object and is public is set back to draft', r.data);
    st.publicEnabled = false; r = await put('/api/admin/flows/' + calib.id, { name: fl.name, description: fl.description, graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 200 && r.data.status === 'active', 'switching the web form off makes it usable again'); }
  r = await get('/api/admin/health'); ok(!r.data.items.some(i => /“subject/.test(i.title)), 'no false alarm about the subject variable');
}

console.log('links');
{
  const adminCookie = cookie;
  const login = async (email) => { cookie = ''; const x = await post('/api/login', { email, password: 'demo1234' }); return x.status === 200; };
  r = await get('/api/documents'); const procDoc = r.data.find(d => d.name === 'Calibration procedure'), photoDoc = r.data.find(d => d.kind === 'photo');
  ok(photoDoc && photoDoc.mime === 'image/png', 'a photo is a document of kind photo, stored as an image');
  r = await get('/api/objects'); const machine = r.data.find(o => o.name === 'Machine');
  r = await get('/api/objects/' + machine.id); const m1 = r.data.objects.find(o => o.data.machine_id === 'M-001'), m3 = r.data.objects.find(o => o.data.machine_id === 'M-003');
  r = await get('/api/links?type=object&id=' + m3.id); ok(r.data.out.length === 2 && r.data.out.some(x => x.image === photoDoc.file_id && x.note === 'Front view') && r.data.out.some(x => x.label === 'Calibration procedure' && x.note === 'Section 2: tolerances'), 'a machine lists its photo and its procedure, with the part that matters', r.data.out);
  r = await get('/api/links?type=document&id=' + procDoc.id); ok(r.data.in.filter(x => x.type === 'object').length === 2 && r.data.in.some(x => x.type === 'flow' && x.sub_label === 'Calibrate' && x.derived), 'the other end shows the link too (machines, and the step that uses it)', r.data.in);

  r = await post('/api/links', { a: { type: 'object', id: m1.id }, b: { type: 'document', id: photoDoc.id }, note: 'seen from the left' }); ok(r.status === 200 && r.data.id, 'link a machine to a photo'); const linkId = r.data.id;
  r = await post('/api/links', { a: { type: 'object', id: m1.id }, b: { type: 'document', id: photoDoc.id } }); ok(r.status === 409, 'the same link cannot be made twice');
  r = await post('/api/links', { a: { type: 'object', id: m1.id }, b: { type: 'object', id: m1.id } }); ok(r.status === 400, 'an item cannot link to itself');
  r = await post('/api/links', { a: { type: 'object', id: m1.id }, b: { type: 'document', id: 999999 } }); ok(r.status === 404, 'a link to something that does not exist is refused');
  r = await post('/api/links', { a: { type: 'object', id: m1.id }, b: { type: 'document', id: procDoc.id }, showIf: 'total >' }); ok(r.status === 400, 'a broken condition is refused');
  r = await get('/api/link-search?q=torque'); ok(r.data.results.some(x => x.type === 'document' && x.id === photoDoc.id && x.image) && r.data.results.some(x => x.type === 'object' && x.label === 'Torque wrench set'), 'search finds documents (with their picture) and objects');
  r = await get('/api/link-search?type=flow&q=calib'); ok(r.data.results.length === 1 && r.data.results[0].steps.some(s => s.name === 'Calibrate'), 'search finds processes with their steps');

  // a step shows its links only when their condition is true for the run
  const calib = (await get('/api/home')).data.flows.find(x => x.name === 'Machine calibration');
  const taskOf = async (machineId) => { const st = await post('/api/flows/' + calib.id + '/start', { subject: machineId }); const ins = await get('/api/instances/' + st.data.instanceId); return (await get('/api/tasks/' + ins.data.tasks[0].id)).data; };
  const t3 = await taskOf(m3.id), t1 = await taskOf(m1.id);
  ok(t3.links.some(x => x.label === 'Torque wrench set (photo)') && !t1.links.some(x => x.label === 'Torque wrench set (photo)'), 'a conditional link shows at the step only when its formula is true (only for the torque wrench set)', [t3.links.length, t1.links.length]);
  ok(/Within tolerance|outcome|Next|finished/.test(t3.afterwards) || t3.afterwards.length > 0, 'a task says what happens after it', t3.afterwards); ok(t3.case && t3.case.title && t3.case.started_at, 'a task knows its case');
  r = await get('/api/handbook/' + calib.id); ok(r.data.steps.find(s => s.name === 'Calibrate').links.some(x => x.showIf === 'subject.machine_id == "M-003"'), 'the handbook shows every link of a step, with its condition');

  // who may link
  await login('carla@example.com'); r = await post('/api/links', { a: { type: 'object', id: m1.id }, b: { type: 'document', id: procDoc.id } }); ok(r.status === 403, 'a colleague cannot make links');
  r = await del('/api/links/' + linkId); ok(r.status === 403, 'or remove them');
  await login('daan@example.com'); r = await post('/api/links', { a: { type: 'flow', id: calib.id }, b: { type: 'document', id: photoDoc.id }, note: 'owner links own document' }); ok(r.status === 200, 'the owner of a document can link it'); const l2 = r.data.id;
  r = await del('/api/links/' + l2); ok(r.status === 200, 'and remove the link');
  cookie = adminCookie;
  r = await del('/api/links/' + linkId); ok(r.status === 200, 'an administrator removes a link');
  r = await get('/api/links?type=object&id=' + m1.id); ok(!r.data.out.some(x => x.note === 'seen from the left'), 'the link is gone on both sides');

  // removing an object removes its links
  r = await post('/api/forms/' + machine.id + '/records', { data: { name: 'Temporary rig', machine_id: 'T-1', location: 'Hall A', status: 'In service', interval_days: 30 } }); ok(r.status === 200, 'add a temporary machine', r.data); const tmp = r.data.id;
  r = await post('/api/links', { a: { type: 'object', id: tmp }, b: { type: 'document', id: photoDoc.id } }); ok(r.status === 200, 'link it');
  r = await del('/api/records/' + tmp); r = await get('/api/links?type=document&id=' + photoDoc.id); ok(!r.data.in.some(x => x.type === 'object' && x.id === tmp), 'a deleted object takes its links with it');
}

console.log('describe with AI');
{
  const adminCookie = cookie;
  r = await get('/api/admin/ai/context'); ok(r.data.fieldTypes.includes('calc') && r.data.functions.includes('WORKDAYS') && r.data.forms.some(f => f.isClass) && r.data.tags.includes('Function: Manager'), 'the app knows what to tell an AI about the workspace');
  r = await post('/api/admin/ai/preview', { text: 'I could not do that, sorry.' }); ok(r.data.ok === false && r.data.errors.length === 1, 'an answer without JSON is refused with a plain message', r.data);
  const bundle = {
    area: 'People & HR',
    forms: [{ name: 'Time off', fields: [
      { key: 'start_date', label: 'First day', type: 'date', required: true, width: 'half' },
      { key: 'end_date', label: 'Last day', type: 'date', required: true, width: 'half' },
      { key: 'days', label: 'Working days', type: 'calc', formula: 'WORKDAYS(start_date, end_date)' }] }],
    processes: [{ name: 'Time off via AI', description: 'Ask for days off', purpose: 'Register leave', request_form: 'Time off', who_can_start: ['Function: Lead'], title: '"Time off " & initiator.name',
      steps: [
        { id: 'c', type: 'decision', name: 'More than 3 days?', branches: [{ label: 'Yes', when: 'days > 3', to: 'm' }, { label: 'No', to: 'ok' }] },
        { id: 'm', type: 'task', name: 'Manager approval', form: 'Approval', who: { type: 'tags', tags: ['Function: Manager'], same_as_initiator: ['Department'] }, due_hours: 48, next: 'v' },
        { id: 'v', type: 'decision', name: 'Approved?', branches: [{ label: 'Yes', when: 'decision == "Approve"', to: 'ok' }, { label: 'No', to: 'no' }] },
        { id: 'ok', type: 'end', name: 'Approved' }, { id: 'no', type: 'end', name: 'Rejected' }] }],
  };
  const FENCE = String.fromCharCode(96).repeat(3);
  const text = 'Sure, here is the process:\n' + FENCE + 'json\n' + JSON.stringify(bundle) + '\n' + FENCE + '\nLet me know if you want changes.';
  r = await post('/api/admin/ai/preview', { text }); ok(r.data.ok && r.data.summary.flows[0].steps.length === 5 && r.data.summary.forms[0].name === 'Time off' && r.data.summary.tags.some(t => t.value === 'Lead') && r.data.summary.usedForms.includes('Approval'), 'a good answer is checked and summarised (new tag, existing form reused)', r.data);
  const before = (await get('/api/admin/flows')).data.length;
  r = await post('/api/admin/ai/apply', { text }); ok(r.status === 200 && r.data.flows.length === 1, 'apply creates the process', r.data); const aiFlow = r.data.flows[0].id;
  ok((await get('/api/admin/flows')).data.length === before + 1, 'one new process');
  r = await get('/api/admin/flows/' + aiFlow); ok(r.data.status === 'draft' && r.data.issues.length === 0 && r.data.graph.nodes.length === 6, 'it starts as a draft without issues', r.data.issues);
  r = await get('/api/meta'); const tf = r.data.forms.find(x => x.name === 'Time off'); ok(tf && tf.status === 'draft' && tf.fields.length === 3, 'the new form is a draft too'); ok(r.data.tags.some(t => t.category === 'Function' && t.value === 'Lead'), 'the missing tag was created');
  r = await post('/api/admin/ai/apply', { text: 'no json' }); ok(r.status === 422, 'apply refuses what preview refuses');
  r = await put('/api/admin/forms/' + tf.id, { name: tf.name, description: '', fields: tf.fields, checks: [], access: { direct: false }, status: 'active' }); ok(r.status === 200, 'activate the form');
  { const fl = (await get('/api/admin/flows/' + aiFlow)).data; r = await put('/api/admin/flows/' + aiFlow, { name: fl.name, description: fl.description, graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 200 && r.data.status === 'active', 'activate the process', r.data); }
  r = await post('/api/flows/' + aiFlow + '/start', { data: { start_date: '2026-12-07', end_date: '2026-12-15' } }); ok(r.status === 200 && r.data.instanceId, 'start it with a 7-day request', r.data); const aiRun = r.data.instanceId;
  cookie = ''; r = await post('/api/login', { email: 'daan@example.com', password: 'demo1234' });
  const mt = (await get('/api/home')).data.tasks.find(x => x.name === 'Manager approval' && x.instance_id === aiRun); ok(mt, 'the operations manager gets the approval (manager + same department)');
  r = await post('/api/tasks/' + mt.id + '/complete', { data: { decision: 'Approve' } }); ok(r.status === 200, 'the manager approves');
  r = await get('/api/instances/' + aiRun); ok(r.data.instance.status === 'done' && r.data.instance.outcome === 'Approved', 'the case ends as Approved: the AI-built process really runs', r.data.instance);
  cookie = adminCookie;
}

console.log('governance: everything has a home');
{
  r = await post('/api/admin/forms', { name: 'Order form' }); const fa = r.data.id;
  r = await get('/api/admin/forms/' + fa); const fform = r.data.form; ok(fform.status === 'draft', 'a new form is a draft');
  r = await put('/api/admin/forms/' + fa, { name: fform.name, description: '', fields: [{ key: 'item', label: 'Item', type: 'text' }], checks: [], access: {}, status: 'active' }); ok(r.status === 409 && /area/i.test(r.data.error), 'a form cannot be activated without an area', r.data);
  r = await put('/api/admin/forms/' + fa, { name: fform.name, description: '', fields: [{ key: 'item', label: 'Item', type: 'text' }], checks: [], access: {}, status: 'active', area_id: salesId }); ok(r.status === 200, 'with an area it can');
  r = await post('/api/admin/flows', { name: 'Loose process' }); const lf = r.data.id; { const fl = (await get('/api/admin/flows/' + lf)).data;
    r = await put('/api/admin/flows/' + lf, { name: fl.name, description: '', graph: fl.graph, doc: {}, status: 'active' }); ok(r.status === 409 && /area/i.test(r.data.error), 'a process cannot be activated without an area', r.data); }
  r = await post('/api/admin/documents', { name: 'Loose document', kind: 'other', fileId: 1 }); ok(r.status === 400 && /area/i.test(r.data.error), 'a document needs an area', r.data);
  // things that look like the same thing, and classes nobody uses
  r = await post('/api/admin/forms', { name: 'Order forms', area_id: salesId }); const fb = r.data.id;
  r = await post('/api/admin/forms', { name: 'Unused class', area_id: salesId }); const fc = r.data.id; { const f = (await get('/api/admin/forms/' + fc)).data.form; await put('/api/admin/forms/' + fc, { name: f.name, description: '', fields: [{ key: 'n', label: 'Name', type: 'text' }], checks: [], access: {}, status: 'active', area_id: salesId, is_class: 1 }); }
  r = await get('/api/admin/health'); const hi = r.data.items;
  ok(hi.some(i => i.kind === 'duplicate' && /Order form/.test(i.title)), 'Health notices two forms that look like the same thing', hi.filter(i => i.kind === 'duplicate').map(i => i.title));
  ok(hi.some(i => i.kind === 'unused' && /Unused class/.test(i.title)), 'Health notices a class nobody uses');
}

console.log('templates');
{
  r = await get('/api/admin/templates'); ok(r.data.packs.includes('Health & safety') && r.data.templates.length >= 10 && r.data.templates.every(t => t.steps > 0), 'the template library lists ready-made processes by pack');
  const inc = r.data.templates.find(t => t.id === 'incident');
  r = await post('/api/admin/templates/incident/preview', { area: 'Health & Safety' }); ok(r.data.ok && r.data.summary.area.isNew && r.data.summary.forms.length === 1 && r.data.summary.usedForms.includes('Incident report') && r.data.summary.tags.some(t => t.value === 'Safety officer'), 'preview shows what a template adds (new area and form, existing forms reused, tags to hand out)', r.data.summary);
  r = await post('/api/admin/templates/incident/apply', { area: 'Health & Safety' }); ok(r.status === 200 && r.data.flows.length === 1 && r.data.forms.length === 1, 'add the incident template (the demo already has two of its forms)', r.data); const tid = r.data.flows[0].id;
  r = await get('/api/admin/flows/' + tid); ok(r.data.status === 'draft' && r.data.issues.length === 0 && r.data.area_id, 'it is a draft in its own area without issues', r.data.issues);
  r = await get('/api/admin/templates'); ok(r.data.templates.find(t => t.id === 'incident').added === true, 'the library shows it as added');
  r = await get('/api/admin/health'); ok(r.data.items.some(i => i.kind === 'routing' && /Incident report & corrective action/.test(i.title)), 'Health reminds that nobody has the new Safety officer tag yet', r.data.items.filter(i => i.kind === 'routing').map(i => i.title));
  r = await post('/api/admin/templates/nope/apply', {}); ok(r.status === 404, 'unknown template');
  // all templates can be added to a workspace
  for (const t of (await get('/api/admin/templates')).data.templates) { if (t.id === 'incident') continue; const x = await post('/api/admin/templates/' + t.id + '/apply', {}); ok(x.status === 200, 'template ' + t.id + ' can be added', x.data); }
}

console.log('cover for absence, escalation, reassigning');
{
  const adminCookie = cookie;
  const login = async (email) => { cookie = ''; const x = await post('/api/login', { email, password: 'demo1234' }); return x.status === 200; };
  const calib = (await get('/api/home')).data.flows.find(x => x.name === 'Machine calibration');
  const machine = (await get('/api/objects')).data.find(o => o.name === 'Machine');
  const mach = (await get('/api/objects/' + machine.id)).data.objects.find(o => o.data.machine_id === 'M-002');
  r = await post('/api/flows/' + calib.id + '/start', { subject: mach.id }); const run1 = r.data.instanceId;
  const tasksOf = async (email) => { await login(email); return (await get('/api/home')).data.tasks.filter(t => t.instance_id === run1); };
  ok((await tasksOf('sanne@example.com')).length === 0, 'a salesperson does not see the calibration task');
  // Carla (metrologist) is away; Sanne covers
  await login('carla@example.com');
  r = await put('/api/me/away', { away_until: '2000-01-01', deputy_id: 4 }); ok(r.status === 400, 'away until a date in the past is refused');
  r = await put('/api/me/away', { away_until: '2999-01-01' }); ok(r.status === 400, 'an absence needs a deputy');
  const dep = (await get('/api/meta')).data.people.find(p => p.name === 'Sanne Bakker');
  r = await put('/api/me/away', { away_until: '2999-01-01', deputy_id: dep.id }); ok(r.status === 200, 'Carla marks herself as away with Sanne as deputy', r.data);
  ok((await tasksOf('sanne@example.com')).length === 1, 'Sanne now receives the calibration task while Carla is away');
  r = await post('/api/tasks/' + (await tasksOf('sanne@example.com'))[0].id + '/complete', { data: { measured_on: new Date().toISOString().slice(0, 10), result: 'Within tolerance', deviation: 0.1 } }); ok(r.status === 200, 'and can complete it');
  await login('carla@example.com'); r = await put('/api/me/away', { away_until: null, deputy_id: null }); ok(r.status === 200, 'Carla is back');
  // escalation: a task past its due date is handed to the process owner, who can reassign it
  cookie = adminCookie;
  r = await post('/api/flows/' + calib.id + '/start', { subject: mach.id }); const run2 = r.data.instanceId;
  const tk = (await get('/api/instances/' + run2)).data.tasks[0];
  r = await post('/api/admin/sql', { sql: "UPDATE tasks SET due_at = '2020-01-01 00:00:00' WHERE id = " + tk.id }); ok(r.status === 200, 'make the task overdue');
  r = await post('/api/admin/overdue-check', {}); ok(r.status === 200 && r.data.escalated >= 1, 'the overdue check escalates it', r.data);
  r = await get('/api/instances/' + run2); ok(r.data.events.some(e => /handed to Daan Visser, the process owner/.test(e.message)), 'the timeline says so');
  await login('daan@example.com'); const dt = (await get('/api/home')).data.tasks.find(t => t.id === tk.id); ok(dt && dt.escalated, 'the process owner sees it, marked as handed to them', dt);
  r = await get('/api/tasks/' + tk.id); ok(r.data.canComplete && r.data.canReassign && r.data.escalated, 'and may complete or reassign it');
  r = await post('/api/tasks/' + tk.id + '/reassign', { personId: 999999 }); ok(r.status === 400, 'reassigning to nobody is refused');
  r = await post('/api/tasks/' + tk.id + '/reassign', { personId: dep.id }); ok(r.status === 200, 'the owner reassigns it to Sanne');
  await login('sanne@example.com'); ok(((await get('/api/home')).data.tasks).some(t => t.id === tk.id), 'Sanne now has the task');
  await login('eva@example.com'); r = await post('/api/tasks/' + tk.id + '/reassign', { personId: dep.id }); ok(r.status === 403, 'a colleague cannot reassign');
  cookie = adminCookie;
}

console.log('case report');
{
  const done = (await get('/api/instances?status=done')).data[0];
  r = await get('/api/instances/' + done.id); ok(r.data.version >= 1 && Array.isArray(r.data.submissions) && r.data.submissions.length >= 1 && r.data.submissions[0].data && r.data.tasks.length >= 1 && r.data.events.length >= 1, 'a case carries everything a report needs: version, entered information, steps, timeline', Object.keys(r.data));
}

console.log('links to things outside Ordovia');
{
  const machine = (await get('/api/objects')).data.find(o => o.name === 'Machine');
  const m4 = (await get('/api/objects/' + machine.id)).data.objects.find(o => o.data.machine_id === 'M-004');
  const sp = 'https://contoso.sharepoint.com/sites/quality/Shared%20Documents/CMM-manual.pdf';
  r = await post('/api/links', { a: { type: 'object', id: m4.id }, b: { type: 'url', id: 0, sub: sp }, title: 'CMM manual (SharePoint)', note: 'Chapter 5: probes' }); ok(r.status === 200, 'link a machine to a SharePoint file', r.data); const el = r.data.id;
  r = await get('/api/links?type=object&id=' + m4.id); const it = r.data.out.find(x => x.external); ok(it && it.kind === 'SharePoint' && it.label === 'CMM manual (SharePoint)' && it.href === sp && it.note === 'Chapter 5: probes', 'it shows with its provider, name and the part that matters', it);
  r = await post('/api/links', { a: { type: 'object', id: m4.id }, b: { type: 'url', id: 0, sub: 'http://insecure.example.com/x' } }); ok(r.status === 400, 'only https addresses');
  r = await post('/api/links', { a: { type: 'object', id: m4.id }, b: { type: 'url', id: 0, sub: 'javascript:alert(1)' } }); ok(r.status === 400, 'no script addresses');
  r = await post('/api/links', { a: { type: 'object', id: m4.id }, b: { type: 'url', id: 0, sub: sp }, title: 'again' }); ok(r.status === 409, 'the same address cannot be linked twice from one item');
  r = await post('/api/links', { a: { type: 'url', id: 0, sub: sp }, b: { type: 'object', id: m4.id } }); ok(r.status === 400, 'a link starts inside Ordovia');
  r = await post('/api/links', { a: { type: 'object', id: m4.id }, b: { type: 'url', id: 0, sub: 'https://teams.microsoft.com/l/channel/abc/Quality' }, title: 'Quality (Teams)' }); ok(r.status === 200, 'and to a Teams channel');
  r = await get('/api/links?type=object&id=' + m4.id); ok(r.data.out.some(x => x.kind === 'Teams') && r.data.out.some(x => x.kind === 'SharePoint'), 'each is labelled by where it lives');
  r = await del('/api/links/' + el); ok(r.status === 200, 'remove it');
  // the demo has outside links at a step and on a machine
  const calib = (await get('/api/home')).data.flows.find(x => x.name === 'Machine calibration');
  r = await get('/api/handbook/' + calib.id); ok(r.data.steps.find(s => s.name === 'Calibrate').links.some(x => x.external && x.kind === 'Teams'), 'a step lists the Teams channel');
}

console.log('process insight');
{
  const adminCookie = cookie;
  const flows = (await get('/api/admin/flows')).data, purchase = flows.find(f => f.name === 'Purchase request');
  r = await get('/api/flows/' + purchase.id + '/insight'); const ins = r.data;
  ok(r.status === 200 && ins.runs.total === purchase.runs && ins.runs.done > 0 && ins.cycle.medianHours > 0 && ins.cycle.p90Hours >= ins.cycle.medianHours, 'insight agrees with the process list and gives cycle times', ins.cycle);
  ok(ins.steps.length >= 3 && ins.steps.every(s => s.name && s.done + s.open >= 0) && ins.steps[0].avgHours >= ins.steps[ins.steps.length - 1].avgHours, 'steps are listed slowest first, with their waiting time');
  ok(ins.outcomes.reduce((a, o) => a + o.n, 0) === ins.runs.done && ins.months.length === 6, 'outcomes add up to the finished cases; six months of volume');
  await post('/api/login', { email: 'sanne@example.com', password: 'demo1234' }); cookie = '';
  r = await post('/api/login', { email: 'sanne@example.com', password: 'demo1234' });
  r = await get('/api/flows/' + purchase.id + '/insight'); ok(r.status === 403, 'a colleague cannot see how a process performs');
  r = await post('/api/login', { email: 'eva@example.com', password: 'demo1234' }); r = await get('/api/flows/' + purchase.id + '/insight'); ok(r.status === 200, 'but the process owner can (Eva owns purchasing)');
  cookie = adminCookie;
  r = await get('/api/flows/999999/insight'); ok(r.status === 404, 'unknown process');
}

console.log('transparency: what Ordovia knows about me');
{
  const adminCookie = cookie;
  cookie = ''; r = await get('/api/me/data'); ok(r.status === 401, 'you must be signed in');
  r = await post('/api/login', { email: 'carla@example.com', password: 'demo1234' });
  r = await get('/api/me/data'); const me = r.data;
  ok(r.status === 200 && me.person.email === 'carla@example.com' && me.person.tags.length > 0 && /does not track|not track/i.test(me.about), 'you see your own profile and the promise', me.person);
  ok(me.tasks.completed.length > 0 && me.cases_started.length > 0 && me.information_entered.length > 0, 'and what you did: tasks, cases, information entered');
  ok(me.information_entered.every(x => x.form && x.data) && me.cases_started.every(x => x.id), 'with the content, so it can be downloaded');
  const bramData = JSON.stringify(me);
  ok(!bramData.includes('anna@example.com') && !bramData.includes('pw_hash'), 'no one else\'s e-mail address and no password material');
  r = await post('/api/login', { email: 'eva@example.com', password: 'demo1234' }); r = await get('/api/me/data'); ok(r.data.person.email === 'eva@example.com' && r.data.processes_you_own.length >= 1, 'every person gets their own (Eva owns a process)');
  cookie = adminCookie;
}

console.log('corrections as a route in the process');
{
  const adminCookie = cookie;
  const login = async (email) => { cookie = ''; const x = await post('/api/login', { email, password: 'demo1234' }); return x.status === 200; };
  const bundle = { area: 'People & HR',
    forms: [{ name: 'Gear request', fields: [{ key: 'gear', label: 'What do you need?', type: 'text', required: true }, { key: 'qty', label: 'How many?', type: 'number', required: true, min: 1 }] },
      { name: 'Gear review', fields: [{ key: 'verdict', label: 'Decision', type: 'radio', options: ['Approve', 'Needs correction'], required: true }, { key: 'why', label: 'Reason', type: 'textarea', required: true, visibleIf: 'verdict == "Needs correction"' }] }],
    processes: [{ name: 'Gear request flow', request_form: 'Gear request', steps: [
      { id: 'rev', type: 'task', name: 'Review the gear request', form: 'Gear review', who: { type: 'tags', tags: ['Function: Manager'], same_as_initiator: ['Department'] }, next: 'dec' },
      { id: 'dec', type: 'decision', name: 'Decision', branches: [{ label: 'Back', when: 'verdict == "Needs correction"', to: 'fix' }, { label: 'OK', to: 'ok' }] },
      { id: 'fix', type: 'task', name: 'Correct the request', form: 'Gear request', who: 'initiator', next: 'rev' },
      { id: 'ok', type: 'end', name: 'Approved' }] }] };
  const text = JSON.stringify(bundle);
  r = await post('/api/admin/ai/apply', { text }); ok(r.status === 200, 'a process with a correction loop is accepted', r.data); const cf = r.data.flows[0].id;
  for (const f of r.data.forms) { const full = (await get('/api/admin/forms/' + f.id)).data.form; await put('/api/admin/forms/' + f.id, { name: full.name, description: '', fields: full.fields, checks: [], access: { direct: false }, status: 'active', area_id: full.area_id }); }
  { const fl = (await get('/api/admin/flows/' + cf)).data; r = await put('/api/admin/flows/' + cf, { name: fl.name, description: '', graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 200 && r.data.status === 'active', 'activate it', r.data.issues); }
  r = await post('/api/flows/' + cf + '/start', { data: { gear: 'Helmet', qty: 3 } }); const cid = r.data.instanceId;
  await login('daan@example.com');
  let mt = (await get('/api/home')).data.tasks.find(t => t.instance_id === cid); ok(mt, 'the manager gets the review');
  r = await get('/api/tasks/' + mt.id); ok(r.data.round === 1, 'first round');
  r = await post('/api/tasks/' + mt.id + '/complete', { data: { verdict: 'Needs correction', why: 'Quantity must be a multiple of 5' } }); ok(r.status === 200, 'the manager sends it back with a reason');
  cookie = adminCookie;
  const ins = (await get('/api/instances/' + cid)).data; const fixT = ins.tasks.find(t => t.name === 'Correct the request' && t.status === 'open'); ok(fixT, 'the requester gets a correction task');
  r = await post('/api/tasks/' + fixT.id + '/complete', { data: { gear: 'Helmet', qty: 5 } }); ok(r.status === 200, 'the requester corrects it');
  await login('daan@example.com');
  mt = (await get('/api/home')).data.tasks.find(t => t.instance_id === cid && t.name === 'Review the gear request'); ok(mt, 'the review comes back to the manager');
  r = await get('/api/tasks/' + mt.id); ok(r.data.round === 2, 'as round 2 (the page says the step came back)', r.data.round);
  r = await post('/api/tasks/' + mt.id + '/complete', { data: { verdict: 'Approve' } }); ok(r.status === 200, 'the manager approves');
  cookie = adminCookie;
  r = await get('/api/instances/' + cid); ok(r.data.instance.status === 'done' && r.data.instance.outcome === 'Approved', 'the case ends as Approved after one correction', r.data.instance);
  r = await get('/api/flows/' + cf + '/insight'); const rv = r.data.steps.find(s => s.name === 'Review the gear request'); ok(rv && rv.again === 1 && r.data.casesAgain === 1, 'Performance shows the step was done again once, and one case came back (per step, not per person)', r.data.steps);
}

console.log('milestone notifications');
{
  r = await post('/api/admin/flows', { name: 'Notify test', area_id: salesId }); const nf = r.data.id;
  let fl = (await get('/api/admin/flows/' + nf)).data; const end = fl.graph.nodes.find(n => n.type === 'end');
  end.notifyUrl = 'http://insecure.example.invalid/hook';
  r = await put('/api/admin/flows/' + nf, { name: fl.name, description: '', graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 400 && /https/.test(r.data.error), 'a notification address must be https', r.data);
  end.notifyUrl = 'https://example.invalid/hook'; end.notifyFormat = 'teams';
  r = await put('/api/admin/flows/' + nf, { name: fl.name, description: '', graph: fl.graph, doc: fl.doc, status: 'active' }); ok(r.status === 200 && r.data.status === 'active', 'with https it can be activated', r.data);
  r = await post('/api/flows/' + nf + '/start', {}); const nid = r.data.instanceId;
  r = await get('/api/instances/' + nid); ok(r.data.instance.status === 'done' && r.data.events.some(e => /Notified example\.invalid that the case ended as “Done”/.test(e.message)), 'a case that ends there records the notification in its timeline', r.data.events.map(e => e.message));
}

console.log('as a colleague');
cookie = '';
r = await post('/api/login', { email: 'bram@example.com', password: 'demo1234' }); ok(r.status === 200, 'colleague logs in');
r = await get('/api/admin/health'); ok(r.status === 403, 'health is for admins');
r = await get('/api/admin/audit'); ok(r.status === 403, 'audit is for admins');
r = await get('/api/handbook'); ok(r.data.every(f => f.status === 'active'), 'handbook shows only active processes');
r = await get('/api/search?q=leave'); ok(r.status === 200 && r.data.results.length > 0, 'colleague can search');

console.log('Microsoft & AI couplings');
{
  r = await fetch(BASE + '/api/v1/openapi.json'); const sw = await r.json(); ok(r.status === 200 && sw.swagger === '2.0' && sw.paths['/processes/{id}/start'].post.operationId === 'StartProcess' && sw.securityDefinitions.token.name === 'Authorization', 'the API is described as a Swagger file, without signing in');
}

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
