// The D1-shaped adapter must behave like D1 for the query shapes the app uses. Run on real SQLite (node:sqlite) through the same runner as the Durable Object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TenantDB, TenantFiles, runStatements } from '../src/tenantdb.js';
import { MIGRATIONS } from '../src/migrations.gen.js';
import { tenantHint, isLegacyCredential } from '../src/tenancy.js';
import { isExampleAddress } from '../src/control.js';

/** A fake stub: one SQLite database per id, like one Durable Object per company. */
function company() {
  const sql = new DatabaseSync(':memory:');
  const exec = (q, ...p) => {
    const st = sql.prepare(q);
    const isRead = /^\s*(select|pragma|with)/i.test(q) || /returning/i.test(q);
    return {
      toArray: () => (isRead ? st.all(...p) : (st.run(...p), [])),
      raw: function* () { st.setReturnArrays(true); try { yield* st.all(...p); } finally { st.setReturnArrays(false); } },
      get columnNames() { return st.columns().map(c => c.name); },
    };
  };
  for (const m of MIGRATIONS) sql.exec(m.sql);
  return new TenantDB({ run: async (specs) => runStatements(exec, specs) });
}

test('prepare/bind/first/all/run behave like D1', async () => {
  const db = company();
  const id = (await db.prepare('INSERT INTO areas(name, description, color, created_at) VALUES (?,?,?,?)').bind('Sales', '', '#fff', 'now').run()).meta.last_row_id;
  assert.ok(id > 0);
  assert.equal((await db.prepare('SELECT name FROM areas WHERE id = ?').bind(id).first()).name, 'Sales');
  assert.equal(await db.prepare('SELECT name FROM areas WHERE id = ?').bind(id).first('name'), 'Sales');
  assert.equal(await db.prepare('SELECT name FROM areas WHERE id = ?').bind(999).first(), null);
  assert.equal((await db.prepare('SELECT * FROM areas').all()).results.length, 1);
  const raw = await db.prepare('SELECT id, name FROM areas').raw({ columnNames: true });
  assert.deepEqual(raw[0], ['id', 'name']); assert.equal(raw[1][1], 'Sales');
  assert.equal((await db.prepare('SELECT ?1 AS a, ?1 AS b').bind(5).first()).b, 5, 'numbered parameters');
  assert.equal((await db.prepare('SELECT ? AS a').bind(undefined).first()).a, null, 'undefined binds as null');
});

test('batch runs in order and returns rows for selects', async () => {
  const db = company();
  const out = await db.batch([
    db.prepare('INSERT INTO areas(name, description, color, created_at) VALUES (?,?,?,?)').bind('A', '', '', 'n'),
    db.prepare('SELECT COUNT(*) AS n FROM areas'),
    db.prepare('PRAGMA table_info(areas)'),
  ]);
  assert.equal(out[1].results[0].n, 1);
  assert.ok(out[2].results.some(c => c.name === 'name'));
  assert.ok(out[0].meta.last_row_id > 0);
});

test('two companies never see each other', async () => {
  const a = company(), b = company();
  await a.prepare('INSERT INTO areas(name, description, color, created_at) VALUES (?,?,?,?)').bind('Only A', '', '', 'n').run();
  assert.equal((await b.prepare('SELECT * FROM areas').all()).results.length, 0);
  assert.equal((await a.prepare('SELECT * FROM areas').all()).results.length, 1);
});

test('files are kept under the company prefix', async () => {
  const store = new Map();
  const bucket = { put: async (k, v) => store.set(k, v), get: async (k) => store.get(k) ?? null, delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach(x => store.delete(x)); }, list: async ({ prefix }) => ({ objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }) };
  const a = new TenantFiles(bucket, 'aaaaaaaaaaaa'), b = new TenantFiles(bucket, 'bbbbbbbbbbbb');
  await a.put('doc.pdf', 'A'); await b.put('doc.pdf', 'B');
  assert.equal(await a.get('doc.pdf'), 'A'); assert.equal(await b.get('doc.pdf'), 'B');
  assert.deepEqual((await a.list()).objects.map(o => o.key), ['doc.pdf']);
  await a.delete('doc.pdf'); assert.equal(await a.get('doc.pdf'), null); assert.equal(await b.get('doc.pdf'), 'B');
});

test('the company is read from cookie, token or public link', () => {
  const req = (h = {}) => ({ headers: { get: (k) => h[k.toLowerCase()] || null } });
  const u = (p) => new URL('https://x.test' + p);
  const tid = 'a1b2c3d4e5f6';
  assert.equal(tenantHint(req(), u('/api/home'), tid).id, tid);
  assert.equal(tenantHint(req(), u('/api/home'), 'not-an-id'), null);
  assert.equal(tenantHint(req({ authorization: 'Bearer ord_' + tid + 'f'.repeat(64) }), u('/api/home'), null).id, tid);
  assert.equal(tenantHint(req(), u('/api/public/request/' + tid + 'e'.repeat(24)), null).id, tid);
  assert.equal(isLegacyCredential(req({ authorization: 'Bearer ord_' + 'f'.repeat(64) }), u('/api/home')), true);
  assert.equal(isLegacyCredential(req(), u('/api/public/request/' + 'e'.repeat(24))), true);
  assert.equal(isLegacyCredential(req({ authorization: 'Bearer ord_' + tid + 'f'.repeat(64) }), u('/api/home')), false);
});

test('example addresses are not claimed by a company', () => {
  assert.equal(isExampleAddress('anna@example.com'), true);
  assert.equal(isExampleAddress('anna@acme.nl'), false);
});
