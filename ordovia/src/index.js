// Ordovia API – Cloudflare Worker on D1.
// Every rule that matters (who may see/do what, form calculations and checks, the process engine)
// runs here on the server. The browser only renders.
import {
  FB, HttpError, now, parse, slugify, qi, all, first, run, Tx,
  hashPassword, verifyPassword, sha256, randomToken, COOKIE, EXAMPLE_COOKIE, MODE_COOKIE, sessionCookie, readCookie,
  loadDirectory, loadForms, recordLabel, formViewSQL,
  canViewForm, canAddForm, tagRule, assertSelect, tabular,
  STATUSES, cleanStatus, reviewDueAt, likePattern,
} from './lib.js';
import { advance, startNode, mergeFormData } from './engine.js';
import { seedDemo, resetDemo, DEMO_ADMIN, DEMO_PASSWORD } from './seed.js';

const SESSION_DAYS = 14;
const routes = [];
const route = (method, path, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
};

// ---------------------------------------------------------------- request context
class Ctx {
  constructor(req, env, exec) {
    this.req = req; this.env = env; this.exec = exec;
    // The example lives in its own database (DB_DEMO) beside the real one, under the same address. A browser is in the example when it chose so.
    const path = new URL(req.url).pathname;
    this.demo = !!env.DB_DEMO && (path.startsWith('/api/demo/') || readCookie(req, MODE_COOKIE) === 'example');
    this.db = this.demo ? env.DB_DEMO : env.DB; this.files = this.demo ? env.FILES_DEMO : env.FILES;
    this.cookieName = this.demo ? EXAMPLE_COOKIE : COOKIE;
    this.url = new URL(req.url); this.user = null; this.cookies = [];
    this._dir = null; this._forms = null; this._settings = null; this._body = undefined; this.noteInfo = null;
  }
  async dir() { return this._dir || (this._dir = await loadDirectory(this.db)); }
  async forms() { return this._forms || (this._forms = await loadForms(this.db)); }
  async formsMap() { return new Map((await this.forms()).map(f => [f.id, f])); }
  async form(id) { const f = (await this.forms()).find(x => x.id === Number(id)); if (!f) throw new HttpError(404, 'Form not found'); return f; }
  async settings() {
    if (!this._settings) this._settings = Object.fromEntries((await all(this.db, 'SELECT key, value FROM settings')).map(r => [r.key, r.value]));
    return this._settings;
  }
  async body() { if (this._body === undefined) { try { this._body = await this.req.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); } } return this._body; }
  /** What the audit log should say about this change (name of the thing, and a short detail). */
  note(name, detail) { this.noteInfo = { name, detail }; }
  requireAdmin() { if (!this.user || !this.user.is_admin) throw new HttpError(403, 'Administrators only'); }
}

const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
});

/** Uploads that never became part of a record or a document (the form was abandoned) are removed after a day. */
async function cleanLooseFiles(db, bucket) {
  try {
    const old = await all(db, 'SELECT id, key FROM files WHERE attached_at IS NULL AND created_at < ? LIMIT 100', new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' '));
    for (const f of old) { if (bucket) await bucket.delete(f.key); await run(db, 'DELETE FROM files WHERE id = ?', f.id); }
  } catch (e) { console.warn('file cleanup failed', e.message); }
}

export default {
  async fetch(req, env, exec) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const c = new Ctx(req, env, exec);
    try {
      // CSRF protection: state-changing calls must carry our custom header (forces a CORS preflight cross-site).
      const bearer = /^bearer\s+ord_/i.test(req.headers.get('authorization') || '');
      if (req.method !== 'GET' && !bearer && req.headers.get('x-ordovia') !== '1') throw new HttpError(403, 'Missing request header');
      await authenticate(c);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        if (!r.opts.public && !c.user) throw new HttpError(401, 'Please sign in');
        if (r.opts.admin) c.requireAdmin();
        const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        const out = await r.handler(c, params);
        if (r.opts.admin && req.method !== 'GET') await writeAudit(c, r, params, out);
        const res = out instanceof Response ? out : reply(out ?? { ok: true });
        c.cookies.forEach(ck => res.headers.append('set-cookie', ck));
        return res;
      }
      throw new HttpError(404, 'Unknown endpoint');
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(e);
      const msg = /no such table/i.test(String(e.message)) ? 'Database not initialised – run the D1 migrations (npm run db:migrate:remote).' : 'Server error: ' + e.message;
      return reply({ error: msg }, 500);
    }
  },

  // Hourly: flag overdue tasks and send reminders to the notification webhook.
  async scheduled(event, env, exec) {
    const db = env.DB;
    if (env.DB_DEMO && new Date(event.scheduledTime).getUTCHours() === 3) exec.waitUntil(resetDemo(env.DB_DEMO, env.FILES_DEMO));   // (the example starts fresh every night)
    await cleanLooseFiles(db, env.FILES);
    const due = await all(db, `SELECT t.id, t.name, t.instance_id, i.title FROM tasks t JOIN instances i ON i.id = t.instance_id
      WHERE t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < ? AND t.reminded_at IS NULL LIMIT 40`, now());
    if (!due.length) return;
    const tx = new Tx(db);
    for (const t of due) {
      tx.add('UPDATE tasks SET reminded_at = ? WHERE id = ?', now(), t.id);
      tx.add('INSERT INTO events(instance_id, message, created_at) VALUES (?,?,?)', t.instance_id, `Task “${t.name}” is overdue`, now());
    }
    await tx.commit();
    const hook = await first(db, "SELECT value FROM settings WHERE key = 'notify_webhook'"), fmt = await first(db, "SELECT value FROM settings WHERE key = 'notify_format'");
    if (hook && hook.value) exec.waitUntil(Promise.all(due.map(t => postJSON(hook.value, notifyBody(fmt && fmt.value, { event: 'task.overdue', text: `Overdue: ${t.name} – ${t.title}`, task: t })))));
  },
};

/** The notification webhook speaks plain JSON, or the message card that a Microsoft Teams workflow ("When a Teams webhook request is received") posts to a channel. */
function notifyBody(format, p) {
  if (format !== 'teams') return p;
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
    body: [{ type: 'TextBlock', text: String(p.text || p.event || 'Ordovia'), wrap: true, weight: 'Bolder' }],
    ...(p.link ? { actions: [{ type: 'Action.OpenUrl', title: 'Open Ordovia', url: p.link }] } : {}) } }] };
}

async function postJSON(url, payload) {
  try { await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
  catch (e) { console.warn('webhook failed', url, e.message); }
}

// ---------------------------------------------------------------- auth
async function authenticate(c) {
  const auth = c.req.headers.get('authorization') || '';
  if (/^bearer\s+ord_/i.test(auth)) {
    const raw = auth.replace(/^bearer\s+/i, '').trim();
    const t = await first(c.db, 'SELECT t.id, t.person_id FROM api_tokens t JOIN persons p ON p.id = t.person_id WHERE t.token_hash = ? AND t.revoked_at IS NULL AND p.active = 1', await sha256(raw));
    if (!t) throw new HttpError(401, 'Invalid or revoked API token');
    c.user = await first(c.db, 'SELECT id, name, email, is_admin FROM persons WHERE id = ?', t.person_id);
    c.viaToken = t.id;
    c.exec.waitUntil(run(c.db, 'UPDATE api_tokens SET last_used_at = ? WHERE id = ?', now(), t.id));
    return;
  }
  const token = readCookie(c.req, c.cookieName);
  if (!token) return;
  const s = await first(c.db, `SELECT p.id, p.name, p.email, p.is_admin FROM sessions s JOIN persons p ON p.id = s.person_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND p.active = 1`, await sha256(token), now());
  if (s) c.user = s;
}
async function startSession(c, personId) {
  const token = randomToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  await c.db.batch([
    c.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    c.db.prepare('INSERT INTO sessions(token_hash, person_id, expires_at) VALUES (?,?,?)').bind(await sha256(token), personId, exp),
  ]);
  c.cookies.push(sessionCookie(token, SESSION_DAYS * 86400, c.cookieName));
}

route('GET', '/api/session', async (c) => {
  const any = await first(c.db, 'SELECT id FROM persons LIMIT 1');
  const s = await c.settings();
  return { setup: !any, user: c.user, settings: { company: s.company || 'Ordovia', color: s.color || '', demo: s.demo === '1', demoSite: c.demo, canTryExample: !c.demo && !!c.env.DB_DEMO } };
}, { public: true });

route('POST', '/api/setup', async (c) => {
  if (await first(c.db, 'SELECT id FROM persons LIMIT 1')) throw new HttpError(409, 'Already set up');
  const b = await c.body();
  const email = String(b.email || '').trim(), name = String(b.name || '').trim();
  if (!name || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Name and a valid e-mail are required');
  if (String(b.password || '').length < 8) throw new HttpError(400, 'Use a password of at least 8 characters');
  const hash = await hashPassword(String(b.password));
  await c.db.batch([
    c.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('company', ?)").bind(String(b.company || 'My company').slice(0, 80)),
  ]);
  let adminId;
  if (b.demo) adminId = await seedDemo(c.db, { name, email, hash }, c.files);
  else adminId = await run(c.db, 'INSERT INTO persons(name, email, pw_hash, is_admin, active, created_at) VALUES (?,?,?,1,1,?)', name, email, hash, now());
  await startSession(c, adminId);
  return { ok: true };
}, { public: true });

route('POST', '/api/login', async (c) => {
  const b = await c.body();
  const p = await first(c.db, 'SELECT id, pw_hash FROM persons WHERE email = ? AND active = 1', String(b.email || '').trim());
  // Always run the hash so timing does not reveal whether the e-mail exists.
  const ok = await verifyPassword(String(b.password || ''), p ? p.pw_hash : 'pbkdf2$1$AAAAAAAAAAAAAAAAAAAAAA==$x');
  if (!p || !ok) throw new HttpError(401, 'Wrong e-mail or password');
  await startSession(c, p.id);
  return { ok: true };
}, { public: true });

route('POST', '/api/logout', async (c) => {
  const token = readCookie(c.req, c.cookieName);
  if (token) await run(c.db, 'DELETE FROM sessions WHERE token_hash = ?', await sha256(token));
  c.cookies.push(sessionCookie('', 0, c.cookieName));
  return { ok: true };
}, { public: true });

// ---------------------------------------------------------------- shared lookups
route('GET', '/api/meta', async (c) => {
  const D = await c.dir(), forms = await c.forms();
  return {
    user: c.user,
    tags: [...D.tags.values()],
    categories: D.categories(),
    people: [...D.persons.values()].filter(p => p.active).map(p => ({ id: p.id, name: p.name, tagIds: [...D.tagIdsOf(p.id)] })),
    areas: await all(c.db, 'SELECT id, name, description, color, owner_id FROM areas ORDER BY name'),
    documents: await all(c.db, "SELECT id, name, kind, area_id, status FROM documents WHERE status != 'archived' ORDER BY name"),
    forms: forms.filter(f => f.status !== 'archived' || c.user.is_admin).map(f => ({ id: f.id, name: f.name, slug: f.slug, description: f.description, fields: f.fields, checks: f.checks, area_id: f.area_id, status: f.status, canView: canViewForm(c.user, D, f), canAdd: f.status === 'archived' ? false : canAddForm(c.user, D, f) })),
    openTasks: (await openTasksFor(c, c.user.id)).length,
  };
});

async function openTasksFor(c, pid) {
  const D = await c.dir();
  const rows = await all(c.db, `SELECT t.id, t.name, t.assignee, t.created_at, t.due_at, t.instance_id, i.title AS process, i.vars, i.started_by, f.name AS flow
    FROM tasks t JOIN instances i ON i.id = t.instance_id JOIN flows f ON f.id = i.flow_id WHERE t.status = 'open' ORDER BY t.created_at`);
  return rows.filter(t => D.matches(pid, parse(t.assignee, {}), t)).map(t => ({
    id: t.id, name: t.name, process: t.process, flow: t.flow, instance_id: t.instance_id, created_at: t.created_at, due_at: t.due_at,
    overdue: !!(t.due_at && t.due_at < now()), assignee: D.describe(parse(t.assignee, {})),
  }));
}

/** May this user look at this process? */
async function canSeeInstance(c, inst) {
  if (c.user.is_admin || inst.started_by === c.user.id) return true;
  const D = await c.dir();
  const tasks = await all(c.db, 'SELECT assignee, status, completed_by FROM tasks WHERE instance_id = ?', inst.id);
  return tasks.some(t => t.completed_by === c.user.id || (t.status === 'open' && D.matches(c.user.id, parse(t.assignee, {}), inst)));
}

// ---------------------------------------------------------------- home & processes
route('GET', '/api/home', async (c) => {
  const D = await c.dir();
  const flows = (await all(c.db, "SELECT id, name, description, graph, area_id, status FROM flows WHERE status = 'active' OR (status = 'draft' AND ? = 1) ORDER BY name", c.user.is_admin ? 1 : 0)).filter(f => {
    const s = startNode(parse(f.graph, { nodes: [] }));
    return s && tagRule(c.user, D, s.startTags);
  }).map(f => ({ id: f.id, name: f.name, description: f.description, area_id: f.area_id, status: f.status, form_id: (startNode(parse(f.graph, { nodes: [] })) || {}).formId || null }));
  const mine = await all(c.db, 'SELECT * FROM v_instances WHERE id IN (SELECT id FROM instances WHERE started_by = ?) ORDER BY created_at DESC LIMIT 8', c.user.id);
  return { tasks: await openTasksFor(c, c.user.id), flows, mine };
});

route('POST', '/api/flows/:id/start', async (c, { id }) => {
  const flow = await first(c.db, 'SELECT * FROM flows WHERE id = ?', Number(id));
  if (!flow) throw new HttpError(404, 'Flow not found');
  let b = {}; try { b = (await c.body()) || {}; } catch { /* an empty body is fine */ }
  return startRun(c, flow, { data: b.data, source: c.viaToken ? 'api' : 'app', ref: b.reference, callback: b.callbackUrl });
});

/**
 * Start a run of a process. The one place where runs begin: the app, the API and public web forms all come through here.
 * Checks status, readiness and who may start; validates the request form (the process's input) on the server.
 * opts: { data, source: 'app'|'api'|'web', ref, callback, requester: {name, email} (web: nobody is signed in) }
 */
async function startRun(c, flow, opts) {
  const graph = parse(flow.graph, { nodes: [], edges: [] });
  const forms = await c.forms();
  if (flow.status === 'archived' || (flow.status === 'draft' && !(c.user && c.user.is_admin))) throw new HttpError(409, 'This process is not in use (status: ' + flow.status + ')');
  const errs = FB.logic.lintFlow(graph, forms.filter(f => f.status !== 'archived').map(f => f.id), forms);
  if (errs.length) throw new HttpError(400, 'This process is not ready: ' + errs[0]);
  const D = await c.dir(), s = startNode(graph);
  if (opts.source !== 'web' && !D.hasTags(c.user.id, s.startTags) && !c.user.is_admin) throw new HttpError(403, 'You may not start this process');
  if (opts.callback && !/^https:\/\//.test(opts.callback)) throw new HttpError(400, 'callbackUrl must start with https://');
  const ref = opts.ref == null || opts.ref === '' ? null : String(opts.ref).slice(0, 120);
  const initiator = opts.source === 'web' ? { name: (opts.requester && opts.requester.name) || 'Web form', email: (opts.requester && opts.requester.email) || '' } : D.profile(c.user.id);
  const vars = { initiator, process: flow.name };
  let formRes = null, startForm = null;
  if (s.formId) {
    startForm = forms.find(f => f.id === Number(s.formId));
    formRes = await finalizeForm(c, startForm, opts.data || {}, { initiator });
    if (!formRes.ok) throw new HttpError(422, 'Please check the form', { errors: formRes.errors, formErrors: formRes.formErrors });
  }
  const starter = opts.source === 'web' ? null : c.user.id;
  const iid = await run(c.db, 'INSERT INTO instances(flow_id, flow_version, graph, title, status, vars, started_by, created_at, source, external_ref, callback_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    flow.id, flow.version, flow.graph, flow.name, 'running', JSON.stringify(vars), starter, now(), opts.source || 'app', ref, opts.callback || null);
  const proc = { id: iid, flowName: flow.name, graph, vars, title: `${flow.name} #${iid}`, status: 'running', started_by: starter, finished_at: null, ref, callback: opts.callback || null };
  const tx = new Tx(c.db);
  const io = await runtimeIO(c, tx, proc);
  io.log(opts.source === 'web' ? `Request received from the web form (${initiator.name}${initiator.email ? ', ' + initiator.email : ''})` : opts.source === 'api' ? `Started through the API by ${c.user.name}${ref ? ' (reference ' + ref + ')' : ''}` : `Started by ${c.user.name}`, starter);
  if (startForm) {
    tx.add('INSERT INTO submissions(form_id, person_id, instance_id, data, created_at) VALUES (?,?,?,?,?)', startForm.id, starter, iid, JSON.stringify(formRes.data), now());
    for (const st of attachStatements(c, startForm, formRes.data, iid)) tx.stmts.push(st);
    mergeFormData(proc, startForm, formRes.data, formRes.linked);
  }
  advance(proc, s.id, io);
  await finishProc(c, tx, proc);
  const next = c.user ? (await openTasksFor(c, c.user.id)).find(t => t.instance_id === iid) : null;
  return { instanceId: iid, taskId: next ? next.id : null, reference: ref };
}

async function runtimeIO(c, tx, proc) {
  const D = await c.dir();
  const forms = await c.formsMap();
  const st = await c.settings(), hook = st.notify_webhook, hookFormat = st.notify_format;
  const origin = c.url.origin;
  return {
    now, forms, describe: (r) => D.describe(r),
    log: (message, personId) => tx.add('INSERT INTO events(instance_id, person_id, message, created_at) VALUES (?,?,?,?)', proc.id, personId ?? null, message, now()),
    createTask: (t) => {
      tx.add('INSERT INTO tasks(instance_id, node_id, name, form_id, assignee, status, due_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
        proc.id, t.nodeId, t.name, t.formId, JSON.stringify(t.assignee), 'open', t.dueAt, now());
      if (hook) tx.after.push({ url: hook, payload: notifyBody(hookFormat, { event: 'task.created', text: `New task: ${t.name} – ${proc.title} (for ${D.describe(t.assignee)})`, link: origin + '/#/', task: t.name, process: proc.title }) });
    },
    createRecord: (form, data) => tx.add('INSERT INTO submissions(form_id, person_id, instance_id, data, created_at) VALUES (?,?,?,?,?)', form.id, null, proc.id, JSON.stringify(data), now()),
    updateRecord: (form, rid, patch) => tx.add('UPDATE submissions SET data = json_patch(data, ?), updated_at = ? WHERE id = ? AND form_id = ?', JSON.stringify(patch), now(), rid, form.id),
    webhook: (url, payload) => { if (/^https:\/\//.test(url || '')) tx.after.push({ url, payload }); },
  };
}

async function finishProc(c, tx, proc) {
  tx.add('UPDATE instances SET vars = ?, status = ?, title = ?, finished_at = ? WHERE id = ?', JSON.stringify(proc.vars), proc.status, proc.title, proc.finished_at, proc.id);
  await tx.commit();
  if (proc.callback && (proc.status === 'done' || proc.status === 'stuck')) tx.after.push({ url: proc.callback, payload: { event: 'run.' + (proc.status === 'done' ? 'finished' : 'stuck'), run: runInfo(proc, c.url.origin), outputs: publicVars(proc.vars) } });
  if (tx.after.length && !c.demo) c.exec.waitUntil(Promise.all(tx.after.map(h => postJSON(h.url, h.payload))));
}
const publicVars = (vars) => { const o = { ...vars }; delete o.initiator; delete o.process; return o; };
const runInfo = (proc, origin) => ({ id: proc.id, process: proc.flowName, status: proc.status, outcome: (proc.vars || {}).outcome ?? null, reference: proc.ref ?? null, url: origin + '/#/processes/' + proc.id });

/** Validate a form submission on the server: types, lookups, calculations, rules. */
async function finalizeForm(c, form, input, context, ownFiles) {
  const D = await c.dir();
  const ids = form.fields.filter(f => f.type === 'record' && input && input[f.key] != null && input[f.key] !== '').map(f => Number(input[f.key])).filter(Number.isInteger);
  const recs = ids.length ? await all(c.db, `SELECT id, form_id, data FROM submissions WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const fileIds = form.fields.filter(f => f.type === 'file' && input && input[f.key] != null && input[f.key] !== '').map(f => Number(input[f.key])).filter(Number.isInteger);
  const fileRows = fileIds.length ? await all(c.db, `SELECT id, name, uploaded_by, attached_at, form_id FROM files WHERE id IN (${fileIds.map(() => '?').join(',')})`, ...fileIds) : [];
  const forms = await c.formsMap();
  const lookup = (f, id) => {
    if (f.type === 'file') {
      // a file may be attached once: by the person who uploaded it (still loose), or it is already part of this form's records (editing)
      const r = fileRows.find(x => x.id === id);
      return r && ((!r.attached_at && c.user && r.uploaded_by === c.user.id) || (ownFiles && ownFiles.has(id))) ? { label: r.name, data: {} } : null;
    }
    if (f.type === 'person') {
      const p = D.persons.get(id);
      return p && p.active && D.hasTags(id, f.personTags) ? { label: p.name, data: D.profile(id) } : null;
    }
    const r = recs.find(x => x.id === id && x.form_id === Number(f.recordForm));
    if (!r) return null;
    const data = parse(r.data, {});
    return { label: recordLabel(forms.get(r.form_id), r.id, data, f.recordLabel), data };
  };
  return FB.logic.finalize(form, input || {}, context || {}, lookup);
}
/** The statements that make the files of a saved record permanent (they belong to that form, and to the run if there is one). */
function attachStatements(c, form, data, instanceId) {
  return form.fields.filter(f => f.type === 'file' && Number.isInteger(data[f.key])).map(f =>
    c.db.prepare('UPDATE files SET attached_at = COALESCE(attached_at, ?), form_id = ?, instance_id = COALESCE(?, instance_id) WHERE id = ?').bind(now(), form.id, instanceId ?? null, data[f.key]));
}

route('GET', '/api/tasks/:id', async (c, { id }) => {
  const t = await first(c.db, `SELECT t.*, i.vars, i.title AS process, i.started_by, i.graph, i.id AS iid, i.status AS istatus
    FROM tasks t JOIN instances i ON i.id = t.instance_id WHERE t.id = ?`, Number(id));
  if (!t) throw new HttpError(404, 'Task not found');
  const inst = { id: t.iid, started_by: t.started_by, vars: t.vars };
  if (!(await canSeeInstance(c, inst))) throw new HttpError(403, 'Not your task');
  const D = await c.dir();
  const node = parse(t.graph, { nodes: [] }).nodes.find(n => n.id === t.node_id) || {};
  const previous = await all(c.db, `SELECT s.id, s.form_id, s.data, s.created_at, tk.name AS task_name, p.name AS who
    FROM submissions s LEFT JOIN tasks tk ON tk.id = s.task_id LEFT JOIN persons p ON p.id = s.person_id WHERE s.instance_id = ? ORDER BY s.id`, t.iid);
  const own = t.submission_id ? previous.find(s => s.id === t.submission_id) : null;
  return {
    task: { id: t.id, name: t.name, status: t.status, form_id: t.form_id, created_at: t.created_at, due_at: t.due_at, completed_at: t.completed_at, instance_id: t.iid, process: t.process },
    instructions: node.instructions || '',
    documents: await docsByIds(c, node.docIds, node.docSections || {}),
    assignee: D.describe(parse(t.assignee, {})),
    canComplete: t.status === 'open' && D.matches(c.user.id, parse(t.assignee, {}), inst),
    vars: parse(t.vars, {}),
    previous: previous.filter(s => s !== own).map(s => ({ ...s, data: parse(s.data, {}) })),
    submission: own ? { ...own, data: parse(own.data, {}) } : null,
  };
});

route('POST', '/api/tasks/:id/complete', async (c, { id }) => {
  const b = await c.body();
  const t = await first(c.db, 'SELECT t.*, i.vars, i.title, i.started_by, i.graph, i.status AS istatus, i.external_ref, i.callback_url, f.name AS flow_name FROM tasks t JOIN instances i ON i.id = t.instance_id JOIN flows f ON f.id = i.flow_id WHERE t.id = ?', Number(id));
  if (!t) throw new HttpError(404, 'Task not found');
  if (t.status !== 'open') throw new HttpError(409, 'This task is no longer open');
  const D = await c.dir();
  const inst = { id: t.instance_id, started_by: t.started_by, vars: t.vars };
  if (!D.matches(c.user.id, parse(t.assignee, {}), inst)) throw new HttpError(403, 'This task is assigned to someone else');
  const proc = { id: t.instance_id, flowName: t.flow_name, graph: parse(t.graph, { nodes: [], edges: [] }), vars: parse(t.vars, {}), title: t.title, status: t.istatus, started_by: t.started_by, finished_at: null, ref: t.external_ref, callback: t.callback_url };
  const tx = new Tx(c.db);
  // Guard against double completion inside the same atomic batch.
  tx.add("UPDATE tasks SET status = 'done', completed_by = ?, completed_at = ? WHERE id = ? AND status = 'open'", c.user.id, now(), t.id);
  if (t.form_id) {
    const form = await c.form(t.form_id);
    const res = await finalizeForm(c, form, b.data, proc.vars);
    if (!res.ok) throw new HttpError(422, 'Please check the form', { errors: res.errors, formErrors: res.formErrors });
    tx.add('INSERT INTO submissions(form_id, person_id, instance_id, task_id, data, created_at) VALUES (?,?,?,?,?,?)', form.id, c.user.id, t.instance_id, t.id, JSON.stringify(res.data), now());
    tx.add('UPDATE tasks SET submission_id = last_insert_rowid() WHERE id = ?', t.id);
    for (const st of attachStatements(c, form, res.data, t.instance_id)) tx.stmts.push(st);
    mergeFormData(proc, form, res.data, res.linked);
  }
  const io = await runtimeIO(c, tx, proc);
  io.log(`Task “${t.name}” completed by ${c.user.name}`, c.user.id);
  advance(proc, t.node_id, io);
  await finishProc(c, tx, proc);
  const next = (await openTasksFor(c, c.user.id)).find(x => x.instance_id === t.instance_id);
  return { instanceId: t.instance_id, taskId: next ? next.id : null };
});

route('GET', '/api/instances', async (c) => {
  const status = c.url.searchParams.get('status') || '';
  const rows = await all(c.db, `SELECT v.*, i.started_by AS started_by_id FROM v_instances v JOIN instances i ON i.id = v.id ${status ? 'WHERE v.status = ?' : ''} ORDER BY v.created_at DESC LIMIT 500`, ...(status ? [status] : []));
  if (c.user.is_admin) return rows;
  const mineIds = new Set((await all(c.db, 'SELECT DISTINCT instance_id FROM tasks WHERE completed_by = ?', c.user.id)).map(r => r.instance_id));
  (await openTasksFor(c, c.user.id)).forEach(t => mineIds.add(t.instance_id));
  return rows.filter(r => r.started_by_id === c.user.id || mineIds.has(r.id));
});

route('GET', '/api/instances/:id', async (c, { id }) => {
  const raw = await first(c.db, 'SELECT * FROM instances WHERE id = ?', Number(id));
  if (!raw) throw new HttpError(404, 'Process not found');
  if (!(await canSeeInstance(c, raw))) throw new HttpError(403, 'No access to this process');
  const D = await c.dir();
  const [info, tasks, events] = await Promise.all([
    first(c.db, 'SELECT * FROM v_instances WHERE id = ?', raw.id),
    all(c.db, 'SELECT t.id, t.name, t.node_id, t.status, t.assignee, t.due_at, t.completed_at, p.name AS who FROM tasks t LEFT JOIN persons p ON p.id = t.completed_by WHERE instance_id = ? ORDER BY t.id', raw.id),
    all(c.db, 'SELECT message, created_at FROM events WHERE instance_id = ? ORDER BY id', raw.id),
  ]);
  return { instance: info, graph: parse(raw.graph, { nodes: [], edges: [] }), vars: parse(raw.vars, {}), events,
    tasks: tasks.map(t => ({ ...t, assignee: D.describe(parse(t.assignee, {})) })) };
});

route('DELETE', '/api/instances/:id', async (c, { id }) => { await run(c.db, 'DELETE FROM instances WHERE id = ?', Number(id)); }, { admin: true });

// ---------------------------------------------------------------- records (form data)
route('GET', '/api/forms/:id/records', async (c, { id }) => {
  const form = await c.form(id), D = await c.dir();
  const view = qi('form_' + form.slug);
  const all_ = canViewForm(c.user, D, form);
  const res = await tabular(c.db, `SELECT * FROM ${view} ${all_ ? '' : 'WHERE person_id = ' + Number(c.user.id)} ORDER BY id DESC LIMIT 2000`);
  return { form, ...res, canAdd: canAddForm(c.user, D, form), scope: all_ ? 'all' : 'mine' };
});

route('GET', '/api/forms/:id/options', async (c, { id }) => {
  const form = await c.form(id), D = await c.dir(), forms = await c.formsMap();
  const out = {};
  for (const f of form.fields) {
    if (f.type === 'person') out[f.key] = D.personOptions(f.personTags).map(p => ({ ...p, data: D.profile(p.id) }));
    if (f.type === 'record' && forms.has(Number(f.recordForm))) {
      const target = forms.get(Number(f.recordForm));
      const rows = await all(c.db, 'SELECT id, data FROM submissions WHERE form_id = ? ORDER BY id DESC LIMIT 1000', target.id);
      out[f.key] = rows.map(r => { const data = parse(r.data, {}); return { id: r.id, name: recordLabel(target, r.id, data, f.recordLabel), data }; });
    }
  }
  return out;
});

route('POST', '/api/forms/:id/records', async (c, { id }) => {
  const form = await c.form(id), D = await c.dir();
  if (form.status === 'archived') throw new HttpError(409, 'This form is archived');
  if (!canAddForm(c.user, D, form)) throw new HttpError(403, 'You may not add records to this form directly');
  const b = await c.body();
  const res = await finalizeForm(c, form, b.data, { initiator: D.profile(c.user.id) });
  if (!res.ok) throw new HttpError(422, 'Please check the form', { errors: res.errors, formErrors: res.formErrors });
  const rid = await run(c.db, 'INSERT INTO submissions(form_id, person_id, data, created_at) VALUES (?,?,?,?)', form.id, c.user.id, JSON.stringify(res.data), now());
  const att = attachStatements(c, form, res.data, null); if (att.length) await c.db.batch(att);
  return { id: rid };
});

route('GET', '/api/records/:id', async (c, { id }) => {
  const s = await first(c.db, 'SELECT s.*, p.name AS who FROM submissions s LEFT JOIN persons p ON p.id = s.person_id WHERE s.id = ?', Number(id));
  if (!s) throw new HttpError(404, 'Record not found');
  const form = await c.form(s.form_id), D = await c.dir();
  if (!canViewForm(c.user, D, form) && s.person_id !== c.user.id) throw new HttpError(403, 'No access');
  // Which records in other forms link to this one?
  const linking = (await c.forms()).flatMap(f => f.fields.filter(x => x.type === 'record' && Number(x.recordForm) === form.id).map(x => ({ f, key: x.key })));
  const linkedFrom = [];
  for (const l of linking) {
    const rows = await all(c.db, `SELECT id FROM submissions WHERE form_id = ? AND json_extract(data, '$.${l.key}') = ? ORDER BY id DESC LIMIT 50`, l.f.id, s.id);
    rows.forEach(r => linkedFrom.push({ formId: l.f.id, form: l.f.name, id: r.id }));
  }
  return { record: { ...s, data: parse(s.data, {}) }, form, linkedFrom, canEdit: !!c.user.is_admin };
});

route('PUT', '/api/records/:id', async (c, { id }) => {
  const s = await first(c.db, 'SELECT * FROM submissions WHERE id = ?', Number(id));
  if (!s) throw new HttpError(404, 'Record not found');
  const form = await c.form(s.form_id), D = await c.dir();
  const b = await c.body();
  const own = new Set(form.fields.filter(f => f.type === 'file').map(f => parse(s.data, {})[f.key]).filter(Number.isInteger));
  const res = await finalizeForm(c, form, b.data, { initiator: D.profile(s.person_id || c.user.id) }, own);
  if (!res.ok) throw new HttpError(422, 'Please check the form', { errors: res.errors, formErrors: res.formErrors });
  await run(c.db, 'UPDATE submissions SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(res.data), now(), s.id);
  const att = attachStatements(c, form, res.data, s.instance_id); if (att.length) await c.db.batch(att);
}, { admin: true });

route('DELETE', '/api/records/:id', async (c, { id }) => { await run(c.db, 'DELETE FROM submissions WHERE id = ?', Number(id)); }, { admin: true });

// ---------------------------------------------------------------- handbook (process documentation)
route('GET', '/api/handbook', async (c) => {
  const rows = await all(c.db, `SELECT f.id, f.name, f.description, f.doc, f.version, f.updated_at, f.graph, f.area_id, f.status, f.owner_id, f.review_months, f.reviewed_at, p.name AS owner_name
    FROM flows f LEFT JOIN persons p ON p.id = f.owner_id WHERE f.status = 'active' OR (? = 1 AND f.status != 'archived') ORDER BY f.name`, c.user.is_admin ? 1 : 0);
  return rows.map(f => { const g = parse(f.graph, { nodes: [] }), due = reviewDueAt(f); return { id: f.id, name: f.name, description: f.description, doc: parse(f.doc, {}), version: f.version, updated_at: f.updated_at,
    area_id: f.area_id, status: f.status, owner: f.owner_name || '', reviewDue: due, overdue: !!(due && due < now().slice(0, 10)), steps: g.nodes.filter(n => n.type === 'task').length }; });
});
route('GET', '/api/handbook/:id', async (c, { id }) => {
  const f = await first(c.db, 'SELECT f.*, p.name AS owner_name, a.name AS area_name FROM flows f LEFT JOIN persons p ON p.id = f.owner_id LEFT JOIN areas a ON a.id = f.area_id WHERE f.id = ?', Number(id));
  if (!f || (f.status !== 'active' && !c.user.is_admin)) throw new HttpError(404, 'Process not found');
  const D = await c.dir(), forms = await c.formsMap();
  const graph = parse(f.graph, { nodes: [], edges: [] });
  const stats = await first(c.db, "SELECT count(*) AS runs, sum(status = 'running') AS running, round(avg(hours), 1) AS avg_hours FROM v_instances WHERE flow = ?", f.name);
  const steps = graph.nodes.map(n => ({
    id: n.id, type: n.type, name: n.name, instructions: n.instructions || '',
    responsible: n.type === 'task' ? D.describe(n.assignee || { type: 'initiator' }) : '',
    form: n.formId && forms.get(Number(n.formId)) ? forms.get(Number(n.formId)).name : '',
    dueHours: n.dueHours || null, docIds: n.docIds || [], docSections: n.docSections || {},
    next: graph.edges.filter(e => e.from === n.id).map(e => ({ to: (graph.nodes.find(x => x.id === e.to) || {}).name, when: e.label || e.condition || '' })),
  }));
  const due = reviewDueAt(f);
  const docMap = new Map((await docsByIds(c, [...new Set(steps.flatMap(x => x.docIds))])).map(d => [d.id, d]));
  steps.forEach(x => { x.documents = x.docIds.map(i => docMap.get(i) && { ...docMap.get(i), section: String(x.docSections[i] || '') }).filter(Boolean); });
  return { id: f.id, name: f.name, description: f.description, doc: parse(f.doc, {}), version: f.version, updated_at: f.updated_at, graph, steps, stats,
    status: f.status, area_id: f.area_id, area: f.area_name || '', owner_id: f.owner_id, owner: f.owner_name || '', reviewMonths: f.review_months, reviewedAt: f.reviewed_at, reviewDue: due, overdue: !!(due && due < now().slice(0, 10)),
    canReview: !!(c.user.is_admin || (f.owner_id && f.owner_id === c.user.id)) };
});
// "I have read this process and it is still right": restarts the review clock (admin or the process owner)
route('POST', '/api/flows/:id/review', async (c, { id }) => {
  const f = await first(c.db, 'SELECT id, name, owner_id FROM flows WHERE id = ?', Number(id));
  if (!f) throw new HttpError(404, 'Process not found');
  if (!c.user.is_admin && f.owner_id !== c.user.id) throw new HttpError(403, 'Only the owner or an administrator can mark a process as reviewed');
  await run(c.db, 'UPDATE flows SET reviewed_at = ? WHERE id = ?', now(), f.id);
  await logAudit(c, 'reviewed', 'flow', f.id, f.name);
  return { ok: true };
});

// ---------------------------------------------------------------- dashboards
route('GET', '/api/dashboards', async (c) => {
  const D = await c.dir();
  return (await all(c.db, 'SELECT * FROM dashboards ORDER BY name')).map(d => ({ ...d, widgets: parse(d.widgets, []), access: parse(d.access, {}) }))
    .filter(d => tagRule(c.user, D, d.access.viewTags) && (d.status !== 'archived' || c.user.is_admin)).map(d => ({ id: d.id, name: d.name, widgets: d.widgets.length, area_id: d.area_id, status: d.status, owner_id: d.owner_id, updated_at: d.updated_at }));
});
route('GET', '/api/dashboards/:id', async (c, { id }) => {
  const d = await first(c.db, 'SELECT * FROM dashboards WHERE id = ?', Number(id));
  if (!d) throw new HttpError(404, 'Dashboard not found');
  const D = await c.dir();
  const access = parse(d.access, {});
  if (!tagRule(c.user, D, access.viewTags) || (d.status === 'archived' && !c.user.is_admin)) throw new HttpError(403, 'No access to this dashboard');
  const widgets = parse(d.widgets, []);
  const results = {};
  await Promise.all(widgets.map(async w => { results[w.id] = await runWidget(c, w); }));
  return { id: d.id, name: d.name, widgets, access, results, canEdit: !!c.user.is_admin, area_id: d.area_id, status: d.status, owner_id: d.owner_id };
});
async function runWidget(c, w) {
  try { const sql = FB.logic.widgetSQL(w); if (!sql) return { columns: [], values: [] }; return await tabular(c.db, assertSelect(sql)); }
  catch (e) { return { error: e.message.replace(/^D1_ERROR: /, '') }; }
}
route('POST', '/api/admin/query', async (c) => runWidget(c, (await c.body()).widget || {}), { admin: true });
route('POST', '/api/admin/dashboards', async (c) => {
  const b = await c.body();
  return { id: await run(c.db, 'INSERT INTO dashboards(name, widgets, area_id, status, owner_id, updated_at) VALUES (?,?,?,?,?,?)', String(b.name || 'New dashboard').slice(0, 120), '[]', await areaOf(c, b.area_id), 'active', c.user.id, now()) };
}, { admin: true });
route('PUT', '/api/admin/dashboards/:id', async (c, { id }) => {
  const b = await c.body();
  const old = await first(c.db, 'SELECT * FROM dashboards WHERE id = ?', Number(id));
  if (!old) throw new HttpError(404, 'Dashboard not found');
  await run(c.db, 'UPDATE dashboards SET name = ?, widgets = ?, access = ?, area_id = ?, status = ?, owner_id = ?, updated_at = ? WHERE id = ?', String(b.name || 'Dashboard').slice(0, 120), JSON.stringify(b.widgets || []), JSON.stringify(b.access || {}),
    b.area_id === undefined ? old.area_id : await areaOf(c, b.area_id), cleanStatus(b.status, old.status), b.owner_id === undefined ? old.owner_id : await personOf(c, b.owner_id), now(), old.id);
}, { admin: true });
route('DELETE', '/api/admin/dashboards/:id', async (c, { id }) => {
  const d = await first(c.db, 'SELECT id, name, status FROM dashboards WHERE id = ?', Number(id));
  if (!d) throw new HttpError(404, 'Dashboard not found');
  if (d.status !== 'archived') throw new HttpError(409, 'Archive the dashboard first: archived items can be deleted for good.');
  c.note(d.name); await run(c.db, 'DELETE FROM dashboards WHERE id = ?', d.id);
}, { admin: true });

// ---------------------------------------------------------------- admin: forms
route('GET', '/api/admin/forms', async (c) => {
  const counts = Object.fromEntries((await all(c.db, 'SELECT form_id, count(*) AS n FROM submissions GROUP BY form_id')).map(r => [r.form_id, r.n]));
  const flows = (await all(c.db, 'SELECT name, graph, status FROM flows')).map(fl => ({ name: fl.name, status: fl.status, forms: new Set(parse(fl.graph, { nodes: [] }).nodes.map(n => Number(n.formId)).filter(Boolean)) }));
  return (await c.forms()).map(f => ({ id: f.id, name: f.name, slug: f.slug, description: f.description, fields: f.fields.length, records: counts[f.id] || 0, updated_at: f.updated_at, area_id: f.area_id, status: f.status, owner_id: f.owner_id,
    usedIn: flows.filter(fl => fl.status !== 'archived' && fl.forms.has(f.id)).length }));
}, { admin: true });
route('GET', '/api/admin/forms/:id', async (c, { id }) => {
  const forms = await c.forms();
  const f = await c.form(id);
  const usedIn = (await all(c.db, 'SELECT id, name, graph, status FROM flows')).filter(fl => parse(fl.graph, { nodes: [] }).nodes.some(n => Number(n.formId) === f.id)).map(fl => ({ id: fl.id, name: fl.name, status: fl.status }));
  const usedByForms = forms.filter(x => x.id !== f.id && x.fields.some(fd => fd.type === 'record' && Number(fd.recordForm) === f.id)).map(x => ({ id: x.id, name: x.name }));
  const usedInDash = (await all(c.db, 'SELECT id, name, widgets FROM dashboards')).filter(d => String(d.widgets).includes('form_' + f.slug)).map(d => ({ id: d.id, name: d.name }));
  return { form: f, others: forms.filter(x => x.id !== f.id).map(x => ({ id: x.id, name: x.name, fields: x.fields })), usedIn, usedByForms, usedInDash };
}, { admin: true });
route('POST', '/api/admin/forms', async (c) => {
  const b = await c.body();
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'Name required');
  let slug = slugify(name), n = 2;
  while (await first(c.db, 'SELECT 1 FROM forms WHERE slug = ?', slug)) slug = slugify(name) + '_' + n++;
  const id = await run(c.db, 'INSERT INTO forms(name, slug, description, fields, access, area_id, status, owner_id, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', name, slug, '', '[]', '{}', await areaOf(c, b.area_id), 'active', c.user.id, now());
  await c.db.batch(formViewSQL({ id, slug, fields: [] }).map(s => c.db.prepare(s)));
  return { id };
}, { admin: true });
route('PUT', '/api/admin/forms/:id', async (c, { id }) => {
  const old = await c.form(id);
  const b = await c.body();
  const form = { ...old, name: String(b.name || old.name).slice(0, 120), description: String(b.description || ''), fields: Array.isArray(b.fields) ? b.fields : [], checks: Array.isArray(b.checks) ? b.checks : [], access: b.access || {},
    area_id: b.area_id === undefined ? old.area_id : await areaOf(c, b.area_id), status: cleanStatus(b.status, old.status), owner_id: b.owner_id === undefined ? old.owner_id : await personOf(c, b.owner_id) };
  if (form.status === 'archived' && old.status !== 'archived') {
    const active = (await all(c.db, "SELECT name, graph FROM flows WHERE status = 'active'")).filter(fl => parse(fl.graph, { nodes: [] }).nodes.some(n => Number(n.formId) === form.id));
    if (active.length) throw new HttpError(409, 'This form is used by active process' + (active.length > 1 ? 'es' : '') + ': ' + active.map(a => a.name).join(', ') + '. Change those first.');
  }
  const problems = FB.logic.lint(form);
  if (problems.length) throw new HttpError(400, problems[0], { problems });
  await c.db.batch([
    c.db.prepare('UPDATE forms SET name = ?, description = ?, fields = ?, checks = ?, access = ?, area_id = ?, status = ?, owner_id = ?, updated_at = ? WHERE id = ?')
      .bind(form.name, form.description, JSON.stringify(form.fields), JSON.stringify(form.checks), JSON.stringify(form.access), form.area_id, form.status, form.owner_id, now(), form.id),
    ...formViewSQL(form).map(s => c.db.prepare(s)),
  ]);
}, { admin: true });
route('DELETE', '/api/admin/forms/:id', async (c, { id }) => {
  const f = await c.form(id);
  if (f.status !== 'archived') throw new HttpError(409, 'Archive the form first: archived items can be deleted for good.');
  c.note(f.name);
  const used = (await all(c.db, 'SELECT name, graph FROM flows')).filter(fl => parse(fl.graph, { nodes: [] }).nodes.some(n => Number(n.formId) === f.id));
  if (used.length) throw new HttpError(409, 'Form is used in flow: ' + used.map(u => u.name).join(', '));
  await c.db.batch([c.db.prepare('DELETE FROM forms WHERE id = ?').bind(f.id), c.db.prepare(`DROP VIEW IF EXISTS ${qi('form_' + f.slug)}`)]);
}, { admin: true });

// ---------------------------------------------------------------- admin: flows
route('GET', '/api/admin/flows', async (c) => {
  const allForms = await c.forms(), forms = allForms.filter(f => f.status !== 'archived').map(f => f.id);
  const stats = Object.fromEntries((await all(c.db, "SELECT flow_id, count(*) AS n, sum(status = 'running') AS r FROM instances GROUP BY flow_id")).map(r => [r.flow_id, r]));
  return (await all(c.db, 'SELECT * FROM flows ORDER BY name')).map(f => {
    const g = parse(f.graph, { nodes: [], edges: [] }), due = reviewDueAt(f);
    return { id: f.id, name: f.name, description: f.description, version: f.version, steps: g.nodes.length, issues: FB.logic.lintFlow(g, forms, allForms).length, runs: stats[f.id]?.n || 0, running: stats[f.id]?.r || 0,
      area_id: f.area_id, status: f.status, owner_id: f.owner_id, reviewDue: due, overdue: !!(due && due < now().slice(0, 10)), updated_at: f.updated_at,
      startForm: (startNode(g) || {}).formId || null, publicToken: (startNode(g) || {}).publicEnabled ? (startNode(g) || {}).publicToken || null : null };
  });
}, { admin: true });
route('GET', '/api/admin/flows/:id', async (c, { id }) => {
  const f = await first(c.db, 'SELECT * FROM flows WHERE id = ?', Number(id));
  if (!f) throw new HttpError(404, 'Flow not found');
  const allForms = await c.forms(), forms = allForms.filter(x => x.status !== 'archived').map(x => x.id);
  return { ...f, graph: parse(f.graph, { nodes: [], edges: [] }), doc: parse(f.doc, {}), issues: FB.logic.lintFlow(parse(f.graph, { nodes: [], edges: [] }), forms, allForms), reviewDue: reviewDueAt(f) };
}, { admin: true });
route('POST', '/api/admin/flows', async (c) => {
  const b = await c.body();
  const graph = { nodes: [{ id: 'n1', type: 'start', name: 'Start', x: 80, y: 160 }, { id: 'n2', type: 'end', name: 'Done', x: 460, y: 160 }], edges: [{ id: 'e1', from: 'n1', to: 'n2' }] };
  const fid = await run(c.db, 'INSERT INTO flows(name, description, graph, doc, version, area_id, status, owner_id, review_months, updated_at) VALUES (?,?,?,?,1,?,?,?,12,?)',
    String(b.name || 'New process').slice(0, 120), '', JSON.stringify(graph), '{}', await areaOf(c, b.area_id), 'draft', c.user.id, now());
  await snapshotFlow(c, { id: fid, name: String(b.name || 'New process'), graph: JSON.stringify(graph), doc: '{}', version: 1 });
  return { id: fid };
}, { admin: true });
route('PUT', '/api/admin/flows/:id', async (c, { id }) => {
  const f = await first(c.db, 'SELECT * FROM flows WHERE id = ?', Number(id));
  if (!f) throw new HttpError(404, 'Flow not found');
  const b = await c.body();
  const graphObj = b.graph || { nodes: [], edges: [] };
  const st0 = startNode(graphObj);
  if (st0 && st0.publicEnabled && !/^[a-f0-9]{24}$/.test(st0.publicToken || '')) st0.publicToken = randomToken().slice(0, 24);   // (the public link: unguessable, made by the server)
  if (st0 && !st0.publicEnabled) delete st0.publicToken;
  const graph = JSON.stringify(graphObj);
  const version = graph !== f.graph ? f.version + 1 : f.version; // running processes keep their own snapshot
  const allForms = await c.forms();
  const issues = FB.logic.lintFlow(graphObj, allForms.filter(x => x.status !== 'archived').map(x => x.id), allForms);
  let status = cleanStatus(b.status, f.status), note = '';
  if (status === 'active' && issues.length) {
    if (f.status === 'active') { status = 'draft'; note = 'Saved as draft: an active process may not have open issues (' + issues[0] + ')'; }
    else throw new HttpError(400, 'Fix the issues before activating this process: ' + issues[0], { issues });
  }
  const months = b.review_months === undefined ? f.review_months : Math.max(0, Math.min(60, Math.floor(Number(b.review_months)) || 0));
  await run(c.db, 'UPDATE flows SET name = ?, description = ?, graph = ?, doc = ?, version = ?, area_id = ?, status = ?, owner_id = ?, review_months = ?, updated_at = ? WHERE id = ?',
    String(b.name || f.name).slice(0, 120), String(b.description || ''), graph, JSON.stringify(b.doc || {}), version,
    b.area_id === undefined ? f.area_id : await areaOf(c, b.area_id), status, b.owner_id === undefined ? f.owner_id : await personOf(c, b.owner_id), months, now(), f.id);
  if (version !== f.version) await snapshotFlow(c, { id: f.id, name: String(b.name || f.name), graph, doc: JSON.stringify(b.doc || {}), version });
  if (status !== f.status) c.note(String(b.name || f.name), 'Status: ' + f.status + ' → ' + status);
  return { version, issues, status, note, graph: graphObj };
}, { admin: true });
route('DELETE', '/api/admin/flows/:id', async (c, { id }) => {
  const f = await first(c.db, 'SELECT id, name, status FROM flows WHERE id = ?', Number(id));
  if (!f) throw new HttpError(404, 'Flow not found');
  if (f.status !== 'archived') throw new HttpError(409, 'Archive the process first: archived items can be deleted for good.');
  const n = (await first(c.db, 'SELECT count(*) AS n FROM instances WHERE flow_id = ?', f.id)).n;
  c.note(f.name, n ? n + ' process run(s) deleted with it' : '');
  await run(c.db, 'DELETE FROM flows WHERE id = ?', f.id);
}, { admin: true });

/** Remember a flow's state at this version (history to look at or restore). Keeps the last 40. */
async function snapshotFlow(c, f) {
  await c.db.batch([
    c.db.prepare('INSERT INTO flow_versions(flow_id, version, name, graph, doc, saved_at, saved_by) VALUES (?,?,?,?,?,?,?)').bind(f.id, f.version, f.name, f.graph, f.doc, now(), c.user.id),
    c.db.prepare('DELETE FROM flow_versions WHERE flow_id = ? AND id NOT IN (SELECT id FROM flow_versions WHERE flow_id = ? ORDER BY id DESC LIMIT 40)').bind(f.id, f.id),
  ]);
}
route('GET', '/api/admin/flows/:id/versions', async (c, { id }) => {
  const rows = await all(c.db, 'SELECT v.id, v.version, v.name, v.saved_at, p.name AS who, v.graph FROM flow_versions v LEFT JOIN persons p ON p.id = v.saved_by WHERE v.flow_id = ? ORDER BY v.id DESC', Number(id));
  return rows.map(r => { const g = parse(r.graph, { nodes: [] }); return { id: r.id, version: r.version, name: r.name, saved_at: r.saved_at, who: r.who, steps: g.nodes.length, tasks: g.nodes.filter(n => n.type === 'task').length }; });
}, { admin: true });
route('GET', '/api/admin/flows/:id/versions/:vid', async (c, { id, vid }) => {
  const v = await first(c.db, 'SELECT * FROM flow_versions WHERE id = ? AND flow_id = ?', Number(vid), Number(id));
  if (!v) throw new HttpError(404, 'Version not found');
  return { id: v.id, version: v.version, name: v.name, saved_at: v.saved_at, graph: parse(v.graph, { nodes: [], edges: [] }), doc: parse(v.doc, {}) };
}, { admin: true });
route('POST', '/api/admin/flows/:id/restore', async (c, { id }) => {
  const f = await first(c.db, 'SELECT * FROM flows WHERE id = ?', Number(id));
  const v = await first(c.db, 'SELECT * FROM flow_versions WHERE id = ? AND flow_id = ?', Number((await c.body()).versionId), Number(id));
  if (!f || !v) throw new HttpError(404, 'Version not found');
  const allF = await c.forms(), issues = FB.logic.lintFlow(parse(v.graph, { nodes: [], edges: [] }), allF.filter(x => x.status !== 'archived').map(x => x.id), allF);
  const version = f.version + 1, status = f.status === 'active' && issues.length ? 'draft' : f.status;
  await run(c.db, 'UPDATE flows SET graph = ?, doc = ?, version = ?, status = ?, updated_at = ? WHERE id = ?', v.graph, v.doc || '{}', version, status, now(), f.id);
  await snapshotFlow(c, { id: f.id, name: f.name, graph: v.graph, doc: v.doc || '{}', version });
  c.note(f.name, 'Restored version ' + v.version + ' as version ' + version);
  return { version, status };
}, { admin: true });

// ---------------------------------------------------------------- admin: people & tags
route('GET', '/api/admin/people', async (c) => {
  const D = await c.dir();
  return { people: [...D.persons.values()].map(p => ({ ...p, tagIds: [...D.tagIdsOf(p.id)] })), tags: [...D.tags.values()], categories: D.categories() };
}, { admin: true });
async function savePerson(c, pid, b) {
  if (c.demo) throw new HttpError(403, 'People cannot be changed in the example.');
  const email = String(b.email || '').trim(), name = String(b.name || '').trim();
  if (!name || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Name and a valid e-mail are required');
  if (await first(c.db, 'SELECT 1 FROM persons WHERE email = ? AND id != ?', email, pid || 0)) throw new HttpError(409, 'E-mail already in use');
  if (b.password && String(b.password).length < 8) throw new HttpError(400, 'Use a password of at least 8 characters');
  if (!pid && !b.password) throw new HttpError(400, 'Set a password for the new person');
  if (pid === c.user.id && (!b.is_admin || !b.active)) throw new HttpError(400, 'You cannot remove your own admin rights or deactivate yourself');
  const hash = b.password ? await hashPassword(String(b.password)) : null;
  let id = pid;
  if (!pid) id = await run(c.db, 'INSERT INTO persons(name, email, pw_hash, is_admin, active, created_at) VALUES (?,?,?,?,?,?)', name, email, hash, b.is_admin ? 1 : 0, b.active === false ? 0 : 1, now());
  const st = [];
  if (pid) {
    st.push(c.db.prepare(`UPDATE persons SET name = ?, email = ?, is_admin = ?, active = ?${hash ? ', pw_hash = ?' : ''} WHERE id = ?`).bind(...[name, email, b.is_admin ? 1 : 0, b.active ? 1 : 0].concat(hash ? [hash] : [], [pid])));
    if (hash || !b.active) st.push(c.db.prepare('DELETE FROM sessions WHERE person_id = ? AND ? = 0').bind(pid, pid === c.user.id ? 1 : 0));
  }
  st.push(c.db.prepare('DELETE FROM person_tags WHERE person_id = ?').bind(id));
  for (const tid of (b.tagIds || []).map(Number).filter(Number.isInteger)) st.push(c.db.prepare('INSERT OR IGNORE INTO person_tags(person_id, tag_id) VALUES (?,?)').bind(id, tid));
  await c.db.batch(st);
  return { id };
}
route('POST', '/api/admin/people', async (c) => savePerson(c, null, await c.body()), { admin: true });
route('PUT', '/api/admin/people/:id', async (c, { id }) => savePerson(c, Number(id), await c.body()), { admin: true });
route('POST', '/api/admin/tags', async (c) => {
  const b = await c.body();
  const cat = String(b.category || '').trim().slice(0, 60), val = String(b.value || '').trim().slice(0, 80);
  if (!cat || !val) throw new HttpError(400, 'Category and value are required');
  await run(c.db, 'INSERT OR IGNORE INTO tags(category, value) VALUES (?,?)', cat, val);
}, { admin: true });
route('DELETE', '/api/admin/tags/:id', async (c, { id }) => { await run(c.db, 'DELETE FROM tags WHERE id = ?', Number(id)); }, { admin: true });

// ---------------------------------------------------------------- admin: SQL, settings, export
route('GET', '/api/admin/catalog', async (c) => {
  const objs = await all(c.db, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('sessions', 'd1_migrations') ORDER BY type DESC, name");
  const res = await c.db.batch(objs.map(o => c.db.prepare(`PRAGMA table_info(${qi(o.name)})`)));
  return objs.map((o, i) => ({ ...o, columns: res[i].results.map(r => r.name).filter(n => n !== 'pw_hash') }));
}, { admin: true });
route('POST', '/api/admin/sql', async (c) => {
  const sql = String((await c.body()).sql || '').trim();
  if (!sql) throw new HttpError(400, 'Empty query');
  if (/\b(sessions|pw_hash)\b/i.test(sql)) throw new HttpError(400, 'Passwords and sessions are protected.');
  if (c.demo && !/^\s*(select|with|explain)\b/i.test(sql)) throw new HttpError(403, 'In the example the SQL console is read-only.');
  const t0 = Date.now();
  try { const r = await tabular(c.db, sql); return { ...r, ms: Date.now() - t0 }; }
  catch (e) { throw new HttpError(400, e.message.replace(/^D1_ERROR: /, '')); }
}, { admin: true });
route('GET', '/api/admin/settings', async (c) => c.settings(), { admin: true });
route('PUT', '/api/admin/settings', async (c) => {
  const b = await c.body();
  const st = [];
  const set = (k, v) => st.push(c.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v));
  if (b.company != null) set('company', String(b.company).slice(0, 80));
  if (b.color != null) { if (b.color && !/^#[0-9a-f]{6}$/i.test(b.color)) throw new HttpError(400, 'Colour must look like #4f46e5'); set('color', b.color); }
  if (c.demo && b.notify_webhook) throw new HttpError(403, 'Webhooks are switched off in the example.');
  if (b.notify_webhook != null) { if (b.notify_webhook && !/^https:\/\//.test(b.notify_webhook)) throw new HttpError(400, 'Webhook must start with https://'); set('notify_webhook', b.notify_webhook); }
  if (b.notify_format != null) { if (!['json', 'teams'].includes(b.notify_format)) throw new HttpError(400, 'Format must be json or teams'); set('notify_format', b.notify_format); }
  if (st.length) await c.db.batch(st);
}, { admin: true });
route('GET', '/api/admin/export', async (c) => {
  const out = { exported_at: now(), tables: {} };
  for (const t of ['settings', 'areas', 'tags', 'forms', 'flows', 'flow_versions', 'dashboards', 'documents', 'document_versions', 'files', 'instances', 'tasks', 'submissions', 'events', 'audit']) out.tables[t] = await all(c.db, `SELECT * FROM ${t}`);
  out.tables.persons = await all(c.db, 'SELECT id, name, email, is_admin, active, created_at FROM persons');
  out.tables.person_tags = await all(c.db, 'SELECT * FROM person_tags');
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="ordovia-${now().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
}, { admin: true });


// ---------------------------------------------------------------- areas (departments / domains: how everything is grouped)
async function areaOf(c, v) {
  if (v == null || v === '') return null;
  const a = await first(c.db, 'SELECT id FROM areas WHERE id = ?', Number(v));
  if (!a) throw new HttpError(400, 'Unknown area');
  return a.id;
}
async function personOf(c, v) {
  if (v == null || v === '') return null;
  const p = (await c.dir()).persons.get(Number(v));
  if (!p) throw new HttpError(400, 'Unknown person');
  return p.id;
}
route('GET', '/api/areas', async (c) => all(c.db, 'SELECT * FROM v_areas ORDER BY name'));
async function saveArea(c, id, b) {
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Give the area a name');
  if (await first(c.db, 'SELECT 1 FROM areas WHERE name = ? AND id != ?', name, id || 0)) throw new HttpError(409, 'An area with this name exists');
  if (b.color && !/^#[0-9a-f]{6}$/i.test(b.color)) throw new HttpError(400, 'Colour must look like #4f46e5');
  const owner = await personOf(c, b.owner_id), desc = String(b.description || '').slice(0, 400), color = b.color || null;
  if (id) { await run(c.db, 'UPDATE areas SET name = ?, description = ?, color = ?, owner_id = ? WHERE id = ?', name, desc, color, owner, id); return { id }; }
  return { id: await run(c.db, 'INSERT INTO areas(name, description, color, owner_id, created_at) VALUES (?,?,?,?,?)', name, desc, color, owner, now()) };
}
route('POST', '/api/admin/areas', async (c) => saveArea(c, null, await c.body()), { admin: true });
route('PUT', '/api/admin/areas/:id', async (c, { id }) => saveArea(c, Number(id), await c.body()), { admin: true });
route('DELETE', '/api/admin/areas/:id', async (c, { id }) => {
  const a = await first(c.db, 'SELECT id, name FROM areas WHERE id = ?', Number(id));
  if (!a) throw new HttpError(404, 'Area not found');
  c.note(a.name, 'Its processes, forms and dashboards are now without area');
  await run(c.db, 'DELETE FROM areas WHERE id = ?', a.id);
}, { admin: true });

// ---------------------------------------------------------------- audit log: who changed what, when
const ENTITY = { forms: 'form', flows: 'process', dashboards: 'dashboard', people: 'person', tags: 'tag', areas: 'area', settings: 'settings', sql: 'sql', records: 'record', instances: 'run', tokens: 'api token', documents: 'document' };
async function logAudit(c, action, entity, entityId, name, detail) {
  try { await run(c.db, 'INSERT INTO audit(at, person_id, action, entity, entity_id, name, detail) VALUES (?,?,?,?,?,?,?)', now(), c.user ? c.user.id : null, action, entity, entityId ?? null, name ? String(name).slice(0, 200) : null, detail ? String(detail).slice(0, 400) : null); }
  catch (e) { console.warn('audit failed', e.message); }
}
async function writeAudit(c, r, params, out) {
  const parts = c.url.pathname.split('/').filter(Boolean), seg = parts[parts[1] === 'admin' ? 2 : 1] || '';
  if (seg === 'query' || seg === 'review') return;
  const method = c.req.method, body = (c._body && typeof c._body === 'object') ? c._body : {};
  const tail = parts[parts.length - 1];
  let action = method === 'POST' ? 'created' : method === 'PUT' ? 'changed' : 'deleted';
  if (method === 'POST' && params.id && /^[a-z]+$/.test(tail)) action = tail;   // e.g. restore
  let name = c.noteInfo && c.noteInfo.name != null ? c.noteInfo.name : (body.name || body.company || (body.category ? body.category + ': ' + body.value : null));
  let detail = c.noteInfo ? c.noteInfo.detail : null;
  if (seg === 'sql') { const q = String(body.sql || ''); if (/^\s*(select|with|pragma|explain)\b/i.test(q)) return; action = 'ran'; name = 'SQL statement'; detail = q.slice(0, 300); }
  if (seg === 'settings') { name = 'Workspace settings'; detail = 'Changed: ' + Object.keys(body).filter(k => body[k] != null).join(', '); }
  if (seg === 'people' && method === 'PUT' && body.password) detail = (detail ? detail + '; ' : '') + 'password changed';
  const entityId = params.id ? Number(params.id) : (out && out.id) || null;
  await logAudit(c, action, ENTITY[seg] || seg, entityId, name, detail);
}
route('GET', '/api/admin/audit', async (c) => {
  const lim = Math.min(500, Number(c.url.searchParams.get('limit')) || 200), ent = c.url.searchParams.get('entity'), eid = Number(c.url.searchParams.get('id')) || 0;
  const where = [], args = [];
  if (ent) { where.push('a.entity = ?'); args.push(ent); }
  if (eid) { where.push('a.entity_id = ?'); args.push(eid); }
  return all(c.db, `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.name, a.detail, p.name AS who FROM audit a LEFT JOIN persons p ON p.id = a.person_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${lim}`, ...args);
}, { admin: true });

// ---------------------------------------------------------------- health: what needs attention, in one list
route('GET', '/api/admin/health', async (c) => {
  const D = await c.dir(), forms = await c.forms(), today = now().slice(0, 10), items = [];
  const add = (level, kind, title, detail, link, fix) => items.push({ level, kind, title, detail: detail || '', link: link || '', ...(fix || {}) });
  const liveForms = forms.filter(f => f.status !== 'archived');
  const flows = await all(c.db, 'SELECT * FROM flows WHERE status != ? ORDER BY name', 'archived');
  const docs = await all(c.db, 'SELECT * FROM documents'), docById = new Map(docs.map(d => [d.id, d]));
  for (const d of docs.filter(x => x.status === 'active')) {
    const due = reviewDueAt(d), link = '#/documents/' + d.id;
    if (due && due < today) add('warn', 'review', 'Document “' + d.name + '” is due for review', 'Review was due ' + due, link);
    if (!d.owner_id) add('warn', 'ownership', 'Document “' + d.name + '” has no owner', '', link);
    if (!d.area_id) add('info', 'structure', 'Document “' + d.name + '” is in no area', '', link, { entity: 'document', id: d.id });
  }
  const usedForms = new Set();
  for (const f of flows) {
    const g = parse(f.graph, { nodes: [], edges: [] });
    g.nodes.forEach(n => { if (n.formId) usedForms.add(Number(n.formId)); });
    const issues = FB.logic.lintFlow(g, liveForms.map(x => x.id), forms), link = '#/admin/flows/' + f.id;
    if (f.status === 'active' && issues.length) add('error', 'process', f.name + ' is active but has issues', issues.slice(0, 3).join(' · '), link);
    // can anybody actually receive each task?
    for (const n of g.nodes.filter(x => x.type === 'task')) {
      const rule = n.assignee || { type: 'initiator' };
      if (rule.type === 'person' && !(D.persons.get(Number(rule.personId)) || {}).active) add(f.status === 'active' ? 'error' : 'warn', 'routing', f.name + ' · “' + n.name + '” goes to a person who is gone or inactive', D.describe(rule), link);
      if (rule.type === 'tags' && (rule.tagIds || []).length && ![...D.persons.values()].some(p => p.active && D.hasTags(p.id, rule.tagIds))) add(f.status === 'active' ? 'error' : 'warn', 'routing', f.name + ' · “' + n.name + '” has nobody to go to', 'No active person matches: ' + D.describe(rule), link);
    }
    for (const u of unknownVariables(g, forms)) add(f.status === 'active' ? 'warn' : 'info', 'data', f.name + ': “' + u.name + '” is used in ' + u.where + ' but no earlier step provides it', u.hint ? 'Did you mean ' + u.hint + '?' : 'Check the spelling, or add a form field or calculation with this name', link);
    for (const n of g.nodes) for (const did of (n.docIds || [])) { const dd = docById.get(Number(did)); if (!dd || dd.status === 'archived') add('warn', 'document', f.name + ' · “' + n.name + '” points to a document that is gone or archived', '', link); }
    const st = g.nodes.find(n => n.type === 'start');
    if (f.status === 'active' && st && (st.startTags || []).length && ![...D.persons.values()].some(p => p.active && D.hasTags(p.id, st.startTags))) add('warn', 'routing', f.name + ' cannot be started by anyone but admins', 'Nobody has the tags that may start it', link);
    if (f.status === 'active' && !f.owner_id) add('warn', 'ownership', f.name + ' has no owner', 'Every process needs a person who keeps it right', link);
    const due = reviewDueAt(f); if (f.status === 'active' && due && due < today) add('warn', 'review', f.name + ' is due for review', 'Review was due ' + due, '#/handbook/' + f.id);
    if (f.status === 'draft' && f.updated_at && f.updated_at < new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) add('info', 'draft', f.name + ' has been a draft for over 30 days', 'Finish it or archive it', link);
    if (f.status === 'active' && !f.area_id) add('info', 'structure', f.name + ' is in no area', '', link, { entity: 'flow', id: f.id });
  }
  for (const f of liveForms) {
    const n = (await first(c.db, 'SELECT count(*) AS n FROM submissions WHERE form_id = ?', f.id)).n;
    if (!usedForms.has(f.id) && !n && f.updated_at && f.updated_at < new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)) add('info', 'unused', f.name + ' is not used anywhere', 'No process uses it and it has no records – archive it?', '#/admin/forms/' + f.id);
    if (!f.area_id) add('info', 'structure', f.name + ' (form) is in no area', '', '#/admin/forms/' + f.id, { entity: 'form', id: f.id });
  }
  const stuck = await all(c.db, "SELECT id, title FROM instances WHERE status = 'stuck' LIMIT 20");
  stuck.forEach(i => add('error', 'run', 'Process run “' + i.title + '” is stuck', 'No arrow matched – fix the flow, then delete the run', '#/processes/' + i.id));
  const overdue = await all(c.db, "SELECT t.id, t.name, i.title, t.due_at FROM tasks t JOIN instances i ON i.id = t.instance_id WHERE t.status = 'open' AND t.due_at < ? ORDER BY t.due_at LIMIT 20", now());
  overdue.forEach(t => add('warn', 'overdue', 'Overdue: ' + t.name + ' – ' + t.title, 'Due ' + t.due_at, '#/task/' + t.id));
  const old = await all(c.db, "SELECT t.id, t.name, i.title, t.created_at FROM tasks t JOIN instances i ON i.id = t.instance_id WHERE t.status = 'open' AND t.due_at IS NULL AND t.created_at < ? LIMIT 20", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' '));
  old.forEach(t => add('warn', 'stale', 'Open for over 30 days: ' + t.name + ' – ' + t.title, 'Opened ' + t.created_at, '#/task/' + t.id));
  const dashes = await all(c.db, "SELECT id, name, widgets FROM dashboards WHERE status != 'archived' LIMIT 20");
  for (const d of dashes) for (const w of parse(d.widgets, [])) { const r = await runWidget(c, w); if (r.error) add('warn', 'dashboard', 'Dashboard “' + d.name + '”: widget “' + (w.title || w.id) + '” fails', r.error.slice(0, 160), '#/dashboards/' + d.id); }
  for (const d of await all(c.db, "SELECT id, name FROM dashboards WHERE area_id IS NULL AND status != 'archived' LIMIT 20")) add('info', 'structure', d.name + ' (dashboard) is in no area', '', '#/dashboards/' + d.id, { entity: 'dashboard', id: d.id });
  const admins = [...D.persons.values()].filter(p => p.is_admin && p.active).length;
  if (admins < 2) add('info', 'people', 'Only one administrator', 'Make a second person administrator so nobody is locked out', '#/admin/people');
  const order = { error: 0, warn: 1, info: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  return { items, counts: { error: items.filter(i => i.level === 'error').length, warn: items.filter(i => i.level === 'warn').length, info: items.filter(i => i.level === 'info').length } };
}, { admin: true });

// ---------------------------------------------------------------- search across everything the person may see
route('GET', '/api/search', async (c) => {
  const q = String(c.url.searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 2) return { q, results: [] };
  const pat = likePattern(q), D = await c.dir(), forms = await c.forms(), res = [], adm = c.user.is_admin ? 1 : 0;
  const add = (type, title, sub, link, extra) => res.push({ type, title, sub: sub || '', link, ...(extra || {}) });
  const areas = new Map((await all(c.db, 'SELECT id, name FROM areas')).map(a => [a.id, a.name]));
  for (const f of await all(c.db, "SELECT id, name, description, area_id, status, graph FROM flows WHERE (status = 'active' OR (? = 1 AND status != 'archived')) AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR doc LIKE ? ESCAPE '\\' OR graph LIKE ? ESCAPE '\\') ORDER BY name LIMIT 12", adm, pat, pat, pat, pat)) {
    const hit = parse(f.graph, { nodes: [] }).nodes.find(n => String(n.name || '').toLowerCase().includes(q.toLowerCase()) || String(n.instructions || '').toLowerCase().includes(q.toLowerCase()));
    add('Process', f.name, [areas.get(f.area_id), f.status !== 'active' ? f.status : '', hit && !f.name.toLowerCase().includes(q.toLowerCase()) ? 'step: ' + hit.name : ''].filter(Boolean).join(' · '), '#/handbook/' + f.id);
  }
  for (const f of forms.filter(x => x.status !== 'archived' || adm)) {
    if (!(canViewForm(c.user, D, f) || canAddForm(c.user, D, f))) continue;
    const lq = q.toLowerCase();
    if (f.name.toLowerCase().includes(lq) || String(f.description || '').toLowerCase().includes(lq) || f.fields.some(x => String(x.label || '').toLowerCase().includes(lq))) add('Form', f.name, areas.get(f.area_id) || '', '#/data/' + f.id);
  }
  for (const d of await all(c.db, "SELECT id, name, area_id, access, status FROM dashboards WHERE (status != 'archived' OR ? = 1) AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 8", adm, pat)) if (tagRule(c.user, D, parse(d.access, {}).viewTags)) add('Dashboard', d.name, areas.get(d.area_id) || '', '#/dashboards/' + d.id);
  for (const d of await all(c.db, "SELECT id, name, kind, area_id FROM documents WHERE (status != 'archived' OR ? = 1) AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY name LIMIT 8", adm, pat, pat)) add('Document', d.name, [d.kind, areas.get(d.area_id)].filter(Boolean).join(' · '), '#/documents/' + d.id);
  for (const a of await all(c.db, "SELECT id, name, description FROM areas WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' LIMIT 5", pat, pat)) add('Area', a.name, a.description, '#/area/' + a.id);
  for (const p of [...D.persons.values()].filter(p => p.active && (p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase()))).slice(0, 6)) add('Person', p.name, D.tagsOf(p.id).map(t => t.value).join(' · '), '');
  const insts = await all(c.db, "SELECT i.id, i.title, i.status, i.started_by FROM instances i WHERE i.title LIKE ? ESCAPE '\\' ORDER BY i.id DESC LIMIT 30", pat);
  let shown = 0;
  for (const i of insts) { if (shown >= 6) break; if (await canSeeInstance(c, i)) { add('Run', i.title, i.status, '#/processes/' + i.id); shown++; } }
  const recs = await all(c.db, "SELECT id, form_id, person_id, data FROM submissions WHERE data LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 60", pat);
  const fm = new Map(forms.map(f => [f.id, f])); shown = 0;
  for (const r of recs) {
    const f = fm.get(r.form_id); if (!f || shown >= 8) continue;
    if (!canViewForm(c.user, D, f) && r.person_id !== c.user.id) continue;
    add('Record', recordLabel(f, r.id, parse(r.data, {})), f.name, '#/data/' + f.id + '?open=' + r.id); shown++;
  }
  return { q, results: res };
});

// ---------------------------------------------------------------- public web forms: a process's request form, open to anyone with the link
const publicFlow = async (c, token) => {
  if (!/^[a-f0-9]{24}$/.test(token || '')) throw new HttpError(404, 'This form does not exist');
  const rows = await all(c.db, "SELECT * FROM flows WHERE status = 'active' AND graph LIKE ?", '%"publicToken":"' + token + '"%');
  for (const f of rows) { const st = startNode(parse(f.graph, { nodes: [] })); if (st && st.publicEnabled && st.publicToken === token) return { flow: f, start: st }; }
  throw new HttpError(404, 'This form does not exist or is closed');
};
const cleanFormForPublic = (f) => ({ name: f.name, description: f.description || '', fields: f.fields.map(x => ({ key: x.key, label: x.label, type: x.type, required: !!x.required, options: x.options, placeholder: x.placeholder, help: x.help, default: x.default, formula: x.formula, visibleIf: x.visibleIf, min: x.min, max: x.max, validate: x.validate, validateMsg: x.validateMsg })), checks: [] });
route('GET', '/api/public/request/:token', async (c, { token }) => {
  const { flow, start } = await publicFlow(c, token);
  const form = (await c.formsMap()).get(Number(start.formId));
  if (!form || form.status === 'archived') throw new HttpError(404, 'This form is closed');
  const s = await c.settings();
  return { company: s.company || 'Ordovia', process: flow.name, description: flow.description || '', form: cleanFormForPublic(form) };
}, { public: true });
route('POST', '/api/public/request/:token', async (c, { token }) => {
  const { flow } = await publicFlow(c, token);
  const b = await c.body();
  if (b.website) return { ok: true, reference: 'ok' };   // (a hidden field only robots fill in)
  if (JSON.stringify(b).length > 60000) throw new HttpError(413, 'This request is too large');
  const recent = await first(c.db, "SELECT count(*) AS n FROM instances WHERE flow_id = ? AND source = 'web' AND created_at > ?", flow.id, new Date(Date.now() - 3600000).toISOString().slice(0, 19).replace('T', ' '));
  if (recent.n >= 60) throw new HttpError(429, 'Too many requests right now, please try again in a while');
  const r = await startRun(c, flow, { data: b.data, source: 'web', requester: { name: String((b.requester && b.requester.name) || '').slice(0, 120), email: String((b.requester && b.requester.email) || '').slice(0, 160) } });
  return { ok: true, reference: '#' + r.instanceId };
}, { public: true });

// ---------------------------------------------------------------- API tokens (other systems call Ordovia as a chosen person)
route('GET', '/api/admin/tokens', async (c) => all(c.db, 'SELECT t.id, t.name, t.token_hint, t.person_id, p.name AS person, t.created_at, t.last_used_at, t.revoked_at FROM api_tokens t JOIN persons p ON p.id = t.person_id ORDER BY t.id DESC'), { admin: true });
route('POST', '/api/admin/tokens', async (c) => {
  const b = await c.body();
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Give the token a name, e.g. the system that will use it');
  const pid = await personOf(c, b.person_id);
  if (!pid) throw new HttpError(400, 'Choose the person this token acts as');
  const token = 'ord_' + randomToken();
  const id = await run(c.db, 'INSERT INTO api_tokens(name, token_hash, token_hint, person_id, created_by, created_at) VALUES (?,?,?,?,?,?)', name, await sha256(token), token.slice(0, 8) + '…' + token.slice(-4), pid, c.user.id, now());
  c.note(name, 'acts as ' + (await c.dir()).persons.get(pid).name);
  return { id, token };   // (shown once: only its hash is kept)
}, { admin: true });
route('DELETE', '/api/admin/tokens/:id', async (c, { id }) => {
  const t = await first(c.db, 'SELECT id, name FROM api_tokens WHERE id = ?', Number(id));
  if (!t) throw new HttpError(404, 'Token not found');
  c.note(t.name, 'revoked');
  await run(c.db, 'UPDATE api_tokens SET revoked_at = ? WHERE id = ?', now(), t.id);
}, { admin: true });

// ---------------------------------------------------------------- API v1: a stable, small surface for other systems
// Authenticate with  Authorization: Bearer ord_...  (create tokens under Control > API). Everything runs as the person the token belongs to,
// so the same permissions apply as in the app.
const fieldSpec = (f) => ({ key: f.key, label: f.label, type: f.type, required: !!f.required, ...(f.options ? { options: f.options } : {}), ...(f.type === 'calc' ? { calculated: true } : {}) });
const inputSpec = (form) => form ? { form: form.name, fields: form.fields.filter(f => f.type !== 'heading' && f.type !== 'calc').map(fieldSpec) } : null;
route('GET', '/api/v1/processes', async (c) => {
  const D = await c.dir(), forms = await c.formsMap();
  const areas = new Map((await all(c.db, 'SELECT id, name FROM areas')).map(a => [a.id, a.name]));
  return (await all(c.db, "SELECT id, name, description, graph, area_id, status FROM flows WHERE status = 'active' ORDER BY name")).flatMap(f => {
    const st = startNode(parse(f.graph, { nodes: [] }));
    if (!st || !(c.user.is_admin || D.hasTags(c.user.id, st.startTags))) return [];
    return [{ id: f.id, name: f.name, description: f.description || '', area: areas.get(f.area_id) || null, input: inputSpec(forms.get(Number(st.formId))), start: '/api/v1/processes/' + f.id + '/start' }];
  });
});
route('POST', '/api/v1/processes/:id/start', async (c, { id }) => {
  const flow = await first(c.db, 'SELECT * FROM flows WHERE id = ?', Number(id));
  if (!flow) throw new HttpError(404, 'Process not found');
  let b = {}; try { b = (await c.body()) || {}; } catch { /* empty body */ }
  const r = await startRun(c, flow, { data: b.data, source: 'api', ref: b.reference, callback: b.callbackUrl });
  return new Response(JSON.stringify({ run: await runView(c, r.instanceId) }), { status: 201, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
});
async function runView(c, iid) {
  const raw = await first(c.db, 'SELECT * FROM instances WHERE id = ?', Number(iid));
  if (!raw) throw new HttpError(404, 'Run not found');
  if (!(await canSeeInstance(c, raw))) throw new HttpError(403, 'No access to this run');
  const D = await c.dir(), vars = parse(raw.vars, {});
  const [info, tasks] = await Promise.all([first(c.db, 'SELECT * FROM v_instances WHERE id = ?', raw.id), all(c.db, 'SELECT name, status, assignee, due_at, completed_at FROM tasks WHERE instance_id = ? ORDER BY id', raw.id)]);
  return { id: raw.id, process: info.flow, title: raw.title, status: raw.status, outcome: vars.outcome ?? null, reference: raw.external_ref, source: raw.source, created_at: raw.created_at, finished_at: raw.finished_at,
    outputs: publicVars(vars), tasks: tasks.map(t => ({ name: t.name, status: t.status, assignee: D.describe(parse(t.assignee, {})), due_at: t.due_at, completed_at: t.completed_at })), url: c.url.origin + '/#/processes/' + raw.id };
}
route('GET', '/api/v1/runs/:id', async (c, { id }) => ({ run: await runView(c, id) }));
route('GET', '/api/v1/runs', async (c) => {
  const q = c.url.searchParams, ref = q.get('reference'), status = q.get('status'), lim = Math.min(200, Number(q.get('limit')) || 50);
  const where = [], args = [];
  if (ref) { where.push('v.external_ref = ?'); args.push(ref); }
  if (status) { where.push('v.status = ?'); args.push(status); }
  const rows = await all(c.db, `SELECT v.id, v.flow, v.title, v.status, v.outcome, v.external_ref AS reference, v.source, v.created_at, v.finished_at, i.started_by FROM v_instances v JOIN instances i ON i.id = v.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.id DESC LIMIT 500`, ...args);
  const out = [];
  for (const r of rows) { if (out.length >= lim) break; if (c.user.is_admin || r.started_by === c.user.id || (await canSeeInstance(c, { id: r.id, started_by: r.started_by }))) { delete r.started_by; out.push(r); } }
  return { runs: out };
});
route('GET', '/api/v1/forms', async (c) => {
  const D = await c.dir();
  return (await c.forms()).filter(f => f.status !== 'archived' && (canViewForm(c.user, D, f) || canAddForm(c.user, D, f))).map(f => ({ slug: f.slug, name: f.name, description: f.description || '', canRead: canViewForm(c.user, D, f), canAdd: canAddForm(c.user, D, f), fields: f.fields.filter(x => x.type !== 'heading').map(fieldSpec) }));
});
route('GET', '/api/v1/forms/:slug/records', async (c, { slug }) => {
  const form = (await c.forms()).find(f => f.slug === slug);
  if (!form) throw new HttpError(404, 'Form not found');
  const D = await c.dir(), all_ = canViewForm(c.user, D, form), lim = Math.min(1000, Number(c.url.searchParams.get('limit')) || 100);
  const res = await tabular(c.db, `SELECT * FROM ${qi('form_' + form.slug)} ${all_ ? '' : 'WHERE person_id = ' + Number(c.user.id)} ORDER BY id DESC LIMIT ${lim}`);
  return { records: res.values.map(r => Object.fromEntries(res.columns.map((k, i) => [k, r[i]]))) };
});
route('POST', '/api/v1/forms/:slug/records', async (c, { slug }) => {
  const form = (await c.forms()).find(f => f.slug === slug);
  if (!form) throw new HttpError(404, 'Form not found');
  const D = await c.dir();
  if (form.status === 'archived') throw new HttpError(409, 'This form is archived');
  if (!canAddForm(c.user, D, form)) throw new HttpError(403, 'You may not add records to this form');
  const b = await c.body();
  const res = await finalizeForm(c, form, b.data, { initiator: D.profile(c.user.id) });
  if (!res.ok) throw new HttpError(422, 'Please check the data', { errors: res.errors, formErrors: res.formErrors });
  const rid = await run(c.db, 'INSERT INTO submissions(form_id, person_id, data, created_at) VALUES (?,?,?,?)', form.id, c.user.id, JSON.stringify(res.data), now());
  const att = attachStatements(c, form, res.data, null); if (att.length) await c.db.batch(att);
  return new Response(JSON.stringify({ id: rid, data: res.data }), { status: 201, headers: { 'content-type': 'application/json; charset=utf-8' } });
});
route('GET', '/api/v1/ping', async (c) => ({ ok: true, as: c.user.name }));

/** The API described as a Swagger 2.0 file: import it in Power Automate / Power Apps / Logic Apps (custom connector) and every call below becomes an action. Public: it holds no data. */
route('GET', '/api/v1/openapi.json', async (c) => {
  const par = (name, where, type, summary, required) => ({ name, in: where, type, required: !!required, 'x-ms-summary': summary });
  const obj = { type: 'object', additionalProperties: true };
  const spec = {
    swagger: '2.0',
    info: { title: 'Ordovia', version: '1.0', description: 'Start and follow business processes, and read or add records in forms. Every call acts as the person the API token belongs to.' },
    host: c.url.host, basePath: '/api/v1', schemes: ['https'], consumes: ['application/json'], produces: ['application/json'],
    securityDefinitions: { token: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'Type: Bearer ord_… (the word Bearer, a space, then your token from Control › API & web forms).' } },
    security: [{ token: [] }],
    definitions: {
      Run: { type: 'object', properties: { id: { type: 'integer', 'x-ms-summary': 'Run id' }, process: { type: 'string', 'x-ms-summary': 'Process' }, title: { type: 'string', 'x-ms-summary': 'Title' }, status: { type: 'string', 'x-ms-summary': 'Status', description: 'running, done, stuck or cancelled' }, outcome: { type: 'string', 'x-ms-summary': 'Outcome' }, reference: { type: 'string', 'x-ms-summary': 'Your reference' }, outputs: { ...obj, 'x-ms-summary': 'Outputs' }, url: { type: 'string', 'x-ms-summary': 'Link' }, created_at: { type: 'string' }, finished_at: { type: 'string' } } },
      RunResponse: { type: 'object', properties: { run: { $ref: '#/definitions/Run' } } },
      StartRequest: { type: 'object', properties: { data: { ...obj, 'x-ms-summary': 'Request data', description: 'The fields of the request form: { "field_key": value }. See List processes.' }, reference: { type: 'string', 'x-ms-summary': 'Your reference', description: 'Your own number, e.g. an order number; find the run again with it.' }, callbackUrl: { type: 'string', 'x-ms-summary': 'Callback URL', description: 'https address that gets a message when the run finishes. In Power Automate: the URL of a "When an HTTP request is received" trigger.' } } },
      Process: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string' }, area: { type: 'string' }, input: obj } },
    },
    paths: {
      '/ping': { get: { operationId: 'Ping', summary: 'Check the connection', description: 'Returns the person this token acts as.', responses: { 200: { description: 'OK', schema: { type: 'object', properties: { ok: { type: 'boolean' }, as: { type: 'string', 'x-ms-summary': 'Acts as' } } } } } } },
      '/processes': { get: { operationId: 'ListProcesses', summary: 'List processes', description: 'The processes this token may start, with the input each one needs.', responses: { 200: { description: 'OK', schema: { type: 'array', items: { $ref: '#/definitions/Process' } } } } } },
      '/processes/{id}/start': { post: { operationId: 'StartProcess', summary: 'Start a process', description: 'Creates a run: the sequence of tasks of that process. The request form is checked exactly as in the app.',
        parameters: [par('id', 'path', 'integer', 'Process id', true), { name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/StartRequest' } }],
        responses: { 201: { description: 'Started', schema: { $ref: '#/definitions/RunResponse' } }, 422: { description: 'The data does not pass the form checks' } } } },
      '/runs': { get: { operationId: 'ListRuns', summary: 'List runs', description: 'Find runs by your reference or by status.',
        parameters: [par('reference', 'query', 'string', 'Your reference'), par('status', 'query', 'string', 'Status (running, done, stuck)'), par('limit', 'query', 'integer', 'Maximum number')],
        responses: { 200: { description: 'OK', schema: { type: 'object', properties: { runs: { type: 'array', items: { $ref: '#/definitions/Run' } } } } } } } },
      '/runs/{id}': { get: { operationId: 'GetRun', summary: 'Get a run', description: 'Status, outcome, outputs and tasks of one run.', parameters: [par('id', 'path', 'integer', 'Run id', true)], responses: { 200: { description: 'OK', schema: { $ref: '#/definitions/RunResponse' } } } } },
      '/forms': { get: { operationId: 'ListForms', summary: 'List forms', description: 'The forms (registers) this token may read or add to, with their fields.', responses: { 200: { description: 'OK', schema: { type: 'array', items: obj } } } } },
      '/forms/{slug}/records': {
        get: { operationId: 'ListRecords', summary: 'List records of a form', parameters: [par('slug', 'path', 'string', 'Form name (slug)', true), par('limit', 'query', 'integer', 'Maximum number')], responses: { 200: { description: 'OK', schema: { type: 'object', properties: { records: { type: 'array', items: obj } } } } } },
        post: { operationId: 'AddRecord', summary: 'Add a record to a form', description: 'Adds a record; the data is checked and written in the standard format.', parameters: [par('slug', 'path', 'string', 'Form name (slug)', true), { name: 'body', in: 'body', required: true, schema: { type: 'object', properties: { data: { ...obj, 'x-ms-summary': 'Record data' } } } }], responses: { 201: { description: 'Added', schema: obj }, 422: { description: 'The data does not pass the form checks' } } },
      },
    },
  };
  return new Response(JSON.stringify(spec, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'content-disposition': 'inline; filename="ordovia-api.swagger.json"' } });
}, { public: true });

// ---------------------------------------------------------------- the public example (its own database, DB_DEMO)
const PERSONAS = { admin: DEMO_ADMIN.email, anna: 'anna@example.com', bram: 'bram@example.com', sanne: 'sanne@example.com', carla: 'carla@example.com', daan: 'daan@example.com', eva: 'eva@example.com' };
async function ensureDemoData(c) {
  if (!(await first(c.db, 'SELECT id FROM persons LIMIT 1'))) { await resetDemo(c.db, c.files); await run(c.db, "INSERT OR REPLACE INTO settings(key, value) VALUES ('demo_seeded_at', ?)", String(Date.now())); }
}
route('POST', '/api/demo/enter', async (c) => {
  if (!c.demo) throw new HttpError(404, 'Not available');
  await ensureDemoData(c);
  let b = {}; try { b = (await c.body()) || {}; } catch { /* default persona */ }
  const email = PERSONAS[b.as] || PERSONAS.admin;
  const p = await first(c.db, 'SELECT id FROM persons WHERE email = ?', email);
  if (!p) throw new HttpError(404, 'Demo person not found');
  await startSession(c, p.id);
  c.cookies.push(`${MODE_COOKIE}=example; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  return { ok: true };
}, { public: true });
// back to the real workspace
route('POST', '/api/demo/leave', async (c) => {
  c.cookies.push(`${MODE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return { ok: true };
}, { public: true });
route('POST', '/api/demo/reset', async (c) => {
  if (!c.demo) throw new HttpError(404, 'Not available');
  const nowMs = Date.now();
  const seeded = await first(c.db, "SELECT value FROM settings WHERE key = 'demo_seeded_at'");
  if (seeded && nowMs - Number(seeded.value) < 10 * 60000) throw new HttpError(429, 'The example was reset a moment ago. Try again in a few minutes.');
  await resetDemo(c.db, c.files);
  await run(c.db, "INSERT OR REPLACE INTO settings(key, value) VALUES ('demo_seeded_at', ?)", String(Date.now()));
  return { ok: true };
}, { public: true });

route('POST', '/api/admin/assign-area', async (c) => {
  const b = await c.body();
  const table = { flow: 'flows', form: 'forms', dashboard: 'dashboards', document: 'documents' }[b.entity];
  if (!table) throw new HttpError(400, 'Unknown item type');
  const row = await first(c.db, 'SELECT id, name FROM ' + table + ' WHERE id = ?', Number(b.id));
  if (!row) throw new HttpError(404, 'Item not found');
  const aid = await areaOf(c, b.area_id);
  await run(c.db, 'UPDATE ' + table + ' SET area_id = ? WHERE id = ?', aid, row.id);
  if (b.entity === 'form') c._forms = null;
  c.note(row.name, 'Area: ' + (aid ? (await first(c.db, 'SELECT name FROM areas WHERE id = ?', aid)).name : 'none'));
  return { ok: true };
}, { admin: true });

// first-time help: the usual departments, so the workspace starts with a structure (only when there are no areas yet)
route('POST', '/api/admin/areas/starter', async (c) => {
  if ((await first(c.db, 'SELECT count(*) AS n FROM areas')).n) throw new HttpError(409, 'There are areas already');
  const starter = [['Finance', '#0891b2'], ['People & HR', '#7c3aed'], ['Sales', '#ea580c'], ['Operations', '#16a34a'], ['IT', '#64748b']];
  await c.db.batch(starter.map(([n, col]) => c.db.prepare('INSERT INTO areas(name, description, color, created_at) VALUES (?,?,?,?)').bind(n, '', col, now())));
  c.note('Starter areas', starter.map(x => x[0]).join(', '));
  return { ok: true };
}, { admin: true });

// ---------------------------------------------------------------- files (bytes in R2, register in D1)
const MAX_FILE = 10 * 1024 * 1024;
const INLINE_OK = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);
const EXT_MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', md: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', json: 'application/json', xml: 'application/xml' };
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|js|mjs|vbs|ps1|sh|jar|html?|svg|php)$/i;
const safeName = (n) => (String(n || 'file').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 150)) || 'file';
const mimeFor = (name, given) => { const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]; return EXT_MIME[(ext || '').toLowerCase()] || (given && /^[a-z]+\/[a-z0-9.+-]+$/i.test(given) && !/html|svg|javascript|xml/i.test(given) ? given : 'application/octet-stream'); };

route('POST', '/api/files', async (c) => {
  if (!c.files) throw new HttpError(503, 'File storage is not set up (R2 binding FILES).');
  const name = safeName(c.url.searchParams.get('name'));
  if (BLOCKED_EXT.test(name)) throw new HttpError(415, 'This kind of file is not allowed (programs, web pages and scripts).');
  if (Number(c.req.headers.get('content-length') || 0) > MAX_FILE) throw new HttpError(413, 'Files can be at most 10 MB.');
  const loose = (await first(c.db, 'SELECT count(*) AS n FROM files WHERE uploaded_by = ? AND attached_at IS NULL AND created_at > ?', c.user.id, new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' '))).n;
  if (loose >= 40) throw new HttpError(429, 'Too many unused uploads: finish or cancel the forms you have open first.');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'The file is empty.');
  if (buf.byteLength > MAX_FILE) throw new HttpError(413, 'Files can be at most 10 MB.');
  const key = 'f/' + randomToken().slice(0, 32), mime = mimeFor(name, c.url.searchParams.get('type'));
  await c.files.put(key, buf, { httpMetadata: { contentType: mime } });
  const id = await run(c.db, 'INSERT INTO files(key, name, mime, size, uploaded_by, created_at) VALUES (?,?,?,?,?,?)', key, name, mime, buf.byteLength, c.user.id, now());
  return { id, name, size: buf.byteLength, mime };
});

async function canReadFile(c, f) {
  if (c.user.is_admin || f.uploaded_by === c.user.id) return true;
  if (await first(c.db, "SELECT 1 FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.file_id = ? AND d.status != 'archived'", f.id)) return true;
  if (f.form_id) { const form = (await c.forms()).find(x => x.id === f.form_id); if (form && canViewForm(c.user, await c.dir(), form)) return true; }
  if (f.instance_id) { const inst = await first(c.db, 'SELECT * FROM instances WHERE id = ?', f.instance_id); if (inst && await canSeeInstance(c, inst)) return true; }
  return false;
}
route('GET', '/api/files/:id', async (c, { id }) => {
  const f = await first(c.db, 'SELECT * FROM files WHERE id = ?', Number(id));
  if (!f) throw new HttpError(404, 'File not found');
  if (!(await canReadFile(c, f))) throw new HttpError(403, 'No access to this file');
  const obj = c.files ? await c.files.get(f.key) : null;
  if (!obj) throw new HttpError(404, 'The file itself is missing');
  const inline = INLINE_OK.has(f.mime);
  return new Response(obj.body, { headers: {
    'content-type': inline ? f.mime : 'application/octet-stream',
    'content-disposition': `${inline && c.url.searchParams.get('download') !== '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'cache-control': 'private, no-store', 'content-length': String(f.size) } });
});

// ---------------------------------------------------------------- documents: the company library (norms, policies, instructions, templates)
const DOC_KINDS = ['norm', 'policy', 'procedure', 'instruction', 'template', 'other'];
/** The documents linked to a step; `sections` ({docId: "chapter 4.2"}) says which part of each one matters at that step. */
async function docsByIds(c, ids, sections) {
  ids = (ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return [];
  const rows = await all(c.db, `SELECT d.id, d.name, d.kind, d.folder, d.version, f.id AS file_id, f.name AS file_name, f.size, f.mime FROM documents d
    LEFT JOIN document_versions v ON v.document_id = d.id AND v.version = d.version LEFT JOIN files f ON f.id = v.file_id
    WHERE d.status != 'archived' AND d.id IN (${ids.map(() => '?').join(',')}) ORDER BY d.name`, ...ids);
  return sections ? rows.map(d => ({ ...d, section: String(sections[d.id] || '') })) : rows;
}
/** "Quality / ISO 9001": at most two levels, short names, no slashes inside a name. */
const cleanFolder = (v) => String(v || '').split('/').map(s => s.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, 2).join(' / ') || null;
const docRow = (d, today) => { const due = reviewDueAt(d); return { ...d, reviewDue: due, overdue: !!(due && due < today) }; };
async function takeFile(c, fileId, tx) {
  const f = await first(c.db, 'SELECT * FROM files WHERE id = ?', Number(fileId));
  if (!f || f.uploaded_by !== c.user.id || f.attached_at) throw new HttpError(400, 'Upload the file first');
  return f;
}
route('GET', '/api/documents', async (c) => {
  const today = now().slice(0, 10);
  const rows = await all(c.db, `SELECT d.*, p.name AS owner, f.id AS file_id, f.name AS file_name, f.size, f.mime FROM documents d LEFT JOIN persons p ON p.id = d.owner_id
    LEFT JOIN document_versions v ON v.document_id = d.id AND v.version = d.version LEFT JOIN files f ON f.id = v.file_id
    WHERE d.status != 'archived' OR ? = 1 ORDER BY d.name`, c.user.is_admin ? 1 : 0);
  return rows.map(d => docRow(d, today));
});
route('GET', '/api/documents/:id', async (c, { id }) => {
  const d = await first(c.db, 'SELECT d.*, p.name AS owner, a.name AS area FROM documents d LEFT JOIN persons p ON p.id = d.owner_id LEFT JOIN areas a ON a.id = d.area_id WHERE d.id = ?', Number(id));
  if (!d || (d.status === 'archived' && !c.user.is_admin)) throw new HttpError(404, 'Document not found');
  const versions = await all(c.db, `SELECT v.version, v.note, v.uploaded_at, p.name AS who, f.id AS file_id, f.name AS file_name, f.size FROM document_versions v LEFT JOIN persons p ON p.id = v.uploaded_by
    LEFT JOIN files f ON f.id = v.file_id WHERE v.document_id = ? ORDER BY v.version DESC`, d.id);
  const usedIn = [];
  for (const fl of await all(c.db, "SELECT id, name, graph FROM flows WHERE status = 'active'")) for (const n of parse(fl.graph, { nodes: [] }).nodes) if ((n.docIds || []).map(Number).includes(d.id)) usedIn.push({ id: fl.id, flow: fl.name, step: n.name, section: String((n.docSections || {})[d.id] || '') });
  const canManage = !!(c.user.is_admin || (d.owner_id && d.owner_id === c.user.id));
  return { ...docRow(d, now().slice(0, 10)), versions, usedIn, canManage };
});
async function saveDocument(c, id, b) {
  const old = id ? await first(c.db, 'SELECT * FROM documents WHERE id = ?', id) : null;
  if (id && !old) throw new HttpError(404, 'Document not found');
  const name = String(b.name || (old && old.name) || '').trim().slice(0, 160);
  if (!name) throw new HttpError(400, 'Give the document a name');
  const kind = DOC_KINDS.includes(b.kind) ? b.kind : (old ? old.kind : 'procedure');
  const months = b.review_months === undefined ? (old ? old.review_months : 12) : Math.max(0, Math.min(60, Math.floor(Number(b.review_months)) || 0));
  const area = b.area_id === undefined ? (old ? old.area_id : null) : await areaOf(c, b.area_id);
  const owner = b.owner_id === undefined ? (old ? old.owner_id : c.user.id) : await personOf(c, b.owner_id);
  const status = cleanStatus(b.status, old ? old.status : 'active'), desc = String(b.description === undefined ? (old ? old.description : '') : b.description || '').slice(0, 1000);
  const folder = b.folder === undefined ? (old ? old.folder : null) : cleanFolder(b.folder);
  if (old) { await run(c.db, 'UPDATE documents SET name = ?, kind = ?, description = ?, area_id = ?, folder = ?, owner_id = ?, status = ?, review_months = ?, updated_at = ? WHERE id = ?', name, kind, desc, area, folder, owner, status, months, now(), old.id); return { id: old.id }; }
  const f = await takeFile(c, b.fileId);
  const did = await run(c.db, 'INSERT INTO documents(name, kind, description, area_id, folder, owner_id, status, version, review_months, reviewed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)', name, kind, desc, area, folder, owner, status, months, now(), now(), now());
  await c.db.batch([c.db.prepare('INSERT INTO document_versions(document_id, version, file_id, note, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?)').bind(did, 1, f.id, String(b.note || '').slice(0, 300), c.user.id, now()),
    c.db.prepare('UPDATE files SET attached_at = ? WHERE id = ?').bind(now(), f.id)]);
  return { id: did };
}
route('POST', '/api/admin/documents', async (c) => saveDocument(c, null, await c.body()), { admin: true });
route('PUT', '/api/admin/documents/:id', async (c, { id }) => saveDocument(c, Number(id), await c.body()), { admin: true });
route('POST', '/api/documents/:id/versions', async (c, { id }) => {
  const d = await first(c.db, 'SELECT * FROM documents WHERE id = ?', Number(id));
  if (!d) throw new HttpError(404, 'Document not found');
  if (!c.user.is_admin && d.owner_id !== c.user.id) throw new HttpError(403, 'Only the owner or an administrator can upload a new version');
  const b = await c.body(), f = await takeFile(c, b.fileId), version = d.version + 1;
  await c.db.batch([c.db.prepare('INSERT INTO document_versions(document_id, version, file_id, note, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?)').bind(d.id, version, f.id, String(b.note || '').slice(0, 300), c.user.id, now()),
    c.db.prepare('UPDATE files SET attached_at = ? WHERE id = ?').bind(now(), f.id),
    c.db.prepare('UPDATE documents SET version = ?, reviewed_at = ?, updated_at = ? WHERE id = ?').bind(version, now(), now(), d.id)]);
  await logAudit(c, 'new version', 'document', d.id, d.name, 'v' + version + ' · ' + f.name);
  return { version };
});
route('POST', '/api/documents/:id/review', async (c, { id }) => {
  const d = await first(c.db, 'SELECT id, name, owner_id FROM documents WHERE id = ?', Number(id));
  if (!d) throw new HttpError(404, 'Document not found');
  if (!c.user.is_admin && d.owner_id !== c.user.id) throw new HttpError(403, 'Only the owner or an administrator can mark a document as reviewed');
  await run(c.db, 'UPDATE documents SET reviewed_at = ? WHERE id = ?', now(), d.id);
  await logAudit(c, 'reviewed', 'document', d.id, d.name);
  return { ok: true };
});
route('DELETE', '/api/admin/documents/:id', async (c, { id }) => {
  const d = await first(c.db, 'SELECT id, name, status FROM documents WHERE id = ?', Number(id));
  if (!d) throw new HttpError(404, 'Document not found');
  if (d.status !== 'archived') throw new HttpError(409, 'Archive the document first: archived items can be deleted for good.');
  const files = await all(c.db, 'SELECT f.id, f.key FROM document_versions v JOIN files f ON f.id = v.file_id WHERE v.document_id = ?', d.id);
  for (const f of files) { if (c.files) await c.files.delete(f.key); }
  await c.db.batch([...files.map(f => c.db.prepare('DELETE FROM files WHERE id = ?').bind(f.id)), c.db.prepare('DELETE FROM documents WHERE id = ?').bind(d.id)]);
  c.note(d.name, files.length + ' file(s) deleted');
}, { admin: true });

/** Names a flow's formulas use that no earlier step provides: usually a typo (the formula then silently gives nothing). */
function unknownVariables(g, forms) {
  const fm = new Map(forms.map(f => [f.id, f]));
  const known = new Set(['initiator', 'process', 'outcome']), objects = new Set(['initiator']);
  const addForm = (form) => {
    if (!form) return;
    objects.add(form.slug); known.add(form.slug);
    for (const fd of form.fields) { if (fd.type === 'heading') continue; known.add(fd.key); if (['person', 'record', 'file'].includes(fd.type)) { known.add(fd.key + '_label'); if (fd.type !== 'file') objects.add(fd.key); } }
  };
  for (const n of g.nodes) {
    if (n.formId) addForm(fm.get(Number(n.formId)));
    for (const a of FB.logic.assignments(n.assignments)) known.add(a.name);
    if (n.type === 'record' && n.mode !== 'update' && n.formId && fm.get(Number(n.formId))) known.add(fm.get(Number(n.formId)).slug);
  }
  const uses = [];
  const scan = (expr, where) => { if (!expr || !String(expr).trim()) return; let ids; try { ids = FB.expr.identifiers(expr); } catch { return; } for (const id of ids) uses.push({ name: id, where }); };
  for (const n of g.nodes) {
    if (n.type === 'start') scan(n.title, 'the process title');
    for (const a of FB.logic.assignments(n.assignments)) scan(a.expr, '“' + n.name + '”');
    for (const a of FB.logic.assignments(n.mapping)) scan(a.expr, '“' + n.name + '”');
    scan(n.recordId, '“' + n.name + '”');
  }
  for (const e of g.edges) scan(e.condition, 'an arrow condition' + (e.label ? ' (“' + e.label + '”)' : ''));
  const out = [], seen = new Set();
  const dist = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  for (const u of uses) {
    const root = u.name.split('.')[0];
    if (known.has(u.name) || (u.name.includes('.') && objects.has(root)) || known.has(root) && u.name.includes('.')) continue;
    if (seen.has(u.name)) continue; seen.add(u.name);
    const near = [...known].filter(k => dist(k, root) <= 2 && k !== root).sort((a, b) => dist(a, root) - dist(b, root))[0];
    out.push({ name: u.name, where: u.where, hint: near || '' });
  }
  return out;
}
