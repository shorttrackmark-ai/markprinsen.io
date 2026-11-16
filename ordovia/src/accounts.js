// Accounts: single-use links (invite, reset, e-mail change), the words of the mails, and rate limiting of sign-in.
import { HttpError, first, run, now, sha256 } from './lib.js';
import { sendMail } from './mail.js';

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
export const TOKEN_HOURS = { invite: 7 * 24, reset: 1, email: 24 };
const at = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** A link token: the company id first (so the link finds its company), then 40 random hex characters. Only its hash is stored. */
export async function issueToken(c, personId, kind, newEmail = null) {
  const raw = c.tenantId + hex(20);
  await run(c.db, 'INSERT INTO account_tokens(token_hash, person_id, kind, new_email, expires_at, created_at) VALUES (?,?,?,?,?,?)',
    await sha256(raw), personId, kind, newEmail, at(Date.now() + TOKEN_HOURS[kind] * 3600000), now());
  return raw;
}
/** The open (unused, unexpired) link, with the person it is for. */
export async function openToken(c, raw) {
  if (!/^[a-f0-9]{52}$/.test(String(raw || ''))) throw new HttpError(404, 'This link does not work (any more).');
  const row = await first(c.db, `SELECT t.token_hash, t.kind, t.new_email, p.id AS person_id, p.name, p.email, p.active FROM account_tokens t JOIN persons p ON p.id = t.person_id
    WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ?`, await sha256(raw), now());
  if (!row || !row.active) throw new HttpError(404, 'This link does not work (any more). Ask for a new one.');
  return row;
}
/** Use it up: succeeds for exactly one caller. */
export async function useToken(c, row) {
  const r = await c.db.prepare('UPDATE account_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(now(), row.token_hash).run();
  if (!r.meta.changes) throw new HttpError(404, 'This link has already been used.');
}

const WORDS = {
  en: {
    invite: (n, co, l) => ({ subject: `${co}: your Ordovia account`, text: `Hello ${n},\n\n${co} has invited you to Ordovia, where your company's processes and forms live.\n\nChoose your password here (the link works for 7 days):\n${l}\n\nIf you were not expecting this, you can ignore this message.` }),
    reset: (n, co, l) => ({ subject: 'Reset your Ordovia password', text: `Hello ${n},\n\nSomeone asked to reset the password of your Ordovia account at ${co}. If that was you, choose a new password here (the link works for 1 hour):\n${l}\n\nIf it was not you, ignore this message; your password stays as it is.` }),
    email: (n, co, l) => ({ subject: 'Confirm your new e-mail address', text: `Hello ${n},\n\nPlease confirm that this is your new e-mail address for Ordovia (${co}) (the link works for 24 hours):\n${l}\n\nIf you did not ask for this, ignore this message.` }),
  },
  nl: {
    invite: (n, co, l) => ({ subject: `${co}: je Ordovia-account`, text: `Hallo ${n},\n\n${co} heeft je uitgenodigd voor Ordovia, waar de processen en formulieren van je bedrijf staan.\n\nKies hier je wachtwoord (de link werkt 7 dagen):\n${l}\n\nVerwachtte je dit niet, dan kun je dit bericht negeren.` }),
    reset: (n, co, l) => ({ subject: 'Stel je Ordovia-wachtwoord opnieuw in', text: `Hallo ${n},\n\nEr is gevraagd om het wachtwoord van je Ordovia-account bij ${co} opnieuw in te stellen. Was jij dat? Kies hier een nieuw wachtwoord (de link werkt 1 uur):\n${l}\n\nWas jij het niet, negeer dit bericht dan; je wachtwoord blijft zoals het is.` }),
    email: (n, co, l) => ({ subject: 'Bevestig je nieuwe e-mailadres', text: `Hallo ${n},\n\nBevestig dat dit je nieuwe e-mailadres voor Ordovia (${co}) is (de link werkt 24 uur):\n${l}\n\nHeb je dit niet aangevraagd, negeer dit bericht dan.` }),
  },
};

/** Where the app lives, for links in mails. */
export const appLink = (c, path) => `${c.url.origin}/app/#/${path}`;

/** Mail a link. If no mail provider is set up yet, hand the link back so the screen can show it. */
export async function mailLink(c, { to, name, kind, token, lang }) {
  const s = await c.settings();
  const link = appLink(c, 'account/' + token);
  const t = (WORDS[lang || s.lang] || WORDS.nl)[kind](name, s.company || 'Ordovia', link);
  const out = await sendMail(c.env, { to, subject: t.subject, text: t.text });
  return out.sent ? { sent: true, to } : { sent: false, to, link };
}

// ---------------------------------------------------------------- sign-in rate limiting (kept in the control register; no personal data beyond the address)
export async function limitCheck(ctl, keys, max, windowSec) {
  const since = at(Date.now() - windowSec * 1000);
  for (const [i, k] of keys.entries()) {
    const r = await first(ctl, 'SELECT n FROM attempts WHERE key = ? AND since >= ?', k, since);
    if (r && r.n >= max[i]) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
}
/** Count one failed attempt on every key; returns the new count of the first key. */
export async function limitHit(ctl, keys, windowSec) {
  const t = now(), since = at(Date.now() - windowSec * 1000);
  let n1 = 0;
  for (const [i, k] of keys.entries()) {
    await run(ctl, 'INSERT INTO attempts(key, n, since) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = CASE WHEN since < ? THEN 1 ELSE n + 1 END, since = CASE WHEN since < ? THEN ? ELSE since END', k, t, since, since, t);
    if (i === 0) n1 = (await first(ctl, 'SELECT n FROM attempts WHERE key = ?', k)).n;
  }
  return n1;
}
export const limitClear = (ctl, key) => run(ctl, 'DELETE FROM attempts WHERE key = ?', key);
export const clientIp = (req) => req.headers.get('cf-connecting-ip') || 'local';
