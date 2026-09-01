-- contract: the matter note becomes one row, edited in place and deleted outright.
--
-- The first cut of this table (20260901T010000_matter-notes, merged the same day) held an identity
-- row plus a chain of revisions, with three RAISE(ABORT) triggers making a stored body unrewritable,
-- and withdrawal as a state rather than a delete. The owner's direction replaced that model: a note
-- is edited and deleted like any other record, because replacing a note with another note every time
-- somebody fixes a word accumulates without end. This migration is that change.
--
-- WHAT IS LOST, stated plainly rather than discovered later. Superseded bodies are gone: after this
-- runs, a note holds the words it holds now and nothing says what it said before. Withdrawal is gone
-- with them; there is no tombstone, so a deleted note leaves no trace on the matter beyond its audit
-- row. That was the owner's call, made against the alternative, and the ADR fragments recording the
-- old position are marked superseded rather than quietly edited.
--
-- REBUILD, and the two questions REVIEWED_REBUILDS exists to force:
--
--   Does the copy preserve every row? Yes for every note that still stands. Each row carries across
--   with the body of its CURRENT head revision, which is exactly the text that surface was already
--   showing. Retracted notes are NOT carried: their body had already stopped rendering everywhere,
--   the new model has no state that could express them, and carrying one would silently restore
--   withdrawn text to the screen — the one outcome the withdrawal was for.
--
--   Is the copy SELECT column-for-column correct? Yes: id, matter_id, author_user_id and the two
--   instants come straight across; body comes from the head revision by the (note_id, ordinal) unique
--   index the old schema pinned; last_edited_by is the head revision's author where the note had been
--   revised at all and NULL where it never was; and the three occurrence columns are new, so every
--   carried row takes NULL, which each CHECK accepts.
--
-- The table is hours old, so in practice this copies little or nothing. It is written to preserve
-- rather than to truncate because "probably empty" is not a fact this migration can check.
CREATE TABLE `__new_matter_note` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`last_edited_by` text,
	`occurred_on` text,
	`occurred_at_time` text,
	`time_zone` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_note_body_check" CHECK(length("__new_matter_note"."body") > 0),
	CONSTRAINT "matter_note_occurred_on_shape_check" CHECK("__new_matter_note"."occurred_on" IS NULL OR "__new_matter_note"."occurred_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_note_occurred_at_time_shape_check" CHECK("__new_matter_note"."occurred_at_time" IS NULL OR "__new_matter_note"."occurred_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_note_occurrence_shape_check" CHECK(("__new_matter_note"."occurred_at_time" IS NULL OR "__new_matter_note"."occurred_on" IS NOT NULL)
        AND ("__new_matter_note"."occurred_at_time" IS NULL) = ("__new_matter_note"."time_zone" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_matter_note` (`id`, `matter_id`, `author_user_id`, `body`, `last_edited_by`, `occurred_on`, `occurred_at_time`, `time_zone`, `created_at`, `updated_at`)
  SELECT `matter_note`.`id`, `matter_note`.`matter_id`, `matter_note`.`author_user_id`,
    `head`.`body`,
    CASE WHEN `head`.`ordinal` > 1 THEN `head`.`author_user_id` ELSE NULL END,
    NULL, NULL, NULL,
    `matter_note`.`created_at`, `matter_note`.`updated_at`
  FROM `matter_note`
  JOIN `matter_note_revision` AS `head`
    ON `head`.`note_id` = `matter_note`.`id` AND `head`.`ordinal` = `matter_note`.`head_ordinal`
  WHERE `matter_note`.`state` = 'active';
--> statement-breakpoint
-- The append-only guards come off with the table they guarded. Dropped explicitly rather than left to
-- the DROP TABLE below, so the removal is a line somebody reviewing this migration reads.
DROP TRIGGER `matter_note_revision_no_update`;--> statement-breakpoint
DROP TRIGGER `matter_note_revision_no_delete`;--> statement-breakpoint
DROP TRIGGER `matter_note_revision_no_replace`;--> statement-breakpoint
DROP TABLE `matter_note_revision`;--> statement-breakpoint
DROP TABLE `matter_note`;--> statement-breakpoint
ALTER TABLE `__new_matter_note` RENAME TO `matter_note`;--> statement-breakpoint
CREATE INDEX `matter_note_matter_created_at_id_index` ON `matter_note` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_note_matter_occurred_on_id_index` ON `matter_note` (`matter_id`,`occurred_on`,`id`);--> statement-breakpoint
CREATE INDEX `matter_note_created_at_id_index` ON `matter_note` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_note_author_index` ON `matter_note` (`author_user_id`);--> statement-breakpoint
-- A file on the matter, linked to a note. Bytes never reach a note route: upload stays the File
-- Manager's presigned-upload and quarantine chokepoint and this row links the resulting handle, so an
-- attached document keeps its place in the matter's file list, its previews, its legal holds and its
-- reachability from discovery. Many-to-many in both directions, on the matter_asset_document model.
CREATE TABLE `matter_note_document` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`file_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`linked_by` text,
	FOREIGN KEY (`note_id`) REFERENCES `matter_note`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matter_note_document_note_index` ON `matter_note_document` (`note_id`);--> statement-breakpoint
CREATE INDEX `matter_note_document_file_index` ON `matter_note_document` (`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_note_document_note_file_unique_index` ON `matter_note_document` (`note_id`,`file_id`);--> statement-breakpoint
-- notes:retract retires with the state it gated. Deleting a note now rides notes:write, so the grants
-- are removed rather than repointed: a permission the registry no longer declares would be a row
-- nothing can ever resolve, and lint:ungranted-permissions reads the registry, not the seeds.
DELETE FROM `role_permission` WHERE `permission` = 'notes:retract';
