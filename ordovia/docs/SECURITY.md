# Security notes (reviewed in Phase 2)

**Isolation.** Every company has its own database (Durable Object, EU) and its own file prefix. A session is only valid inside its own company; the company cookie is a selector, not a credential. See TENANCY.md.

**Passwords.** PBKDF2 with a per-password salt; never logged, never returned (the SQL console and the audit log hide them). Minimum 8 characters.

**Sign-in.** Same answer for "unknown address" and "wrong password", and the hash is always computed (no timing difference). Rate limit: 8 failed attempts per address and 40 per IP in 15 minutes pause sign-in (HTTP 429); the pause is written to the company's audit log. Counters live in the control register and are deleted after a day.

**Sessions.** 14 days, random 256-bit token, only its hash is stored. Cookies are HttpOnly, Secure, SameSite=Lax. A password reset signs out every device; a password change signs out all other devices; deactivating a person ends their sessions.

**Account links** (invitation, reset, e-mail change). Single use, stored as a hash, 7 days / 1 hour / 24 hours. Asking for a reset always gets the same friendly answer (no account discovery) and is rate limited (5 per address and 20 per IP per hour). Changing the e-mail address needs the current password and a confirmation from the new address. One address belongs to one company.

**Requests.** State-changing calls need a custom header (CSRF); API tokens carry their company.

**Browser.** Headers on every page (public/_headers): strict Content-Security-Policy (no inline scripts, only own origin), no framing, nosniff, same-origin referrer, HSTS.

**Audit log.** Administrator actions are logged automatically; account events too (invitation accepted, password reset, own password changed, e-mail changed, sign-in paused). Ordinary sign-ins are NOT logged (see "no surveillance" in the principles).

**Not done yet / known limits.** No two-factor sign-in. No per-IP limit on sign-up. E-mail sending needs a provider (see mail.js); until then invitation links are shown to the administrator to hand over.

**Trust (Phase 5).** Per-company nightly backups (30 days, in the EU bucket, private: they contain password fingerprints and are never offered for download); the downloadable export contains no password or token fingerprints. Restore and delete need the company name typed. Errors are recorded without content. Not done: automatic deletion of the data of lapsed subscriptions (the terms say "[90] days"; for now deletion happens when the company asks), alerts by e-mail when errors rise (needs the mail provider), restoring from an uploaded export.

**Microsoft sign-in (Phase 7).** Accounts are matched on Microsoft's tenant id + user id, never on e-mail; linking is done by the person (or through an invitation); one-time state + cookie + nonce + PKCE; ID tokens verified (RS256 only, issuer, audience, expiry, nonce, key by id with refresh). See MICROSOFT.md.
