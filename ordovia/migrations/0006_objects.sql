-- Ordovia 0006: classes and objects.
--  * forms.is_class: a register of "things" (machine, vehicle, supplier, ...). Its records are objects with their own page.
--  * persons.attrs: custom attributes of a person (function, employee number, ...), defined once under settings key person_fields.
--  * instances.subject_*: the object a run is about ("calibrate machine 12"). The class is chosen on the flow's start step (node.subjectForm).

ALTER TABLE forms ADD COLUMN is_class INTEGER NOT NULL DEFAULT 0;
ALTER TABLE persons ADD COLUMN attrs TEXT NOT NULL DEFAULT '{}';
ALTER TABLE instances ADD COLUMN subject_form_id INTEGER REFERENCES forms(id) ON DELETE SET NULL;
ALTER TABLE instances ADD COLUMN subject_id INTEGER;
CREATE INDEX ix_inst_subject ON instances(subject_form_id, subject_id);
