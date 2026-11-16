// The control register: the only database that knows about all companies. It holds what must be known BEFORE a company is known:
// which companies exist and which e-mail address signs in to which company. Company data never lives here.
export const CONTROL_MIGRATIONS = [
  { name: 'c0001_tenants.sql', sql: `
    CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, legacy INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE identities (email TEXT PRIMARY KEY COLLATE NOCASE, tenant_id TEXT NOT NULL REFERENCES tenants(id));
    CREATE INDEX identities_tenant ON identities(tenant_id);
    CREATE TABLE control_settings (key TEXT PRIMARY KEY, value TEXT);` },
  { name: 'c0002_attempts.sql', sql: `
    CREATE TABLE attempts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, since TEXT NOT NULL);
    CREATE TABLE outbox (id INTEGER PRIMARY KEY, at TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL);` },
  { name: 'c0003_billing.sql', sql: `
    ALTER TABLE tenants ADD COLUMN stripe_customer TEXT;
    ALTER TABLE tenants ADD COLUMN stripe_sub TEXT;
    ALTER TABLE tenants ADD COLUMN tier TEXT;
    ALTER TABLE tenants ADD COLUMN billing_status TEXT;
    ALTER TABLE tenants ADD COLUMN billing_until TEXT;
    CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, at TEXT NOT NULL, handled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE usage (tenant_id TEXT NOT NULL, month TEXT NOT NULL, active_users INTEGER NOT NULL, runs INTEGER NOT NULL, storage_bytes INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant_id, month));` },
  { name: 'c0004_errors.sql', sql: `
    CREATE TABLE errors (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, place TEXT, message TEXT, tenant_id TEXT);
    CREATE INDEX errors_at ON errors(at);` },
  { name: 'c0005_microsoft.sql', sql: `
    CREATE TABLE ms_identities (tid TEXT NOT NULL, oid TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id), PRIMARY KEY (tid, oid));
    CREATE INDEX ms_identities_tenant ON ms_identities(tenant_id);
    CREATE TABLE oauth_states (state TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, mode TEXT NOT NULL, tenant_id TEXT, person_id INTEGER, extra TEXT, created_at TEXT NOT NULL);` },
];

export const TENANT_ID = /^[a-f0-9]{12}$/;
export const newTenantId = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
/** Addresses on the reserved example.com domain never reach a real mailbox; they belong to the example people inside a company. */
export const isExampleAddress = (email) => /@example\.(com|org|net)$/i.test(String(email || '').trim());
