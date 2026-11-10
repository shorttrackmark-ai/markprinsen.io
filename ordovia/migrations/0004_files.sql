-- Ordovia 0004: files and documents.
--  * files: every uploaded file (the bytes live in R2, binding FILES; this table is the register). A file is "attached" once it belongs to a
--    document version or to a form record; unattached files older than a day are cleaned up by the hourly job.
--  * documents: the company library (norms, policies, work instructions, templates): area, owner, status, review cycle, versions.
--    Documents are linked to process steps inside the flow (node.docIds), so people see the right norm at the right step.

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  created_at TEXT,
  attached_at TEXT,
  form_id INTEGER REFERENCES forms(id) ON DELETE SET NULL,
  instance_id INTEGER REFERENCES instances(id) ON DELETE SET NULL
);
CREATE INDEX ix_files_unattached ON files(attached_at, created_at);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'procedure',
  description TEXT,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  review_months INTEGER NOT NULL DEFAULT 12,
  reviewed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  note TEXT,
  uploaded_by INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  uploaded_at TEXT
);
CREATE INDEX ix_docver_doc ON document_versions(document_id, version);

DROP VIEW v_areas;
CREATE VIEW v_areas AS
  SELECT a.id, a.name, p.name AS owner,
         (SELECT count(*) FROM flows f WHERE f.area_id = a.id AND f.status != 'archived') AS flows,
         (SELECT count(*) FROM forms f WHERE f.area_id = a.id AND f.status != 'archived') AS forms,
         (SELECT count(*) FROM dashboards d WHERE d.area_id = a.id AND d.status != 'archived') AS dashboards,
         (SELECT count(*) FROM documents d WHERE d.area_id = a.id AND d.status != 'archived') AS documents
  FROM areas a LEFT JOIN persons p ON p.id = a.owner_id;

CREATE VIEW v_documents AS
  SELECT d.id, d.name, d.kind, a.name AS area, p.name AS owner, d.status, d.version, d.reviewed_at, d.updated_at,
         f.name AS file, f.size AS bytes
  FROM documents d
  LEFT JOIN areas a ON a.id = d.area_id
  LEFT JOIN persons p ON p.id = d.owner_id
  LEFT JOIN document_versions v ON v.document_id = d.id AND v.version = d.version
  LEFT JOIN files f ON f.id = v.file_id;
