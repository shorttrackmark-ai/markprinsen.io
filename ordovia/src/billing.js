// Stripe, without the SDK: Checkout for subscribing, the Customer Portal for managing, a signed webhook for the truth.
// Billing is OFF (everything stays open, no banners) until STRIPE_SECRET_KEY exists. Keys are Worker secrets, never code.
import { HttpError, all, first, run, now } from './lib.js';
import { billingAccess, tierOf, TIERS, TRIAL_DAYS } from './plans.js';
import { controlDB, tenantDB } from './tenancy.js';

export const billingOn = (env) => !!env.STRIPE_SECRET_KEY;
const api = (env) => (env.STRIPE_API_BASE || 'https://api.stripe.com') + '/v1';

/** Stripe wants form encoding with brackets: {a: {b: 1}, c: [x]} -> a[b]=1&c[0]=x */
export function formEncode(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? out.push(formEncode(x, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`)));
    else if (typeof v === 'object') out.push(formEncode(v, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.filter(Boolean).join('&');
}
export async function stripe(env, method, path, params) {
  const r = await fetch(api(env) + path, { method, headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: params ? formEncode(params) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { console.warn('stripe error', path, r.status, JSON.stringify(data.error || data).slice(0, 300)); throw new HttpError(502, 'The payment provider did not accept that. Please try again in a moment.'); }
  return data;
}

/** Stripe-Signature: t=timestamp,v1=hmac(secret, `${t}.${body}`). Constant-time compare, 5 minute tolerance. */
export async function verifySignature(body, header, secret, nowMs = Date.now()) {
  const parts = Object.fromEntries(String(header || '').split(',').map(p => p.split('=')).filter(p => p.length === 2));
  const t = Number(parts.t); if (!t || Math.abs(nowMs / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const given = String(parts.v1 || ''); if (given.length !== mac.length) return false;
  let diff = 0; for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
export const signatureFor = async (body, secret, t = Math.floor(Date.now() / 1000)) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `t=${t},v1=${[...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map(b => b.toString(16).padStart(2, '0')).join('')}`;
};

const prices = (env) => { try { return JSON.parse(env.STRIPE_PRICES || '{}'); } catch { return {}; } };
const tierOfPrice = (env, priceId) => Object.entries(prices(env)).find(([, v]) => v === priceId)?.[0] || null;
const iso = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ') : null);

/** Write the billing state into the company's own settings (where the app reads it without asking anyone else) and into the register. */
export async function saveBilling(env, tenantId, patch) {
  const db = tenantDB(env, tenantId);
  const keys = Object.keys(patch).filter(k => patch[k] !== undefined);
  await db.batch(keys.map(k => db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, patch[k] == null ? '' : String(patch[k]))));
  const ctl = await controlDB(env);
  await run(ctl, 'UPDATE tenants SET billing_status = ?, tier = ?, billing_until = ? WHERE id = ?',
    patch.billing_status ?? (await first(ctl, 'SELECT billing_status FROM tenants WHERE id = ?', tenantId))?.billing_status ?? null,
    patch.billing_tier ?? (await first(ctl, 'SELECT tier FROM tenants WHERE id = ?', tenantId))?.tier ?? null, patch.billing_until ?? null, tenantId);
}

/** One event from Stripe. Idempotent: an event id is only handled once. */
export async function handleEvent(env, ev) {
  const ctl = await controlDB(env);
  if (await first(ctl, 'SELECT id FROM stripe_events WHERE id = ?', ev.id)) return { duplicate: true };
  const obj = ev.data && ev.data.object ? ev.data.object : {};
  const tenantOf = async () => obj.metadata?.tenant_id || obj.client_reference_id
    || (obj.customer ? (await first(ctl, 'SELECT id FROM tenants WHERE stripe_customer = ?', obj.customer))?.id : null);
  let handled = false;
  if (ev.type === 'checkout.session.completed') {
    const tid = obj.client_reference_id;
    if (tid && obj.customer) { await run(ctl, 'UPDATE tenants SET stripe_customer = ?, stripe_sub = ? WHERE id = ?', obj.customer, obj.subscription || null, tid); handled = true; }
  } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
    const tid = await tenantOf();
    if (tid) {
      if (obj.customer) await run(ctl, 'UPDATE tenants SET stripe_customer = ?, stripe_sub = ? WHERE id = ?', obj.customer, obj.id, tid);
      const deleted = ev.type.endsWith('deleted') || ['canceled', 'incomplete_expired'].includes(obj.status);
      const status = deleted ? 'canceled' : ['past_due', 'unpaid'].includes(obj.status) ? 'past_due' : ['active', 'trialing'].includes(obj.status) ? 'active' : null;
      if (status) {
        const priceId = obj.items?.data?.[0]?.price?.id;
        const prev = await tenantDB(env, tid).prepare("SELECT value FROM settings WHERE key = 'billing_status'").first();
        await saveBilling(env, tid, {
          billing_status: status,
          billing_tier: obj.metadata?.tier || tierOfPrice(env, priceId) || undefined,
          billing_until: deleted ? now() : iso(obj.current_period_end),
          billing_cancel_at_end: obj.cancel_at_period_end ? '1' : '0',
          billing_past_due_since: status === 'past_due' ? (prev && prev.value === 'past_due' ? undefined : now()) : '',
        });
        handled = true;
      }
    }
  }
  await run(ctl, 'INSERT INTO stripe_events(id, type, at, handled) VALUES (?,?,?,?)', ev.id, ev.type, now(), handled ? 1 : 0);
  return { handled };
}

/** What the app shows and enforces. Without Stripe keys everything stays open. */
export async function billingState(c) {
  if (!billingOn(c.env) || !c.tenantId) return { access: 'full', status: 'off', banner: null, daysLeft: null, tier: null, until: null, on: false };
  const s = await c.settings();
  if (!s.billing_trial_ends && !s.billing_status) {   // a company from before billing existed gets its full trial from today
    const end = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    await saveBilling(c.env, c.tenantId, { billing_status: 'trial', billing_trial_ends: end });
    s.billing_status = 'trial'; s.billing_trial_ends = end;
  }
  return { ...billingAccess(s), on: true, trialEnds: s.billing_trial_ends || null };
}
export async function assertWritable(c) {
  const b = await billingState(c);
  if (b.access === 'readonly') throw new HttpError(402, 'This workspace is read-only because the trial or subscription has ended. You can still look at everything and export it; an administrator can choose a plan under Plan & billing.', { readOnly: true });
}

/** How many people the current plan allows (none while in trial: everything is open then). */
export async function seatLimit(c) {
  const b = await billingState(c);
  if (!b.on || b.status !== 'active') return null;
  const t = tierOf(b.tier); return t ? t.maxPeople : null;
}

export async function billingPage(c) {
  const b = await billingState(c), ctl = await controlDB(c.env);
  const people = (await first(c.db, 'SELECT COUNT(*) AS n FROM persons WHERE active = 1')).n;
  const t = await first(ctl, 'SELECT stripe_customer FROM tenants WHERE id = ?', c.tenantId);
  const usage = await usageNow(c.db);
  const pr = prices(c.env);
  return { ...b, people, usage, canManage: !!(t && t.stripe_customer), tiers: TIERS.map(x => ({ ...x, available: !!pr[x.id] })) };
}

// ---------------------------------------------------------------- usage (kept per company and month, for plans that may one day include a usage part)
export async function usageNow(db) {
  const month = now().slice(0, 7);
  return {
    month,
    active_users: (await first(db, 'SELECT COUNT(*) AS n FROM persons WHERE active = 1')).n,
    runs: (await first(db, 'SELECT COUNT(*) AS n FROM instances WHERE created_at >= ?', month + '-01 00:00:00')).n,
    storage_bytes: (await first(db, 'SELECT COALESCE(SUM(size), 0) AS n FROM files')).n,
  };
}
export async function recordUsage(env, tenantId, db) {
  const u = await usageNow(db);
  await run(await controlDB(env), `INSERT INTO usage(tenant_id, month, active_users, runs, storage_bytes, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(tenant_id, month) DO UPDATE SET active_users = excluded.active_users, runs = excluded.runs, storage_bytes = excluded.storage_bytes, updated_at = excluded.updated_at`,
    tenantId, u.month, u.active_users, u.runs, u.storage_bytes, now());
}

// ---------------------------------------------------------------- Checkout and Portal
export async function startCheckout(c, tierId) {
  const t = tierOf(tierId);
  if (!t || t.contact) throw new HttpError(400, 'Choose one of the plans, or get in touch for Enterprise.');
  const priceId = prices(c.env)[t.id];
  if (!priceId) throw new HttpError(503, 'This plan cannot be ordered online yet.');
  const people = (await first(c.db, 'SELECT COUNT(*) AS n FROM persons WHERE active = 1')).n;
  if (t.maxPeople != null && people > t.maxPeople) throw new HttpError(400, `You have ${people} people; the ${t.name} plan includes up to ${t.maxPeople}. Choose a larger plan.`);
  const ctl = await controlDB(c.env), row = await first(ctl, 'SELECT stripe_customer FROM tenants WHERE id = ?', c.tenantId);
  const s = await c.settings(), trialEnd = Math.floor(Date.parse(String(s.billing_trial_ends || '').replace(' ', 'T') + 'Z') / 1000);
  const keepTrial = s.billing_status === 'trial' && trialEnd && trialEnd * 1000 - Date.now() > 50 * 3600000;   // (Stripe needs a trial to end at least 48 hours ahead)
  const origin = c.url.origin;
  const sess = await stripe(c.env, 'POST', '/checkout/sessions', {
    mode: 'subscription', client_reference_id: c.tenantId, customer: row && row.stripe_customer ? row.stripe_customer : undefined,
    customer_email: row && row.stripe_customer ? undefined : c.user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { tenant_id: c.tenantId, tier: t.id }, trial_end: keepTrial ? trialEnd : undefined },
    metadata: { tenant_id: c.tenantId, tier: t.id },
    automatic_tax: { enabled: true }, tax_id_collection: { enabled: true }, billing_address_collection: 'required',
    customer_update: row && row.stripe_customer ? { address: 'auto', name: 'auto' } : undefined,
    allow_promotion_codes: true,
    success_url: origin + '/app/#/admin/billing?done=1', cancel_url: origin + '/app/#/admin/billing',
  });
  return { url: sess.url };
}
export async function startPortal(c) {
  const row = await first(await controlDB(c.env), 'SELECT stripe_customer FROM tenants WHERE id = ?', c.tenantId);
  if (!row || !row.stripe_customer) throw new HttpError(400, 'There is no subscription to manage yet.');
  const p = await stripe(c.env, 'POST', '/billing_portal/sessions', { customer: row.stripe_customer, return_url: c.url.origin + '/app/#/admin/billing' });
  return { url: p.url };
}
void all;
