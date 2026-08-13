-- The re-check ledger: a durable, visible record that the firm's corpus moved under an
-- already-checked matter, written the moment the cause commits and satisfied later by a check.
--
-- Hand-written rather than generated: drizzle-kit models neither the PARTIAL unique index that makes
-- a queue redelivery a no-op while still letting a recurring cause be requested again after it has
-- been answered, nor the triggers that make the cause columns immutable.
--
-- Rows are NEVER deleted. A satisfied request is part of the procedure record — it is what shows the
-- interval between a corpus change and the check that answered it, which the check row alone cannot.
CREATE TABLE `conflicts_recheck_request` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`cause_topic` text NOT NULL,
	`cause_reference` text NOT NULL,
	`cause_occurred_at` text NOT NULL,
	`requested_at` text NOT NULL,
	`satisfied_by_check_id` text,
	`satisfied_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`satisfied_by_check_id`) REFERENCES `conflicts_check`(`id`),
	CONSTRAINT `conflicts_recheck_request_cause_topic_check` CHECK (length(`cause_topic`) > 0),
	CONSTRAINT `conflicts_recheck_request_cause_reference_check` CHECK (length(`cause_reference`) > 0),
	CONSTRAINT `conflicts_recheck_request_satisfaction_check` CHECK ((`satisfied_by_check_id` IS NULL) = (`satisfied_at` IS NULL))
);
--> statement-breakpoint
-- One OPEN request per (matter, cause). A redelivered queue message re-derives the same three values
-- and lands on this index, so it is a no-op rather than a second row. The partial predicate is what
-- makes it a coalescing key rather than a permanent lock: once a request is satisfied it leaves the
-- index, so the same entity being renamed again next month can be requested again.
CREATE UNIQUE INDEX `conflicts_recheck_request_open_cause_unique` ON `conflicts_recheck_request` (`matter_id`,`cause_topic`,`cause_reference`) WHERE `satisfied_at` IS NULL;
--> statement-breakpoint
-- The drain's index: unsatisfied rows, oldest cause first. Leading with satisfied_at confines the
-- walk to the open set, which is the small end of a table that only grows.
CREATE INDEX `conflicts_recheck_request_satisfied_requested_index` ON `conflicts_recheck_request` (`satisfied_at`,`requested_at`);
--> statement-breakpoint
-- The matter's own open requests, for the posture read and for the per-matter claim the drain makes.
CREATE INDEX `conflicts_recheck_request_matter_satisfied_index` ON `conflicts_recheck_request` (`matter_id`,`satisfied_at`);
--> statement-breakpoint
-- Satisfaction is the ONLY thing that may change. The cause, the matter it landed on, and when it
-- happened are the evidence that the firm's procedure noticed something — a record that can be
-- rewritten afterwards is not evidence of anything, so the database refuses it rather than trusting
-- every future statement builder to.
CREATE TRIGGER `conflicts_recheck_request_cause_immutable` BEFORE UPDATE ON `conflicts_recheck_request`
WHEN OLD.`id` IS NOT NEW.`id`
  OR OLD.`matter_id` IS NOT NEW.`matter_id`
  OR OLD.`cause_topic` IS NOT NEW.`cause_topic`
  OR OLD.`cause_reference` IS NOT NEW.`cause_reference`
  OR OLD.`cause_occurred_at` IS NOT NEW.`cause_occurred_at`
  OR OLD.`requested_at` IS NOT NEW.`requested_at`
BEGIN
  SELECT RAISE(ABORT, 'conflicts_recheck_request records its cause once');
END;
--> statement-breakpoint
-- Satisfaction is also one-way. Reopening a satisfied request would detach the recorded interval
-- from the check that closed it, and the interval is the whole point of keeping the row.
CREATE TRIGGER `conflicts_recheck_request_satisfaction_final` BEFORE UPDATE ON `conflicts_recheck_request`
WHEN OLD.`satisfied_at` IS NOT NULL
  AND (NEW.`satisfied_at` IS NOT OLD.`satisfied_at` OR NEW.`satisfied_by_check_id` IS NOT OLD.`satisfied_by_check_id`)
BEGIN
  SELECT RAISE(ABORT, 'a satisfied conflicts_recheck_request is final');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_recheck_request_no_delete` BEFORE DELETE ON `conflicts_recheck_request` BEGIN
  SELECT RAISE(ABORT, 'conflicts_recheck_request rows are never deleted');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a recorded cause that a plain UPDATE cannot touch. A BEFORE INSERT guard
-- that aborts when the id already exists DOES fire on the insert half of a REPLACE. Normal inserts
-- carry fresh random ids, so the guard never matches on the happy path.
CREATE TRIGGER `conflicts_recheck_request_no_replace` BEFORE INSERT ON `conflicts_recheck_request` WHEN EXISTS (SELECT 1 FROM `conflicts_recheck_request` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_recheck_request records its cause once');
END;
--> statement-breakpoint
-- The provenance an automated run has and a manual one does not. Both nullable and added by
-- ALTER TABLE ADD COLUMN, which SQLite performs without a table rebuild — so the append-only guard
-- triggers on conflicts_check stay exactly as they are and every stored row keeps reading as it did.
-- A run a person asked for leaves both null.
ALTER TABLE `conflicts_check` ADD `trigger_source` text;--> statement-breakpoint
ALTER TABLE `conflicts_check` ADD `cause_json` text;
