# Sign in with Microsoft: setting it up (about 10 minutes, once)

Ordovia can let people sign in with their work or school Microsoft account (Entra ID). It stays **off** (no button anywhere) until the steps below are done.

1. Go to the Azure portal → **Microsoft Entra ID** → **App registrations** → **New registration**.
   - Name: Ordovia. Supported account types: **Accounts in any organizational directory (multitenant)**.
   - Redirect URI (type **Web**): `https://<your address>/api/ms/callback` (today `https://ordovia.shorttrackmark.workers.dev/api/ms/callback`; add the real domain here when you have one).
2. Open the new app → **Certificates & secrets** → **New client secret**; copy the *value* (shown once).
3. Copy the **Application (client) ID** from the Overview page.
4. In the project folder: `npx wrangler secret put MS_CLIENT_SECRET` (paste the secret value), and set the client id as a variable: add `"MS_CLIENT_ID": "<the client id>"` to `vars` in `wrangler.jsonc`, then `npm run deploy`.
5. Done: the sign-in page now shows "Sign in with Microsoft".

## How it works (and why it is safe)
- A person is recognised by Microsoft's **tenant id + user id**, never by e-mail address (the address in a token can be set by whoever administers that Microsoft tenant, so it proves nothing).
- The link is made by the person themselves: while signed in with a password they choose "Link my Microsoft account" (Your account page), or they accept an **invitation with Microsoft** (no password needed).
- A Microsoft account that is not linked is not let in; it gets a friendly page explaining what to do.
- The flow is the standard OpenID Connect authorization code flow with PKCE, a one-time state tied to the browser by a cookie, and a nonce. The ID token is verified (signature against Microsoft's published keys, issuer, audience, expiry, nonce).
- Someone who has only a Microsoft sign-in cannot unlink it until they have a password ("Forgot your password" on the sign-in page), so nobody can lock themselves out.
- Ordovia reads no Microsoft data besides the identity (scopes `openid profile`).
