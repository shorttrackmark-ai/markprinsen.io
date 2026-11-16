# Tenancy: how every customer company gets isolated data

Status: PROPOSAL, waiting for approval. Nothing in this document is built yet.

## Where we are

- One Worker, one D1 (`DB`), one R2 bucket (`FILES`), plus the example (`DB_DEMO`, `FILES_DEMO`).
- Since the example was merged, every request already carries its own `c.db` and `c.files`; no code uses a global database. That is the seam multi-tenancy needs.
- About 245 query call sites in `src/index.js` (plus a few in lib.js and seed.js), all in the D1 style: `db.prepare(sql).bind(...).first() / .all() / .run()` and `db.batch([...])`. About 20 tables. No table has a tenant column.
- Sign-in is by e-mail plus password (and Google); sessions are rows in the database.

## Requirements

1. A bug in a query must not be able to show company A the data of company B. Isolation should come from the structure, not from remembering a `WHERE tenant_id = ?` 245 times.
2. All data in the EU (database, files, backups).
3. Per-company backup, restore and full export (leaving must be easy).
4. Schema changes roll out to all companies without a consultant or downtime.
5. Cost per small company close to zero; no per-company infrastructure to create by hand.
6. Keep the example working and keep the existing real workspace.

## Option A: one SQLite Durable Object per tenant (EU jurisdiction)

Each company is one Durable Object (`TenantDO`) created with the `eu` jurisdiction, with its own SQLite database. The Worker finds the company, gets the stub, and all queries for that request run inside that object. A small shared "control" D1 holds only what must be known before a company is known: tenants, the e-mail → tenant lookup for sign-in, invitations, billing state, usage totals.

- Isolation: physical. A query can only ever see its own company's tables. The existing SQL stays as is (no `tenant_id` anywhere).
- Code change: a thin adapter gives the DO's SQLite the same `prepare().bind().first/all/run/batch` shape as D1, so the 245 call sites do not change. Route handlers move into (or call into) the DO so queries run next to the data; the simplest first step is the adapter calling the DO over RPC per query batch, with hot paths moved into the DO later. Latency per query over RPC is small (same data center family) but not zero; the adapter should batch.
- Migrations: the DO stores a `schema_version`. On every request the DO checks it against the code's latest and applies pending migrations before answering (milliseconds when nothing is pending). A nightly cron wakes every tenant to make sure idle ones are current too. Same `migrations/*.sql` files as today; the control D1 has its own small migration folder.
- Backups: Durable Object SQLite has point-in-time recovery (about 30 days, by bookmark). On top of that a nightly job per tenant writes a full export (JSON plus files list) to an EU R2 bucket. Restore = import that export into the tenant (also the way to move data).
- Cost: billed per rows read/written and stored GB; an idle small company costs about nothing. No per-database fee, no limit on number of tenants. Check the current price list at build time.
- Size limit: 10 GB per tenant database, far above what process data needs. Files live in R2, not in the database.
- Effort: about 1.5 to 2 weeks. Adapter, tenant resolution, control D1, migration runner, import of the current workspace as tenant 1, tests for the adapter.
- Risks: DO storage API is synchronous and slightly different from D1 (no `run().meta.last_row_id` in the same shape; the adapter must supply it); a very hot tenant is single-threaded (fine at this scale); cross-tenant reporting for us (billing, usage) needs the control D1 to be fed, not a join.

## Option B: one shared D1 with `tenant_id` on every table

- Isolation: by discipline. Every table gets `tenant_id`, every query gets a `WHERE`, every `JOIN` and `UPDATE` needs it. One forgotten condition leaks data between customers. Mitigation is a query wrapper plus tests, but it is the kind of bug that cannot be fully ruled out.
- Code change: all 245 call sites touched; every unique index becomes (tenant_id, ...); every foreign key reasoning changes. Large diff, large regression risk against the 233 smoke checks.
- Migrations: simplest; one migration for everyone, applied with `wrangler d1 migrations apply`.
- Backups: D1 Time Travel restores the whole database only. A per-company restore or export needs custom code filtering by `tenant_id`; restoring one company to yesterday while the others stay current is not possible with Time Travel.
- Size: one 10 GB database for all companies; a ceiling we would hit and then have to shard anyway.
- EU: possible with a D1 jurisdiction/location choice at creation (verify at build time; the existing database was created without it and may have to be recreated).
- Cost: lowest at the beginning; one database.
- Effort: about 2 weeks, mostly the risky mechanical rewrite and its review.

## Option C (considered, not recommended): one D1 database per tenant

Creating databases through the API works, but a Worker's bindings are static, so reaching a database that did not exist at deploy time needs the REST API (slower, token in the Worker) or a redeploy per signup. Not suitable for self-service sign-up.

## Comparison

| | A: Durable Object per tenant | B: shared D1 + tenant_id |
|---|---|---|
| Data isolation | structural | by every query |
| Change to existing SQL | none (adapter) | all 245 call sites |
| Per-company restore / export | natural | custom code |
| Per-company migration risk | isolated, lazy | all at once |
| EU data | jurisdiction `eu` on the object | D1 location, verify |
| Small-company cost | about zero | about zero |
| Scale ceiling | none per company count | 10 GB total |
| Effort | 1.5–2 weeks | about 2 weeks, riskier |

## Recommendation: Option A

Isolation by structure is the strongest sales argument for companies that put procedures, incidents and health and safety data into the tool, and it makes per-company backup, restore and export (Phase 5) cheap instead of a project. The SQL does not need rewriting, which protects everything that works today.

## What Phase 1 would build (after approval)

1. `control` D1 (EU): `tenants (id, slug, name, plan, status, created_at, region)`, `identities (email, tenant_id)` for sign-in routing, later `invites`, `billing`, `usage`.
2. `TenantDO` (EU jurisdiction) with the D1-shaped adapter and the lazy migration runner.
3. Tenant resolution: the session cookie carries the tenant id (signed); sign-in looks the e-mail up in `identities`; the example stays a fixed tenant bound to the existing example database.
4. Sign-up: company name, name, e-mail, password creates the tenant, its first administrator and optionally a template pack, then signs the person in.
5. Import of the current real workspace as tenant 1 (copy, never move; the old D1 stays untouched until verified).
6. EU storage: R2 buckets created with the EU jurisdiction (`ordovia-files-eu`); files keyed by tenant id; existing files copied.
7. Tests: adapter contract tests (same results as D1 for the query shapes in use), a two-tenant isolation test in the smoke suite (A can never read, list or download B's rows or files), signup, migration runner.

## Decisions I need from you

1. Approve Option A (or choose B).
2. The existing real workspace: do you want it imported as tenant 1, or is it test data that can be dropped? (The example is unaffected either way.)
3. Region name: "EU jurisdiction" guarantees data stays in the EU; it does not let us pick a country. Is that enough?
