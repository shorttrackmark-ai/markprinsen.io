-- Documents can go through draft -> approved -> published. Every version has a stage; existing versions are published.
ALTER TABLE document_versions ADD COLUMN stage TEXT NOT NULL DEFAULT 'published';
ALTER TABLE document_versions ADD COLUMN approved_by INTEGER REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE document_versions ADD COLUMN approved_at TEXT;
