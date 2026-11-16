// Companies ("tenants"): each one has its own Durable Object database and its own file prefix, both in the EU.
// The control register (ControlDO) knows which companies exist and which e-mail address belongs to which company.
import { HttpError, all, first, run, now, formViewSQL, parse } from './lib.js';
import { TenantDB, TenantFiles } from './tenantdb.js';
import { TENANT_ID, newTenantId, isExampleAddress } from './control.js';

export const TENANT_COOKIE = 'ordovia_tenant';   // which company this browser belongs to (a selector, not a secret: the session still has to match inside that company)

// Production keeps every company's database in the EU jurisdiction. (The local runtime has no jurisdictions: DATA_REGION=local.)
const stubOf = (ns, name, env) => { const n = env.DATA_REGION === 'local' ? ns : ns.jurisdiction('eu'); return n.get(n.idFromName(name)); };

let controlReady = null;
/** The register of companies. */
export async function controlDB(env) {
  const stub = stubOf(env.CONTROL, 'control', env);
  if (!controlReady) controlReady = Promise.resolve(stub.provision()).catch((e) => { controlReady = null; throw e; });
  await controlReady;
  return new TenantDB(stub);
}
export const tenantStub = (env, id) => stubOf(env.TENANT, id, env);
export const tenantDB = (env, id) => new TenantDB(tenantStub(env, id));
export const tenantFiles = (env, id) => (env.FILES_EU ? new TenantFiles(env.FILES_EU, id) : null);

/** The company an incoming call belongs to, from what the call itself carries: a tenant cookie, or the id inside an API token / public form link. */
export function tenantHint(req, url, cookie) {
  const auth = req.headers.get('authorization') || '';
  const bearer = /^bearer\s+ord_([a-f0-9]{12})[a-f0-9]{64}$/i.exec(auth);
  if (bearer) return { id: bearer[1].toLowerCase(), via: 'token' };
  const pub = /^\/api\/public\/(?:request|account)\/([a-f0-9]{12})[a-f0-9]{24,40}(?:\/|$)/.exec(url.pathname);
  if (pub) return { id: pub[1], via: 'link' };
  if (cookie && TENANT_ID.test(cookie)) return { id: cookie, via: 'cookie' };
  return null;
}
/** Tokens and links made before companies existed carry no id; they belong to the workspace that was imported (or still waits to be). */
export const isLegacyCredential = (req, url) => /^bearer\s+ord_[a-f0-9]{64}$/i.test(req.headers.get('authorization') || '') || /^\/api\/public\/request\/[a-f0-9]{24}(?:\/|$)/.test(url.pathname);

export async function createTenant(env, name, legacy = 0) {
  const ctl = await controlDB(env);
  const id = newTenantId();
  await run(ctl, 'INSERT INTO tenants(id, name, created_at, legacy) VALUES (?,?,?,?)', id, String(name || 'My company').slice(0, 80), now(), legacy);
  await tenantStub(env, id).provision();
  return id;
}

/** An e-mail address signs in to exactly one company. Example addresses (example.com) are the example people inside a company and are not claimed. */
export async function claimEmail(ctl, tenantId, email) {
  const e = String(email || '').trim();
  if (!e || isExampleAddress(e)) return;
  const had = await first(ctl, 'SELECT tenant_id FROM identities WHERE email = ?', e);
  if (had && had.tenant_id !== tenantId) throw new HttpError(409, 'This e-mail address already has an account with another company. Sign in with it, or use another address.');
  if (!had) await run(ctl, 'INSERT INTO identities(email, tenant_id) VALUES (?,?)', e, tenantId);
}
export const releaseEmail = (ctl, tenantId, email) => run(ctl, 'DELETE FROM identities WHERE email = ? AND tenant_id = ?', String(email || '').trim(), tenantId);
export async function tenantOfEmail(ctl, email) {
  const r = await first(ctl, 'SELECT tenant_id FROM identities WHERE email = ?', String(email || '').trim());
  return r ? r.tenant_id : null;
}
/** After a restore the people may be different: the sign-in register follows the company's own list of people. */
export async function syncIdentities(env, tenantId, db) {
  const ctl = await controlDB(env);
  const mine = new Set((await all(db, 'SELECT email FROM persons')).map(p => p.email.toLowerCase()));
  for (const r of await all(ctl, 'SELECT email FROM identities WHERE tenant_id = ?', tenantId)) if (!mine.has(r.email.toLowerCase())) await releaseEmail(ctl, tenantId, r.email);
  for (const e of mine) await claimEmail(ctl, tenantId, e).catch(() => {});
}
/** The company leaves: its data, its files and its place in the sign-in register are removed. */
export async function deleteTenant(env, tenantId) {
  const ctl = await controlDB(env), files = tenantFiles(env, tenantId);
  if (files) { let cur; do { const l = await files.list({ cursor: cur, limit: 500 }); if (l.objects.length) await files.delete(l.objects.map(o => o.key)); cur = l.truncated ? l.cursor : null; } while (cur); }
  await tenantStub(env, tenantId).wipe();
  await run(ctl, 'DELETE FROM identities WHERE tenant_id = ?', tenantId);
  await run(ctl, 'DELETE FROM usage WHERE tenant_id = ?', tenantId);
  await run(ctl, 'DELETE FROM ms_identities WHERE tenant_id = ?', tenantId);
  await run(ctl, "UPDATE tenants SET status = 'deleted', name = '' WHERE id = ?", tenantId);
}
export const listTenants = async (env) => all(await controlDB(env), "SELECT id, name, legacy FROM tenants WHERE status != 'deleted'");

// ---------------------------------------------------------------- the first workspace (the old single database) becomes a company
const SKIP_TABLES = /^(sqlite_|_cf_|d1_migrations|sessions$)/;
/** The id of the company that the old single workspace became, or null while it has not been carried over. */
export async function legacyTenantId(env) {
  const ctl = await controlDB(env);
  const r = await first(ctl, 'SELECT id FROM tenants WHERE legacy = 1');
  return r ? r.id : null;
}
/** Copies the old workspace (database rows and files) into a new company. Run once, after someone proved they belong to it by signing in. */
export async function importLegacy(env) {
  const ctl = await controlDB(env);
  const have = await legacyTenantId(env);
  if (have) return have;
  const old = env.DB;
  const company = await first(old, "SELECT value FROM settings WHERE key = 'company'");
  const id = await createTenant(env, company ? company.value : 'My company', 1);
  const stub = tenantStub(env, id);
  try {
    const tables = (await all(old, "SELECT name FROM sqlite_master WHERE type = 'table'")).map(t => t.name).filter(n => !SKIP_TABLES.test(n));
    const batch = [];
    for (const name of tables) {
      const raw = await old.prepare(`SELECT * FROM "${name}"`).raw({ columnNames: true });
      const [columns, ...rows] = raw.length ? raw : [[]];
      if (columns && columns.length) batch.push({ name, columns, rows });
    }
    await stub.importRows(batch);
    const t = new TenantDB(stub);
    // the views that show every form as a table are not data: build them again
    const forms = await all(t, 'SELECT id, slug, fields FROM forms');
    if (forms.length) await t.batch(forms.flatMap(f => formViewSQL({ id: f.id, slug: f.slug, fields: parse(f.fields, []) }).map(s => t.prepare(s))));
    for (const p of await all(t, 'SELECT email FROM persons')) await claimEmail(ctl, id, p.email).catch(() => {});
    const files = tenantFiles(env, id);
    if (env.FILES && files) for (const f of await all(t, 'SELECT key FROM files')) {
      const o = await env.FILES.get(f.key);
      if (o) await files.put(f.key, o.body, { httpMetadata: o.httpMetadata });
    }
  } catch (e) {
    await stub.wipe().catch(() => {});
    await run(ctl, 'DELETE FROM identities WHERE tenant_id = ?', id);
    await run(ctl, 'DELETE FROM tenants WHERE id = ?', id);
    throw e;
  }
  return id;
}
