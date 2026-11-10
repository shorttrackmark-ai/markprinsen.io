// Ordovia server helpers: D1 access, auth, people/tag directory and permissions.
import '../public/js/expr.js';
import '../public/js/logic.js';

export const FB = globalThis.FB;

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export const parse = (s, fb) => { try { return s == null ? fb : JSON.parse(s); } catch { return fb; } };
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'item';
export const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"';
/** SQL literal, used only for bulk inserts of generated data. */
export const lit = (v) => v == null ? 'NULL' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL')
  : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`;

// ---------- D1 ----------
export const all = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).all()).results;
export const first = (db, sql, ...p) => db.prepare(sql).bind(...p).first();
export const run = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).run()).meta.last_row_id;

/** Collects statements and executes them atomically in one D1 batch. */
export class Tx {
  constructor(db) { this.db = db; this.stmts = []; this.after = []; }
  add(sql, ...p) { this.stmts.push(this.db.prepare(sql).bind(...p)); return this; }
  async commit() { if (this.stmts.length) await this.db.batch(this.stmts); this.stmts = []; }
}

// ---------- passwords & sessions ----------
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const ITER = 100000;

export async function hashPassword(pw, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(bits)}`;
}
export async function verifyPassword(pw, stored) {
  const [kind, , salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !salt) return false;
  const again = (await hashPassword(pw, salt)).split('$')[3];
  if (again.length !== hash.length) return false;
  let diff = 0; for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ again.charCodeAt(i);
  return diff === 0;
}
export async function sha256(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function randomToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); }

export const COOKIE = 'ordovia_session';
export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function readCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

// ---------- directory: people, tags and assignment rules ----------
export async function loadDirectory(db) {
  const [p, t, pt] = await db.batch([
    db.prepare('SELECT id, name, email, is_admin, active FROM persons ORDER BY name'),
    db.prepare('SELECT * FROM tags ORDER BY category, value'),
    db.prepare('SELECT person_id, tag_id FROM person_tags'),
  ]);
  return makeDirectory(p.results, t.results, pt.results);
}

/** Build the directory from plain rows (also used by the demo seeder, without a database). */
export function makeDirectory(personRows, tagRows, ptRows) {
  const persons = new Map(personRows.map(r => [r.id, r]));
  const tags = new Map(tagRows.map(r => [r.id, r]));
  const byPerson = new Map();
  for (const r of ptRows) { if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, new Set()); byPerson.get(r.person_id).add(r.tag_id); }
  const D = {
    persons, tags,
    tagIdsOf: (pid) => byPerson.get(pid) || new Set(),
    tagsOf: (pid) => [...(byPerson.get(pid) || [])].map(id => tags.get(id)).filter(Boolean),
    categories: () => [...new Set(tagRows.map(r => r.category))],
    profile(pid) {
      const p = persons.get(Number(pid)); if (!p) return {};
      const out = { id: p.id, name: p.name, email: p.email };
      for (const tg of D.tagsOf(p.id)) { const k = slugify(tg.category); out[k] = out[k] == null ? tg.value : [].concat(out[k], tg.value); }
      return out;
    },
    hasTags: (pid, tagIds) => (tagIds || []).every(id => D.tagIdsOf(pid).has(Number(id))),
    /** Does a person match an assignee rule for this process instance? */
    matches(pid, rule, inst) {
      rule = rule || {};
      const vars = inst ? (typeof inst.vars === 'string' ? parse(inst.vars, {}) : inst.vars || {}) : {};
      switch (rule.type) {
        case 'initiator': return !!inst && inst.started_by === pid;
        case 'person': return Number(rule.personId) === pid;
        case 'field': return Number(vars[rule.field]) === pid;
        case 'tags': {
          if (!D.hasTags(pid, rule.tagIds)) return false;
          for (const cat of rule.sameAs || []) {
            const mine = D.tagsOf(pid).filter(x => x.category === cat).map(x => x.value);
            const theirs = inst ? D.tagsOf(inst.started_by).filter(x => x.category === cat).map(x => x.value) : [];
            if (!mine.some(v => theirs.includes(v))) return false;
          }
          return true;
        }
        default: return true;
      }
    },
    describe(rule) {
      rule = rule || {};
      switch (rule.type) {
        case 'initiator': return 'The person who started the process';
        case 'person': return (persons.get(Number(rule.personId)) || { name: 'Unknown person' }).name;
        case 'field': return `Person chosen in “${rule.field}”`;
        case 'tags': {
          const parts = (rule.tagIds || []).map(id => { const x = tags.get(Number(id)); return x ? `${x.category}: ${x.value}` : '?'; });
          return parts.concat((rule.sameAs || []).map(c => `same ${c} as initiator`)).join(' + ') || 'Anyone';
        }
        default: return 'Anyone';
      }
    },
    personOptions(tagIds) {
      return [...persons.values()].filter(p => p.active && D.hasTags(p.id, tagIds)).map(p => ({ id: p.id, name: p.name }));
    },
  };
  return D;
}

// ---------- forms ----------
export const formRow = (f) => f && ({ ...f, fields: parse(f.fields, []), checks: parse(f.checks, []), access: parse(f.access, {}) });
export async function loadForms(db) {
  return (await all(db, 'SELECT * FROM forms ORDER BY name')).map(formRow);
}
export function recordLabel(form, id, data, labelKey) {
  const key = labelKey || (form.fields.find(f => ['text', 'email', 'select'].includes(f.type)) || {}).key;
  return key && data[key] != null && data[key] !== '' ? String(data[key]) : `${form.name} #${id}`;
}
/** SQL to (re)create the flattened view form_<slug>. */
export function formViewSQL(form) {
  const cols = ['s.id', 's.created_at', 's.updated_at', 's.person_id', 'p.name AS submitted_by', 's.instance_id'];
  const used = new Set(['id', 'created_at', 'updated_at', 'person_id', 'submitted_by', 'instance_id']);
  for (const f of form.fields) {
    if (f.type === 'heading' || !FB.logic.KEY_RE.test(f.key || '') || used.has(f.key)) continue;
    used.add(f.key);
    cols.push(`json_extract(s.data, '$.${f.key}') AS ${qi(f.key)}`);
    if ((f.type === 'person' || f.type === 'record' || f.type === 'file') && !used.has(f.key + '_label')) { used.add(f.key + '_label'); cols.push(`json_extract(s.data, '$.${f.key}_label') AS ${qi(f.key + '_label')}`); }
  }
  return [`DROP VIEW IF EXISTS ${qi('form_' + form.slug)}`,
    `CREATE VIEW ${qi('form_' + form.slug)} AS SELECT ${cols.join(', ')} FROM submissions s LEFT JOIN persons p ON p.id = s.person_id WHERE s.form_id = ${Number(form.id)}`];
}

// ---------- permissions ----------
export const tagRule = (user, D, tagIds) => !!user && (user.is_admin || !(tagIds && tagIds.length) || D.hasTags(user.id, tagIds));
export const canViewForm = (user, D, form) => tagRule(user, D, form.access.viewTags);
export const canAddForm = (user, D, form) => !!user && (user.is_admin || (form.access.direct !== false && tagRule(user, D, form.access.addTags)));

/** Read-only single SELECT guard for dashboard queries. */
export function assertSelect(sql) {
  const clean = String(sql || '').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(clean) || clean.includes(';')) throw new HttpError(400, 'Only a single SELECT query is allowed here.');
  if (/\b(sessions|pw_hash)\b/i.test(clean)) throw new HttpError(400, 'This query touches protected columns.');
  return clean;
}
/** Run a query and return {columns, values}. */
export async function tabular(db, sql) {
  const rows = await db.prepare(sql).raw({ columnNames: true });
  const [columns, ...values] = rows.length ? rows : [[]];
  // Never hand out password hashes or session tokens, whatever the query.
  const hide = columns.map((c, i) => /^(pw_hash|token_hash)$/i.test(c) || values.some(r => typeof r[i] === 'string' && r[i].startsWith('pbkdf2$')) ? i : -1).filter(i => i >= 0);
  if (!hide.length) return { columns, values };
  return { columns: columns.filter((_, i) => !hide.includes(i)), values: values.map(r => r.filter((_, i) => !hide.includes(i))) };
}

// ---------- structure: status, review cycle, search ----------
export const STATUSES = ['draft', 'active', 'archived'];
export const cleanStatus = (v, fallback) => (STATUSES.includes(v) ? v : fallback);
/** When a process must be reviewed again: the last review (or last change) plus review_months. null = never due. */
export function reviewDueAt(flow) {
  const months = Number(flow.review_months);
  if (!months || months < 1) return null;
  const base = flow.reviewed_at || flow.updated_at || flow.created_at;
  if (!base) return null;
  const d = new Date(String(base).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
/** A LIKE pattern that matches the text literally (use with ESCAPE '\'). */
export const likePattern = (q) => '%' + String(q).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
