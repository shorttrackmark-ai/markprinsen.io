-- Ordovia 0002: keep a growing workspace tidy.
--  * areas: the one way everything is grouped (Finance, HR, Sales, ...). Forms, flows and dashboards belong to an area.
--  * status: draft (being built) / active (in use) / archived (hidden, kept). Only active flows can be started by colleagues.
--  * owner + review cycle: every process has an owner and a date it must be reviewed again.
--  * audit: who changed what, and when. flow_versions: earlier versions of a flow, to look at or restore.

CREATE TABLE areas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  color TEXT,
  owner_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  created_at TEXT
);

ALTER TABLE forms ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL;
ALTER TABLE forms ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE forms ADD COLUMN owner_id INTEGER REFERENCES persons(id) ON DELETE SET NULL;

ALTER TABLE flows ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL;
ALTER TABLE flows ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE flows ADD COLUMN owner_id INTEGER REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE flows ADD COLUMN review_months INTEGER NOT NULL DEFAULT 12;
ALTER TABLE flows ADD COLUMN reviewed_at TEXT;

ALTER TABLE dashboards ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL;
ALTER TABLE dashboards ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE dashboards ADD COLUMN owner_id INTEGER REFERENCES persons(id) ON DELETE SET NULL;

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  name TEXT,
  detail TEXT
);
CREATE INDEX ix_audit_at ON audit(at);
CREATE INDEX ix_audit_entity ON audit(entity, entity_id);

CREATE TABLE flow_versions (
  id INTEGER PRIMARY KEY,
  flow_id INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT,
  graph TEXT NOT NULL,
  doc TEXT,
  saved_at TEXT,
  saved_by INTEGER REFERENCES persons(id) ON DELETE SET NULL
);
CREATE INDEX ix_flowver_flow ON flow_versions(flow_id, version);

-- Flows that already existed (before statuses) are in use: make them active.
UPDATE flows SET status = 'active', reviewed_at = coalesce(updated_at, datetime('now'));

CREATE VIEW v_areas AS
  SELECT a.id, a.name, p.name AS owner,
         (SELECT count(*) FROM flows f WHERE f.area_id = a.id AND f.status != 'archived') AS flows,
         (SELECT count(*) FROM forms f WHERE f.area_id = a.id AND f.status != 'archived') AS forms,
         (SELECT count(*) FROM dashboards d WHERE d.area_id = a.id AND d.status != 'archived') AS dashboards
  FROM areas a LEFT JOIN persons p ON p.id = a.owner_id;
