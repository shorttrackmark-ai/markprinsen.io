// One Durable Object = one SQLite database. TenantDO holds a company's data, ControlDO the register of companies.
// Both bring their own schema up to date the first time they are used after a deploy ("lazy migrations"), so a new version
// never needs a consultant, a maintenance window or a command per company.
import { DurableObject } from 'cloudflare:workers';
import { runStatements } from './tenantdb.js';
import { MIGRATIONS } from './migrations.gen.js';
import { CONTROL_MIGRATIONS } from './control.js';

class SqlObject extends DurableObject {
  migrations() { return []; }
  constructor(ctx, env) { super(ctx, env); this.sql = ctx.storage.sql; this.ready = false; }

  /** A company's database only comes to life through provision(); a made-up id never gets a schema. */
  provision() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS _ord_meta (key TEXT PRIMARY KEY, value TEXT)');
    this.sql.exec("INSERT OR IGNORE INTO _ord_meta(key, value) VALUES ('provisioned', ?)", new Date().toISOString());
    this.migrate();
    return true;
  }
  isProvisioned() {
    try { return this.sql.exec("SELECT 1 AS x FROM _ord_meta WHERE key = 'provisioned'").toArray().length > 0; } catch { return false; }
  }
  migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS _ord_migrations (name TEXT PRIMARY KEY, applied_at TEXT)');
    const done = new Set(this.sql.exec('SELECT name FROM _ord_migrations').toArray().map(r => r.name));
    for (const m of this.migrations()) {
      if (done.has(m.name)) continue;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(m.sql);
        this.sql.exec('INSERT INTO _ord_migrations(name, applied_at) VALUES (?, ?)', m.name, new Date().toISOString());
      });
    }
    this.ready = true;
  }
  ensure() {
    if (this.ready) return;
    if (!this.isProvisioned()) throw new Error('Unknown workspace');
    this.migrate();
  }
  /** A batch of statements, in one transaction. */
  run(specs) {
    this.ensure();
    return this.ctx.storage.transactionSync(() => runStatements((q, ...p) => this.sql.exec(q, ...p), specs));
  }
  /** Copy rows in from another database (used once, to carry the first workspace over). Foreign keys are checked at the end. */
  importRows(tables) {
    this.ensure();
    return this.ctx.storage.transactionSync(() => {
      this.sql.exec('PRAGMA defer_foreign_keys = ON');
      let n = 0;
      for (const t of tables) {
        if (!t.rows.length) continue;
        const q = `INSERT OR REPLACE INTO "${t.name}" (${t.columns.map(c => '"' + c + '"').join(',')}) VALUES (${t.columns.map(() => '?').join(',')})`;
        for (const r of t.rows) { this.sql.exec(q, ...r); n++; }
      }
      return n;
    });
  }
  /** Put a snapshot back: every table is emptied, then filled with the given rows, all in one transaction (foreign keys are checked at the end). */
  replaceAll(tableNames, tables, views) {
    this.ensure();
    return this.ctx.storage.transactionSync(() => {
      this.sql.exec('PRAGMA defer_foreign_keys = ON');
      for (const v of views) this.sql.exec('DROP VIEW IF EXISTS "' + v + '"');
      for (const n of tableNames) this.sql.exec('DELETE FROM "' + n + '"');
      let rows = 0;
      for (const t of tables) {
        if (!t.rows.length) continue;
        const q = 'INSERT INTO "' + t.name + '" (' + t.columns.map(c => '"' + c + '"').join(',') + ') VALUES (' + t.columns.map(() => '?').join(',') + ')';
        for (const r of t.rows) { this.sql.exec(q, ...r); rows++; }
      }
      return rows;
    });
  }
  /** Remove everything (a failed import, or a company that left and asked for deletion). */
  async wipe() { await this.ctx.storage.deleteAll(); this.ready = false; }   // (a deleted company must not answer any more)
}

export class TenantDO extends SqlObject { migrations() { return MIGRATIONS; } }
export class ControlDO extends SqlObject { migrations() { return CONTROL_MIGRATIONS; } }
