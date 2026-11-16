// Billing against a MOCK Stripe. Start a local server like this (mock listens on MOCK_PORT, default 9411):
//   wrangler dev --var DATA_REGION:local --var STRIPE_SECRET_KEY:sk_test_x --var STRIPE_WEBHOOK_SECRET:whsec_test
//        --var STRIPE_API_BASE:http://127.0.0.1:9411 --var 'STRIPE_PRICES:{"small":"price_s","team":"price_t"}'
// then:  BASE=http://127.0.0.1:8787 node scripts/smoke-billing.mjs
import http from 'node:http';
import { signatureFor } from '../src/billing.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.I_KNOW !== '1') { console.error('Refusing to run against', BASE); process.exit(2); }
const MOCK_PORT = Number(process.env.MOCK_PORT || 9411), SECRET = 'whsec_test';
let n = 0, failed = 0;
const ok = (cond, msg, extra) => { n++; if (!cond) { failed++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } else console.log('  ✓', msg); };

const seen = [];   // what our Worker sent to "Stripe"
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
    seen.push({ path: req.url, auth: req.headers.authorization, params: Object.fromEntries(new URLSearchParams(body)) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.includes('portal') ? { url: 'https://billing.stripe.test/portal/abc' } : { url: 'https://checkout.stripe.test/c/abc' }));
  });
}).listen(MOCK_PORT);

const browser = () => {
  const jar = new Map();
  const call = async (method, path, body, headers = {}, rawBody) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-ordovia': '1', ...(cookie ? { cookie } : {}), ...headers }, body: rawBody ?? (body ? JSON.stringify(body) : undefined) });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v) jar.delete(k); else jar.set(k, v); }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  return { jar, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), call };
};
let evN = 0;
const webhook = async (type, object, { secret = SECRET, id } = {}) => {
  const body = JSON.stringify({ id: id || 'evt_' + Date.now() + '_' + (++evN), type, data: { object } });
  const sig = secret ? await signatureFor(body, secret) : '';
  return browser().call('POST', '/api/stripe/webhook', null, { 'stripe-signature': sig, 'x-ordovia': '' }, body);
};

const A = browser(), B = browser(); let r;
const run = Date.now().toString(36);

console.log('trial');
r = await A.post('/api/setup', { company: 'Billing BV', name: 'Admin', email: `admin.${run}@bill.test`, password: 'adminpass1' }); ok(r.status === 200, 'a company signs up');
await B.post('/api/setup', { company: 'Bystander BV', name: 'Other', email: `other.${run}@bill.test`, password: 'otherpass1' });
const tid = A.jar.get('ordovia_tenant');
r = await A.get('/api/session'); let bill = r.data.settings.billing;
ok(bill && bill.status === 'trial' && bill.access === 'full' && bill.daysLeft >= 13 && bill.daysLeft <= 14, 'a new company is on a 14-day trial', bill);
r = await A.get('/api/billing'); ok(r.status === 200 && r.data.on && r.data.people === 1 && r.data.tiers.find(t => t.id === 'small').available && !r.data.tiers.find(t => t.id === 'business').available, 'the plan page lists plans; only those with a Stripe price are orderable', r.data.tiers && r.data.tiers.map(t => [t.id, t.available]));
ok(r.data.usage.active_users === 1 && r.data.usage.runs === 0, 'usage is shown');
const C = browser(); r = await C.get('/api/billing'); ok(r.status === 401, 'plan & billing needs an administrator');

console.log('checkout and portal');
r = await A.post('/api/billing/checkout', { tier: 'small' }); ok(r.status === 200 && /checkout\.stripe\.test/.test(r.data.url), 'checkout returns the Stripe page', r.data);
let sent = seen.find(s => s.path === '/v1/checkout/sessions');
ok(sent && sent.auth === 'Bearer sk_test_x', 'the secret key stays on the server side', sent && sent.auth);
ok(sent.params.mode === 'subscription' && sent.params['line_items[0][price]'] === 'price_s' && sent.params.client_reference_id === tid && sent.params['subscription_data[metadata][tier]'] === 'small' && sent.params['automatic_tax[enabled]'] === 'true' && sent.params['tax_id_collection[enabled]'] === 'true', 'it asks for a subscription with tax, linked to this company', sent.params);
ok(Number(sent.params['subscription_data[trial_end]']) > Date.now() / 1000 + 12 * 86400, 'and keeps the rest of the free trial');
ok(sent.params.customer_email === `admin.${run}@bill.test`, 'the customer is prefilled');
r = await A.post('/api/billing/checkout', { tier: 'business' }); ok(r.status === 503, 'a plan without a price cannot be ordered');
r = await A.post('/api/billing/checkout', { tier: 'enterprise' }); ok(r.status === 400, 'Enterprise is by contact');
r = await A.post('/api/billing/checkout', { tier: 'nonsense' }); ok(r.status === 400, 'nonsense is refused');
r = await A.post('/api/billing/portal', {}); ok(r.status === 400, 'no portal before there is a customer');

console.log('what Stripe tells us');
r = await webhook('checkout.session.completed', { client_reference_id: tid, customer: 'cus_1', subscription: 'sub_1' }, { secret: null }); ok(r.status === 400, 'an unsigned call is refused');
r = await webhook('checkout.session.completed', { client_reference_id: tid, customer: 'cus_1' }, { secret: 'wrong' }); ok(r.status === 400, 'a wrongly signed call is refused');
r = await webhook('checkout.session.completed', { client_reference_id: tid, customer: 'cus_1', subscription: 'sub_1' }); ok(r.status === 200 && r.data.handled, 'checkout completed is accepted');
r = await A.get('/api/billing'); ok(r.data.canManage === true, 'the company is linked to its Stripe customer');
r = await A.post('/api/billing/portal', {}); ok(r.status === 200 && /portal/.test(r.data.url), 'the customer portal opens');
const sub = (status, extra = {}) => ({ id: 'sub_1', customer: 'cus_1', status, metadata: { tenant_id: tid, tier: 'small' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, items: { data: [{ price: { id: 'price_s' } }] }, ...extra });
r = await webhook('customer.subscription.created', sub('active'), { id: 'evt_dup' }); ok(r.status === 200 && r.data.handled, 'a subscription starts');
r = await webhook('customer.subscription.created', sub('active'), { id: 'evt_dup' }); ok(r.data.duplicate === true, 'the same event twice is handled once');
bill = (await A.get('/api/session')).data.settings.billing; ok(bill.status === 'active' && bill.access === 'full' && bill.banner === null, 'the company is on an active plan', bill);
r = await A.get('/api/billing'); ok(r.data.tier === 'small', 'with the right plan');
r = await webhook('customer.subscription.updated', { id: 'sub_x', customer: 'cus_unknown', status: 'active', metadata: {} }); ok(r.status === 200 && !r.data.handled, 'an event for a customer we do not know is ignored');

console.log('a plan includes a number of people');
for (let i = 0; i < 9; i++) { r = await A.post('/api/admin/people', { name: 'P' + i, email: `p${i}.${run}@bill.test`, password: 'password123', is_admin: false, active: true }); if (r.status !== 200) break; }
r = await A.post('/api/admin/people', { name: 'One too many', email: `many.${run}@bill.test`, password: 'password123', is_admin: false, active: true }); ok(r.status === 402 && /up to 10 people/.test(r.data.error), 'the 11th person needs a larger plan', r);
r = await A.post('/api/billing/checkout', { tier: 'small' }); ok(r.status === 200, 'ordering the same plan is fine');

console.log('a payment fails');
r = await webhook('customer.subscription.updated', sub('past_due')); ok(r.data.handled, 'past due');
bill = (await A.get('/api/session')).data.settings.billing; ok(bill.status === 'past_due' && bill.access === 'full' && bill.banner === 'past_due' && bill.daysLeft >= 6, 'work continues during the grace period, with a warning', bill);
r = await A.post('/api/admin/areas', { name: 'Still works' }); ok(r.status === 200, 'changes are still possible');

console.log('the subscription ends: read-only');
r = await webhook('customer.subscription.deleted', sub('canceled')); ok(r.data.handled, 'cancelled');
bill = (await A.get('/api/session')).data.settings.billing; ok(bill.status === 'canceled' && bill.access === 'readonly' && bill.banner === 'lapsed', 'the workspace is read-only', bill);
r = await A.post('/api/admin/areas', { name: 'Not allowed' }); ok(r.status === 402 && r.data.readOnly === true && /read-only/.test(r.data.error), 'changes are refused with a clear message', r.data);
r = await A.get('/api/meta'); ok(r.status === 200, 'but everything can still be read');
r = await A.get('/api/admin/export'); ok(r.status === 200 && r.data.tables && r.data.tables.areas.length >= 1, 'and exported');
r = await A.post('/api/billing/checkout', { tier: 'team' }); ok(r.status === 200, 'choosing a plan is still possible');
r = await A.post('/api/me/password', { current: 'adminpass1', password: 'adminpass2' }); ok(r.status === 200, 'so is changing your own password');
r = await B.post('/api/admin/areas', { name: 'Bystander works' }); ok(r.status === 200, 'another company is not affected');
r = await A.post('/api/logout', {}); ok(r.status === 200, 'signing out works');
r = await browser().post('/api/login', { email: `admin.${run}@bill.test`, password: 'adminpass2' }); ok(r.status === 200, 'and signing in');

console.log('coming back');
r = await webhook('customer.subscription.created', sub('active', { id: 'sub_2' })); ok(r.data.handled, 'a new subscription');
const A2 = browser(); await A2.post('/api/login', { email: `admin.${run}@bill.test`, password: 'adminpass2' });
r = await A2.post('/api/admin/areas', { name: 'Back in business' }); ok(r.status === 200, 'the workspace is writable again');
r = await webhook('customer.subscription.updated', sub('active', { id: 'sub_2', cancel_at_period_end: true })); ok(r.data.handled, 'cancel at period end');
bill = (await A2.get('/api/session')).data.settings.billing; ok(bill.access === 'full' && bill.banner === 'ending', 'it works until the paid period ends, and says so', bill);

mock.close();
console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(failed ? 1 : 0);
