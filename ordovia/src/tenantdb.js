// A D1-shaped database over one Durable Object (one company = one SQLite database).
// The application code keeps writing  db.prepare(sql).bind(...).first() / .all() / .run() / .raw()  and  db.batch([...]);
// each call (or batch) becomes ONE round trip to the company's own object, where a batch runs as one transaction.

/** Runs statements against a SQLite connection shaped like the Durable Object's  sql.exec(query, ...params) → cursor.
 *  Pure so that tests can run it on node:sqlite. Returns one result per statement. */
export function runStatements(exec, specs) {
  return specs.map((s) => {
    const cur = exec(s.sql, ...(s.params || []));
    if (s.mode === 'raw') {
      const rows = [...cur.raw()];
      return { rows: s.columnNames ? [cur.columnNames, ...rows] : rows };
    }
    const results = cur.toArray();   // (a statement only really runs once its cursor is read)
    if (s.mode === 'run' || s.mode === 'batch') {
      const m = exec('SELECT last_insert_rowid() AS id, changes() AS n').toArray()[0];
      return { results: s.mode === 'batch' ? results : undefined, meta: { last_row_id: m.id, changes: m.n } };
    }
    return { results, meta: { changes: 0 } };
  });
}

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params.map(p => (p === undefined ? null : p))); }
  spec(mode, extra = {}) { return { sql: this.sql, params: this.params, mode, ...extra }; }
  async all() { const [r] = await this.db.send([this.spec('all')]); return { results: r.results, meta: r.meta, success: true }; }
  async first(col) { const [r] = await this.db.send([this.spec('all')]); const row = r.results[0]; return row === undefined ? null : (col ? row[col] : row); }
  async run() { const [r] = await this.db.send([this.spec('run')]); return { meta: r.meta, success: true }; }
  async raw(opts = {}) { const [r] = await this.db.send([this.spec('raw', { columnNames: !!opts.columnNames })]); return r.rows; }
}

export class TenantDB {
  /** @param stub a Durable Object stub (or anything with  run(specs) → results) */
  constructor(stub) { this.stub = stub; }
  prepare(sql) { return new Statement(this, sql); }
  send(specs) { return this.stub.run(specs); }
  async batch(stmts) {
    const out = await this.send(stmts.map(s => s.spec('batch')));
    return out.map(r => ({ results: r.results || [], meta: r.meta || {}, success: true }));
  }
}

/** A company's files live in one shared (EU) bucket under their own prefix, so one company can never name another's key. */
export class TenantFiles {
  constructor(bucket, id) { this.bucket = bucket; this.prefix = 't' + id + '/'; }
  put(key, value, opts) { return this.bucket.put(this.prefix + key, value, opts); }
  get(key) { return this.bucket.get(this.prefix + key); }
  delete(keys) { return this.bucket.delete(Array.isArray(keys) ? keys.map(k => this.prefix + k) : this.prefix + keys); }
  async list(opts = {}) {
    const l = await this.bucket.list({ ...opts, prefix: this.prefix });
    return { ...l, objects: l.objects.map(o => ({ ...o, key: o.key.slice(this.prefix.length) })) };
  }
}
