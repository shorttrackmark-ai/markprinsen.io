// Microsoft sign-in: the token checks. Everything that is not exactly right must be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAttempt, authorizeUrl, verifyIdToken, _resetKeys } from '../src/msauth.js';

const b64u = (u8) => Buffer.from(u8).toString('base64url');
const env = { MS_CLIENT_ID: 'client-123', MS_CLIENT_SECRET: 's', MS_AUTHORITY: 'https://idp.test/organizations', MS_ISSUER_BASE: 'https://idp.test' };
const TID = '11111111-2222-3333-4444-555555555555', OID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', use: 'sig' };
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const fetcher = async () => ({ json: async () => ({ keys: [jwk] }) });
const NOW = 1_800_000_000_000;
const claims = (x = {}) => ({ aud: 'client-123', iss: `https://idp.test/${TID}/v2.0`, tid: TID, oid: OID, name: 'Wim Wachten', nonce: 'N1', exp: NOW / 1000 + 600, nbf: NOW / 1000 - 5, ...x });
const sign = async (c, { key = pair.privateKey, header = {} } = {}) => {
  const h = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header }))), p = b64u(Buffer.from(JSON.stringify(c)));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p)));
  return h + '.' + p + '.' + b64u(sig);
};
const check = (tok, nonce = 'N1') => { _resetKeys(); return verifyIdToken(env, tok, nonce, fetcher, NOW); };

test('a good token gives the Microsoft tenant and user id', async () => {
  assert.deepEqual(await check(await sign(claims())), { tid: TID, oid: OID, name: 'Wim Wachten' });
});
test('wrong signature, wrong audience, wrong issuer, wrong nonce are refused', async () => {
  await assert.rejects(check(await sign(claims(), { key: other.privateKey })), /could not be verified/, 'signed with another key');
  await assert.rejects(check(await sign(claims({ aud: 'someone-else' }))), /could not be verified/, 'meant for another app');
  await assert.rejects(check(await sign(claims({ iss: 'https://evil.test/' + TID + '/v2.0' }))), /could not be verified/, 'another issuer');
  await assert.rejects(check(await sign(claims({ iss: `https://idp.test/99999999-2222-3333-4444-555555555555/v2.0` }))), /could not be verified/, 'issuer of a different tenant than the tid claim');
  await assert.rejects(check(await sign(claims()), 'OTHER'), /could not be verified/, 'someone else\'s attempt (nonce)');
  await assert.rejects(check(await sign(claims({ nonce: undefined })), 'N1'), /could not be verified/, 'no nonce');
});
test('expired, not yet valid, missing user id', async () => {
  await assert.rejects(check(await sign(claims({ exp: NOW / 1000 - 3600 }))), /could not be verified/);
  await assert.rejects(check(await sign(claims({ nbf: NOW / 1000 + 3600 }))), /could not be verified/);
  await assert.rejects(check(await sign(claims({ oid: undefined }))), /could not be verified/);
  await assert.rejects(check(await sign(claims({ tid: 'not-a-tenant' }))), /could not be verified/);
});
test('alg none, other algorithms, unknown key, tampering, garbage', async () => {
  const none = b64u(Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' }))) + '.' + b64u(Buffer.from(JSON.stringify(claims()))) + '.';
  await assert.rejects(check(none), /could not be verified/, 'alg none');
  await assert.rejects(check(await sign(claims(), { header: { alg: 'HS256' } })), /could not be verified/, 'HS256');
  await assert.rejects(check(await sign(claims(), { header: { kid: 'unknown' } })), /could not be verified/, 'unknown key');
  const good = await sign(claims()), [h, p, s] = good.split('.');
  const evil = b64u(Buffer.from(JSON.stringify(claims({ oid: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' }))));
  await assert.rejects(check(h + '.' + evil + '.' + s), /could not be verified/, 'changed content');
  await assert.rejects(check('abc'), /could not be verified/); await assert.rejects(check(''), /could not be verified/);
  void p;
});
test('every attempt has its own state, nonce and PKCE pair; the authorize address carries them', async () => {
  const a = await newAttempt(), b = await newAttempt();
  assert.notEqual(a.state, b.state); assert.notEqual(a.nonce, b.nonce); assert.notEqual(a.verifier, b.verifier);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a.verifier)));
  assert.equal(a.challenge, Buffer.from(digest).toString('base64url'), 'S256 challenge');
  const u = new URL(authorizeUrl(env, 'https://app.test/api/ms/callback', a));
  assert.equal(u.origin + u.pathname, 'https://idp.test/organizations/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('state'), a.state); assert.equal(u.searchParams.get('nonce'), a.nonce); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('client_id'), 'client-123'); assert.equal(u.searchParams.get('redirect_uri'), 'https://app.test/api/ms/callback');
});
