-- A "Wait" step in a process: the case continues by itself once the waiting time is over.
CREATE TABLE timers (
  id INTEGER PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  wake_at TEXT NOT NULL,
  fired_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX timers_due ON timers(fired_at, wake_at);
CREATE INDEX timers_instance ON timers(instance_id);
