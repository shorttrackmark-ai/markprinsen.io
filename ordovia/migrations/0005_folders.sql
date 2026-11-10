-- Ordovia 0005: document folders.
-- A document sits in an area (who it belongs to) and optionally in a folder inside the library, e.g. "Quality" or "Quality / ISO 9001".
-- At most two levels; the folder is a plain text path, so there is no folder table to keep tidy.

ALTER TABLE documents ADD COLUMN folder TEXT;

DROP VIEW v_documents;
CREATE VIEW v_documents AS
  SELECT d.id, d.name, d.kind, a.name AS area, d.folder, p.name AS owner, d.status, d.version, d.reviewed_at, d.updated_at,
         f.name AS file, f.size AS bytes
  FROM documents d
  LEFT JOIN areas a ON a.id = d.area_id
  LEFT JOIN persons p ON p.id = d.owner_id
  LEFT JOIN document_versions v ON v.document_id = d.id AND v.version = d.version
  LEFT JOIN files f ON f.id = v.file_id;
