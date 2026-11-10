-- Ordovia schema (Cloudflare D1 / SQLite)

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE persons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE (category, value)
);

CREATE TABLE person_tags (
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, tag_id)
);

-- fields: JSON field definitions; checks: JSON [{rule, message}] form-level logic checks;
-- access: JSON {viewTags:[], addTags:[], direct:true}
CREATE TABLE forms (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  checks TEXT NOT NULL DEFAULT '[]',
  access TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT
);

-- graph: JSON {nodes:[], edges:[]}; doc: JSON handbook info {purpose, owner, scope, ...}
CREATE TABLE flows (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  graph TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  doc TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT
);

-- graph is a snapshot of the flow at start, so editing a flow never breaks running processes
CREATE TABLE instances (
  id INTEGER PRIMARY KEY,
  flow_id INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  flow_version INTEGER,
  graph TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  vars TEXT NOT NULL DEFAULT '{}',
  started_by INTEGER REFERENCES persons(id),
  created_at TEXT,
  finished_at TEXT
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  node_id TEXT,
  name TEXT,
  form_id INTEGER REFERENCES forms(id) ON DELETE SET NULL,
  assignee TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  reminded_at TEXT,
  completed_by INTEGER REFERENCES persons(id),
  submission_id INTEGER,
  created_at TEXT,
  completed_at TEXT
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES persons(id),
  instance_id INTEGER REFERENCES instances(id) ON DELETE SET NULL,
  task_id INTEGER,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  person_id INTEGER,
  message TEXT,
  created_at TEXT
);

-- widgets: JSON array; access: JSON {viewTags:[]}
CREATE TABLE dashboards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  widgets TEXT NOT NULL DEFAULT '[]',
  access TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT
);

CREATE INDEX ix_sub_form ON submissions(form_id);
CREATE INDEX ix_sub_instance ON submissions(instance_id);
CREATE INDEX ix_task_status ON tasks(status);
CREATE INDEX ix_task_instance ON tasks(instance_id);
CREATE INDEX ix_event_instance ON events(instance_id);

CREATE VIEW v_people AS
  SELECT p.id AS person_id, p.name, p.email, t.category, t.value
  FROM persons p
  LEFT JOIN person_tags pt ON pt.person_id = p.id
  LEFT JOIN tags t ON t.id = pt.tag_id;

CREATE VIEW v_instances AS
  SELECT i.id, f.name AS flow, i.title, i.status, json_extract(i.vars, '$.outcome') AS outcome,
         p.name AS started_by, i.created_at, i.finished_at,
         round((julianday(coalesce(i.finished_at, datetime('now'))) - julianday(i.created_at)) * 24, 1) AS hours
  FROM instances i
  JOIN flows f ON f.id = i.flow_id
  LEFT JOIN persons p ON p.id = i.started_by;

CREATE VIEW v_tasks AS
  SELECT t.id, t.name AS task, f.name AS flow, t.status, t.instance_id, i.title AS process,
         t.created_at, t.due_at, t.completed_at, p.name AS completed_by,
         round((julianday(coalesce(t.completed_at, datetime('now'))) - julianday(t.created_at)) * 24, 1) AS hours_open,
         CASE WHEN t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < datetime('now') THEN 1 ELSE 0 END AS overdue
  FROM tasks t
  JOIN instances i ON i.id = t.instance_id
  JOIN flows f ON f.id = i.flow_id
  LEFT JOIN persons p ON p.id = t.completed_by;
