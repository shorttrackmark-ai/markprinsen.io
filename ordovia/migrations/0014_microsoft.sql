-- A person can link one Microsoft (Entra) account: recognised by Microsoft's tenant id and user id, never by e-mail address.
ALTER TABLE persons ADD COLUMN ms_tid TEXT;
ALTER TABLE persons ADD COLUMN ms_oid TEXT;
CREATE UNIQUE INDEX persons_ms ON persons(ms_tid, ms_oid) WHERE ms_oid IS NOT NULL;
