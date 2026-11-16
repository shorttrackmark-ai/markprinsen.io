// The rules behind read-only mode, the plans, and the Stripe plumbing that can be checked without Stripe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingAccess, tierFor, tierOf, TIERS, GRACE_DAYS } from '../src/plans.js';
import { formEncode, verifySignature, signatureFor } from '../src/billing.js';

const DAY = 86400000;
const at = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const NOW = Date.parse('2026-11-16T12:00:00Z');

test('a trial is open until it ends, then read-only', () => {
  const s = (days) => ({ billing_status: 'trial', billing_trial_ends: at(NOW + days * DAY) });
  assert.deepEqual([billingAccess(s(10), NOW).access, billingAccess(s(10), NOW).banner], ['full', 'trial']);
  assert.equal(billingAccess(s(3), NOW).banner, 'trial_soon');
  assert.equal(billingAccess(s(3), NOW).daysLeft, 3);
  const over = billingAccess(s(-1), NOW);
  assert.deepEqual([over.access, over.banner], ['readonly', 'trial_ended']);
});
test('an active subscription is open; one that will end says so', () => {
  assert.equal(billingAccess({ billing_status: 'active', billing_tier: 'team' }, NOW).access, 'full');
  assert.equal(billingAccess({ billing_status: 'active' }, NOW).banner, null);
  const end = billingAccess({ billing_status: 'active', billing_cancel_at_end: '1', billing_until: at(NOW + 5 * DAY) }, NOW);
  assert.deepEqual([end.access, end.banner, end.daysLeft], ['full', 'ending', 5]);
});
test('a failed payment gets a grace period, then read-only', () => {
  const s = (ago) => ({ billing_status: 'past_due', billing_past_due_since: at(NOW - ago * DAY) });
  assert.deepEqual([billingAccess(s(1), NOW).access, billingAccess(s(1), NOW).banner], ['full', 'past_due']);
  assert.equal(billingAccess(s(GRACE_DAYS + 1), NOW).access, 'readonly');
});
test('a cancelled subscription works until the paid period ends', () => {
  assert.equal(billingAccess({ billing_status: 'canceled', billing_until: at(NOW + 2 * DAY) }, NOW).access, 'full');
  assert.equal(billingAccess({ billing_status: 'canceled', billing_until: at(NOW - 1000) }, NOW).access, 'readonly');
  assert.equal(billingAccess({ billing_status: 'canceled' }, NOW).access, 'readonly');
});
test('plans are by number of people', () => {
  assert.equal(tierFor(1).id, 'small'); assert.equal(tierFor(10).id, 'small'); assert.equal(tierFor(11).id, 'team');
  assert.equal(tierFor(250).id, 'business'); assert.equal(tierFor(251).id, 'enterprise');
  assert.equal(tierOf('nope'), null); assert.ok(TIERS.every(t => t.id && t.name));
});
test('Stripe form encoding nests with brackets', () => {
  const q = decodeURIComponent(formEncode({ mode: 'subscription', line_items: [{ price: 'p1', quantity: 1 }], automatic_tax: { enabled: true }, skip: undefined, none: null }));
  assert.equal(q, 'mode=subscription&line_items[0][price]=p1&line_items[0][quantity]=1&automatic_tax[enabled]=true');
});
test('webhook signatures: right, wrong, old', async () => {
  const body = '{"id":"evt_1"}', secret = 'whsec_test';
  const good = await signatureFor(body, secret);
  assert.equal(await verifySignature(body, good, secret), true);
  assert.equal(await verifySignature(body + ' ', good, secret), false, 'changed body');
  assert.equal(await verifySignature(body, good, 'other'), false, 'other secret');
  assert.equal(await verifySignature(body, '', secret), false, 'no header');
  assert.equal(await verifySignature(body, await signatureFor(body, secret, Math.floor(Date.now() / 1000) - 3600), secret), false, 'an hour old');
});
