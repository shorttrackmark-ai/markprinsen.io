-- Accounts: invitations, password resets and e-mail changes all use one kind of single-use link.
CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- invite | reset | email
  new_email TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX account_tokens_person ON account_tokens(person_id);
ALTER TABLE persons ADD COLUMN invited_at TEXT;   -- set while an invitation has not been accepted yet
