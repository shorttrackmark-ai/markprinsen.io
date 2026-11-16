// Sign in with Microsoft (Entra ID, work and school accounts): OpenID Connect, authorization code flow with PKCE.
// A person is recognised by Microsoft's tenant id + user id (tid, oid), NEVER by e-mail address: an e-mail address in a token can be set by whoever
// administers that Microsoft tenant, so it proves nothing. The link between a Microsoft account and a person is made by that person while
// signed in (or by accepting an invitation), and only then does Microsoft sign-in work for them.
import { HttpError } from './lib.js';

const b64u = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')), c => c.charCodeAt(0));
const rnd = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));

export const msOn = (env) => !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
const authority = (env) => (env.MS_AUTHORITY || 'https://login.microsoftonline.com/organizations').replace(/\/$/, '');
const issuerBase = (env) => (env.MS_ISSUER_BASE || 'https://login.microsoftonline.com').replace(/\/$/, '');

/** state, nonce and the PKCE pair for one sign-in attempt. */
export async function newAttempt() {
  const verifier = rnd(48);
  const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { state: rnd(24), nonce: rnd(24), verifier, challenge };
}
export function authorizeUrl(env, redirectUri, a) {
  const q = new URLSearchParams({ client_id: env.MS_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: 'openid profile', state: a.state, nonce: a.nonce, code_challenge: a.challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  return authority(env) + '/oauth2/v2.0/authorize?' + q;
}
export async function exchangeCode(env, redirectUri, code, verifier, fetcher = fetch) {
  const r = await fetcher(authority(env) + '/oauth2/v2.0/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id_token) throw new HttpError(400, 'Microsoft did not accept the sign-in.');
  return d.id_token;
}

let keyCache = { at: 0, keys: null };
async function keys(env, fetcher) {
  if (keyCache.keys && Date.now() - keyCache.at < 3600000) return keyCache.keys;
  const r = await fetcher(authority(env).replace(/\/oauth2.*$/, '') + '/discovery/v2.0/keys');
  const d = await r.json();
  keyCache = { at: Date.now(), keys: d.keys || [] };
  return keyCache.keys;
}
export const _resetKeys = () => { keyCache = { at: 0, keys: null }; };

/** Checks signature, issuer, audience, expiry and nonce. Returns { tid, oid, name }. Throws on anything that is not exactly right. */
export async function verifyIdToken(env, token, nonce, fetcher = fetch, nowMs = Date.now()) {
  const bad = () => new HttpError(400, 'The Microsoft sign-in could not be verified.');
  const parts = String(token || '').split('.'); if (parts.length !== 3) throw bad();
  let header, claims;
  try { header = JSON.parse(new TextDecoder().decode(fromB64u(parts[0]))); claims = JSON.parse(new TextDecoder().decode(fromB64u(parts[1]))); } catch { throw bad(); }
  if (header.alg !== 'RS256' || !header.kid) throw bad();
  let jwk = (await keys(env, fetcher)).find(k => k.kid === header.kid);
  if (!jwk) { keyCache = { at: 0, keys: null }; jwk = (await keys(env, fetcher)).find(k => k.kid === header.kid); }   // (keys rotate)
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const okSig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!okSig) throw bad();
  const now = Math.floor(nowMs / 1000);
  if (claims.aud !== env.MS_CLIENT_ID) throw bad();
  if (!claims.tid || !/^[0-9a-f-]{36}$/i.test(claims.tid) || claims.iss !== `${issuerBase(env)}/${claims.tid}/v2.0`) throw bad();
  if (!claims.exp || claims.exp < now - 60 || (claims.nbf && claims.nbf > now + 60)) throw bad();
  if (!nonce || claims.nonce !== nonce) throw bad();
  if (!claims.oid) throw bad();
  return { tid: claims.tid.toLowerCase(), oid: String(claims.oid).toLowerCase(), name: String(claims.name || '').slice(0, 120) };
}
