// Plans by company size (everybody in the company can be a user) and the rule that turns a company's billing state into "may it change things?".
// Pure: no database, no network. Prices here are PLACEHOLDERS until they are set; the Stripe price ids come from the STRIPE_PRICES variable.
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;   // a failed payment keeps working this long while Stripe retries
export const TIERS = [
  { id: 'small', name: 'Small', maxPeople: 10, priceEur: 49, placeholder: true },
  { id: 'team', name: 'Team', maxPeople: 50, priceEur: 149, placeholder: true },
  { id: 'business', name: 'Business', maxPeople: 250, priceEur: 349, placeholder: true },
  { id: 'enterprise', name: 'Enterprise', maxPeople: null, priceEur: null, placeholder: true, contact: true },
];
export const tierOf = (id) => TIERS.find(t => t.id === id) || null;
/** The smallest plan that fits this many people. */
export const tierFor = (people) => TIERS.find(t => t.maxPeople == null || people <= t.maxPeople);

const DAY = 86400000;
const ms = (v) => { const t = Date.parse(String(v || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v || '')) ? '' : 'Z')); return Number.isFinite(t) ? t : null; };

/** @param s the company's settings (billing_* keys), @param nowMs
 *  @returns {{access: 'full'|'readonly', status: string, banner: string|null, daysLeft: number|null, tier: string|null, until: string|null}} */
export function billingAccess(s, nowMs = Date.now()) {
  const status = s.billing_status || 'trial', tier = s.billing_tier || null, until = s.billing_until || null;
  const out = (access, banner, daysLeft = null) => ({ access, status, banner, daysLeft, tier, until });
  if (status === 'active') return s.billing_cancel_at_end === '1' ? out('full', 'ending', Math.ceil(((ms(until) || nowMs) - nowMs) / DAY)) : out('full', null);
  if (status === 'past_due') {
    const since = ms(s.billing_past_due_since) || nowMs, left = Math.ceil((since + GRACE_DAYS * DAY - nowMs) / DAY);
    return left > 0 ? out('full', 'past_due', left) : out('readonly', 'lapsed');
  }
  if (status === 'canceled') {
    const end = ms(until);
    return end && end > nowMs ? out('full', 'ending', Math.ceil((end - nowMs) / DAY)) : out('readonly', 'lapsed');
  }
  const end = ms(s.billing_trial_ends);
  if (end == null) return out('full', null);
  const left = Math.ceil((end - nowMs) / DAY);
  return left > 0 ? out('full', left <= 7 ? 'trial_soon' : 'trial', left) : out('readonly', 'trial_ended');
}
