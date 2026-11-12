-- Ordovia 0007: links. One way to connect anything to anything: a photo to a tool, a chapter of a norm to a process step, a document to a machine.
--  * An end of a link is (type, id, sub): type = document | object | flow; sub = a step of a flow (the node id), otherwise empty.
--  * note: which part of the other end matters (a chapter, a page, a remark).
--  * show_if: an optional formula over the data of a run; at a step the link only shows when it is true ("total_incl > 1000").
-- Both ends show the link: a document lists where it is used, an object lists what it is linked to, a step lists what it needs.

CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  a_type TEXT NOT NULL,
  a_id INTEGER NOT NULL,
  a_sub TEXT,
  b_type TEXT NOT NULL,
  b_id INTEGER NOT NULL,
  b_sub TEXT,
  note TEXT,
  show_if TEXT,
  created_by INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  created_at TEXT
);
CREATE INDEX ix_links_a ON links(a_type, a_id);
CREATE INDEX ix_links_b ON links(b_type, b_id);
