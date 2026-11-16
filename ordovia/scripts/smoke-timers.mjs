// Wait steps through the real API. Local server with --var DATA_REGION:local :  BASE=http://127.0.0.1:8787 node scripts/smoke-timers.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } else console.log('  ✓', msg); };
const jar = new Map();
const call = async (method, path, body) => {
  const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v) jar.delete(k); else jar.set(k, v); }
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};
const get = (p) => call('GET', p), post = (p, b) => call('POST', p, b), put = (p, b) => call('PUT', p, b);
const run = Date.now().toString(36);
let r;

r = await post('/api/setup', { company: 'Wachten BV', name: 'Wim', email: `wim.${run}@wait.test`, password: 'password123', lang: 'en' }); ok(r.status === 200, 'a company signs up');
r = await post('/api/admin/areas', { name: 'Sales' }); const area = r.data.id;
r = await post('/api/admin/forms', { name: 'Order', area_id: area }); const fid = r.data.id;
r = await get('/api/admin/forms/' + fid); const form = r.data.form; form.fields = [{ key: 'item', label: 'Item', type: 'text', required: true }];
r = await put('/api/admin/forms/' + fid, { ...form });
const me = (await get('/api/meta')).data.people[0];
const graph = {
  nodes: [{ id: 's', type: 'start', name: 'Start', formId: fid, title: '"Order " & item' }, { id: 'w', type: 'wait', name: 'Cooling off', waitAmount: 3, waitUnit: 'days' },
    { id: 't', type: 'task', name: 'Ship it', formId: fid, assignee: { type: 'person', personId: me.id } }, { id: 'e', type: 'end', name: 'Shipped' }],
  edges: [{ id: 'e1', from: 's', to: 'w' }, { id: 'e2', from: 'w', to: 't' }, { id: 'e3', from: 't', to: 'e' }],
};
r = await post('/api/admin/flows', { name: 'Order', area_id: area }); const flow = r.data.id;
r = await put('/api/admin/flows/' + flow, { name: 'Order', description: '', graph, doc: {}, status: 'active' }); ok(r.status === 200, 'a process with a wait step is accepted', r.data);
r = await put('/api/admin/flows/' + flow, { name: 'Order', description: '', graph: { ...graph, nodes: graph.nodes.map(x => (x.id === 'w' ? { ...x, waitAmount: 0 } : x)) }, doc: {}, status: 'active' }); ok(r.status === 200 && r.data.status === 'draft' && /waiting time/.test(JSON.stringify(r.data.issues)), 'a wait step without a time keeps the process a draft', r.data.issues);
r = await put('/api/admin/flows/' + flow, { name: 'Order', description: '', graph, doc: {}, status: 'active' }); ok(r.status === 200 && r.data.status === 'active', 'with a time it can go live again');

console.log('a case waits, then continues');
r = await post('/api/flows/' + flow + '/start', { data: { item: 'Chairs' } }); ok(r.status === 200, 'the process is started', r.data);
const iid = r.data.instanceId;
r = await get('/api/instances/' + iid); ok(r.data.instance.status === 'running' && r.data.timers.length === 1 && !r.data.timers[0].fired_at && r.data.tasks.length === 0, 'the case is waiting: no task yet, one timer', { tasks: r.data.tasks.length, timers: r.data.timers });
const wake = Date.parse(r.data.timers[0].wake_at.replace(' ', 'T') + 'Z'); ok(Math.abs(wake - (Date.now() + 3 * 86400000)) < 600000, 'it wakes in three days', r.data.timers[0].wake_at);
ok(r.data.events.some(e => /Waiting 3 days at “Cooling off”/.test(e.message)), 'the timeline says so');
r = await post('/api/admin/timers/run', {}); ok(r.data.continued === 0, 'checking now changes nothing: the time is not over');
r = await post('/api/admin/sql', { sql: "UPDATE timers SET wake_at = '2000-01-01 00:00:00'" }); ok(r.status === 200, '(three days go by)');
r = await post('/api/admin/timers/run', {}); ok(r.data.continued === 1, 'now the case continues');
r = await post('/api/admin/timers/run', {}); ok(r.data.continued === 0, 'and only once');
r = await get('/api/instances/' + iid); ok(r.data.tasks.length === 1 && r.data.tasks[0].name === 'Ship it' && r.data.timers[0].fired_at, 'the next step is waiting for a person now', r.data.tasks);
ok(r.data.events.some(e => /Waiting time over at “Cooling off”/.test(e.message)), 'the timeline says the waiting time is over');
r = await post('/api/tasks/' + r.data.tasks[0].id + '/complete', { data: { item: 'Chairs' } }); ok(r.status === 200, 'the task is completed');
r = await get('/api/instances/' + iid); ok(r.data.instance.status === 'done' && r.data.instance.outcome === 'Shipped', 'the case ends', r.data.instance);

console.log('a case that ended while waiting does not wake up');
r = await post('/api/flows/' + flow + '/start', { data: { item: 'Tables' } }); const iid2 = r.data.instanceId;
r = await post('/api/admin/sql', { sql: "UPDATE instances SET status = 'done' WHERE id = " + iid2 }); r = await post('/api/admin/sql', { sql: "UPDATE timers SET wake_at = '2000-01-01 00:00:00' WHERE fired_at IS NULL" });
r = await post('/api/admin/timers/run', {}); ok(r.data.continued === 0, 'nothing happens');
r = await get('/api/instances/' + iid2); ok(r.data.tasks.length === 0, 'no task was made');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
