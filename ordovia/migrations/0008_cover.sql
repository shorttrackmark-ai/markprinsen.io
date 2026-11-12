-- Ordovia 0008: keep the process moving.
--  * persons.away_until / deputy_id: while someone is away, their deputy receives the tasks that would go to them.
--  * tasks.escalated_at: an overdue task is also handed to the process owner, who can complete or reassign it.

ALTER TABLE persons ADD COLUMN deputy_id INTEGER REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE persons ADD COLUMN away_until TEXT;
ALTER TABLE tasks ADD COLUMN escalated_at TEXT;
