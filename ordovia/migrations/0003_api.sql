-- Ordovia 0003: processes as an interface between departments and systems.
--  * api_tokens: other systems call Ordovia (start a process, read its status, read/write records) as a chosen person
--  * instances: where a run came from (app / api / web form), the caller's own reference, and a callback URL for status updates

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  created_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

ALTER TABLE instances ADD COLUMN source TEXT NOT NULL DEFAULT 'app';
ALTER TABLE instances ADD COLUMN external_ref TEXT;
ALTER TABLE instances ADD COLUMN callback_url TEXT;
CREATE INDEX ix_inst_ref ON instances(external_ref);

DROP VIEW v_instances;
CREATE VIEW v_instances AS
  SELECT i.id, f.name AS flow, i.title, i.status, json_extract(i.vars, '$.outcome') AS outcome,
         p.name AS started_by, i.created_at, i.finished_at,
         round((julianday(coalesce(i.finished_at, datetime('now'))) - julianday(i.created_at)) * 24, 1) AS hours,
         i.source, i.external_ref
  FROM instances i
  JOIN flows f ON f.id = i.flow_id
  LEFT JOIN persons p ON p.id = i.started_by;
