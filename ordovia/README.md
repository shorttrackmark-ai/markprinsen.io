# Ordovia

*Latin* ordo *(order) +* via *(way): the way work flows through a company.*

Ordovia brings the process handbook, the forms, the workflow and the reporting together on **one SQL database**.
Like a process-management/handbook tool, but the processes actually *run*: every step is linked to data,
automated where possible, and checked by logic rules.

Runs on **Cloudflare**: a Worker (API + process engine) with a **D1** (SQLite) database, serving the static app from `public/`.

## The four principles

| | How Ordovia does it |
|---|---|
| **Everything linked** | *Link-to-record* fields (Purchase → Supplier), *Person* fields, data from earlier steps (`leave_request.days`), linked data in formulas (`supplier.country`, `budget_holder.department`), "linked from" overview on each record, and every form as a SQL view (`form_<name>`) you can JOIN in dashboards. |
| **Automated** | Flow steps that need no person: *Calculate* (set variables), *Create/update record* in any form, *Webhook* to Teams/Slack/ERP. Automatic routing by tags (*Manager + same Department as the initiator*), due dates with an hourly overdue job, and a notification webhook for new/overdue tasks. |
| **Logic checks** | One formula language everywhere: field rules, show/hide, defaults, calculations, form-level checks (`supplier.approved`, `days <= 25`), decision conditions. The **same code runs in the browser and on the server**, so rules and calculations can't be bypassed. Flows are linted (unreachable steps, missing “otherwise” paths, broken formulas) before they can run. |
| **Customised** | Your own forms, flows, tags (any categories), dashboards (visual builder or SQL), access per form and dashboard, company name and brand colour. |

Plus the **Process handbook**: purpose, owner, scope, records and step-by-step work instructions per process — generated from the live flow, printable, and shown inside each task.

## Run locally

```bash
cd ordovia
npm install
npm run dev          # applies the D1 migration locally and starts http://localhost:8787
npm test             # unit tests for formulas, form checks and the engine
```

Open <http://localhost:8787>, create the workspace (tick *demo data* to get a sample company), and sign in.
Demo colleagues use password `demo1234` (anna@, bram@, carla@, daan@, eva@ `example.com`).

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create ordovia          # copy the database_id into wrangler.jsonc
npm run deploy                          # migrates the remote D1 and deploys the Worker
```

Then open the `*.workers.dev` URL (or add your own domain in the Cloudflare dashboard) and create the workspace.
The **Workers Paid plan (~$5/month)** is recommended: password hashing and the process engine need more than the free plan's 10 ms CPU per request.

## Architecture

```
public/            static app (no build step)
  js/expr.js       formula language – shared with the Worker
  js/logic.js      form calculations, checks, flow linting, dashboard SQL – shared with the Worker
  js/ui.js         API client, helpers, router
  js/forms.js      form renderer + form builder
  js/flows.js      flowchart designer
  js/dashboards.js charts + dashboard editor
  js/app.js        pages
src/
  index.js         API routes, auth, permissions, cron job
  engine.js        process engine (pure; writes go out as one atomic D1 batch)
  lib.js           D1 helpers, PBKDF2 passwords, sessions, tag directory
  seed.js          demo company
migrations/        D1 schema
test/              node --test
```

**Security model:** PBKDF2 password hashes; HttpOnly/Secure/SameSite session cookies; a custom header on every write (CSRF);
all permissions checked in the Worker (admin-only builders and SQL, per-form/dashboard tag access, task assignment);
dashboards only run queries saved by an admin, read-only; password hashes and sessions are never returned by any query.
Running processes keep a snapshot of their flow, so editing a flow never breaks work in progress.

## Roadmap

1. **SSO** via Cloudflare Access / Microsoft Entra / Google, and invitations by e-mail.
2. **Multi-tenant SaaS**: one D1 database per customer, sign-up flow, billing.
3. **Documents**: attachments on forms and handbook pages (Cloudflare R2), document approval and review cycles (ISO).
4. **Engine**: parallel branches, sub-processes, timers (“wait 3 days”), escalation rules.
5. **Integrations**: inbound webhooks to start processes, REST API with tokens, Excel import.
6. **Audit**: field-level change history and e-signatures for approvals.
