-- The waiver's own record on a conflicts disposition.
--
-- Before this, recording that a waiver was obtained was a `kind` and a sentence. What a firm is asked
-- to produce when a waiver is questioned is the client's informed consent CONFIRMED IN WRITING, and a
-- sentence is not that: a platform that lets a lawyer mark a conflict waived and then cannot show the
-- confirmation has recorded a belief rather than a fact. These four columns are the fact.
--
-- All four are nullable, and deliberately so. Every row already on the books has none of them; the
-- other three disposition kinds never use them; and a waiver whose written confirmation has not
-- arrived yet is a real state of the world that the platform must be able to hold without either
-- refusing it or dressing it up as complete. Column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- Purely additive, so the append-only table is not rebuilt and its six guard triggers are untouched.
--
-- Each closed shape rides its own column as a CHECK: there is no ALTER TABLE ADD CONSTRAINT in
-- SQLite, and a column CHECK on the ADD is the one place the constraint can be stated without
-- rewriting the table. Every existing row takes NULL, which each constraint accepts.
ALTER TABLE `conflicts_disposition` ADD COLUMN `waiver_given_by_entity_id` text;--> statement-breakpoint
ALTER TABLE `conflicts_disposition` ADD COLUMN `waiver_confirmed_in_writing` integer CONSTRAINT `conflicts_disposition_waiver_confirmed_in_writing_check` CHECK (`waiver_confirmed_in_writing` IS NULL OR `waiver_confirmed_in_writing` IN (0, 1));--> statement-breakpoint
ALTER TABLE `conflicts_disposition` ADD COLUMN `waiver_document_file_id` text REFERENCES `file`(`id`);--> statement-breakpoint
ALTER TABLE `conflicts_disposition` ADD COLUMN `waiver_given_on` text CONSTRAINT `conflicts_disposition_waiver_given_on_shape_check` CHECK (`waiver_given_on` IS NULL OR `waiver_given_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');--> statement-breakpoint
-- A waiver record belongs to a waiver and to nothing else. A `cleared` row carrying a consenting
-- party, or a `representation_declined` row carrying an evidencing document, is not a shape any
-- future vocabulary makes sense of — it is a row that would read, to anyone reporting off this table,
-- as a waiver the firm never recorded. The table is append-only, so there is no correcting UPDATE to
-- fall back on and the guard has to be on the insert. It sits beside the six append-only triggers
-- rather than in application code for the same reason they do: nothing can silently stop calling it.
CREATE TRIGGER `conflicts_disposition_waiver_record_only_on_waiver` BEFORE INSERT ON `conflicts_disposition` WHEN NEW.`kind` <> 'waiver_obtained' AND (NEW.`waiver_given_by_entity_id` IS NOT NULL OR NEW.`waiver_confirmed_in_writing` IS NOT NULL OR NEW.`waiver_document_file_id` IS NOT NULL OR NEW.`waiver_given_on` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'only a waiver_obtained disposition carries a waiver record');
END;
