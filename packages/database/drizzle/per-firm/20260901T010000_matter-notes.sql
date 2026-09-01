-- The matter note: an identity that persists and a body that gets corrected, as two tables.
--
-- Until now this platform had no note anywhere. What it had were scalar `note` / `notes` columns on
-- a dozen individual records — one nullable free-text column on one row, attributable to nobody,
-- editable in place, with no history and no reader but that row's own detail view. Those are not a
-- primitive; they are the symptom of one being absent.
--
-- Two tables rather than one because a note's identity and its words have different lifetimes. The
-- identity carries the matter, who first wrote it, when, and whether it still stands. Each revision
-- carries one body, its own author, and its own instant. An edit APPENDS a revision and moves the
-- note's head ordinal; every prior body stays readable.
--
-- The attachment is a real foreign key to `matter`, not a subject_kind/subject_id pair. The cost of
-- the polymorphic shape is already measured in this schema: `audit_log.subject_id` is untyped, holds
-- whatever the writer thought the subject was, and the timeline's read of it needs a prefix scan to
-- confine itself to rows whose subject really is a matter.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `matter_note` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`head_ordinal` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`retracted_at` text,
	`retracted_by` text,
	`retraction_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_note_state_check" CHECK("matter_note"."state" IN ('active', 'retracted')),
	CONSTRAINT "matter_note_head_ordinal_check" CHECK("matter_note"."head_ordinal" > 0),
	CONSTRAINT "matter_note_retraction_shape_check" CHECK(("matter_note"."state" = 'retracted' AND "matter_note"."retracted_at" IS NOT NULL AND "matter_note"."retracted_by" IS NOT NULL AND "matter_note"."retraction_reason" IS NOT NULL AND length("matter_note"."retraction_reason") > 0)
        OR ("matter_note"."state" = 'active' AND "matter_note"."retracted_at" IS NULL AND "matter_note"."retracted_by" IS NULL AND "matter_note"."retraction_reason" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_note_matter_created_at_id_index` ON `matter_note` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_note_created_at_id_index` ON `matter_note` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_note_author_index` ON `matter_note` (`author_user_id`);--> statement-breakpoint
CREATE TABLE `matter_note_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `matter_note`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_note_revision_body_check" CHECK(length("matter_note_revision"."body") > 0),
	CONSTRAINT "matter_note_revision_ordinal_check" CHECK("matter_note_revision"."ordinal" > 0)
);
--> statement-breakpoint
-- Exactly one revision per ordinal per note, which is what pins the chain and what makes the head
-- pointer safe without a guard of its own: two members revising the same note at once both compute
-- the next ordinal, and the second insert collides and aborts the whole batch. One loses, and neither
-- silently overwrites the other's words.
CREATE UNIQUE INDEX `matter_note_revision_note_ordinal_unique_index` ON `matter_note_revision` (`note_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `matter_note_revision_author_index` ON `matter_note_revision` (`author_user_id`);--> statement-breakpoint
-- The revision table is APPEND-ONLY, held here rather than in application code, on the same pattern
-- as the conflicts log's six guards in 20260709T120000_conflicts.sql.
--
-- A note is the record a lawyer writes fastest and least carefully, and its evidentiary weight comes
-- entirely from having been written then, by that person, saying that. Application code that appends
-- and never rewrites is true right up until a repair script, a bulk import fix, or a well-meant
-- autosave feature reaches this table directly — at which point a contemporaneous record quietly
-- becomes something else, with no revision, no actor and no trace. These three triggers make that
-- unwritable rather than merely discouraged.
--
-- No trigger guards `matter_note`: its head ordinal moves on every revision and its state column has
-- to move for retraction, which is the mechanism by which a note that should never have been written
-- stops rendering. Withdrawal is a state, not a rewrite, so nothing here stands in its way.
--
-- The cost is honest and was accepted deliberately: honouring a genuine court-ordered destruction
-- means a reviewed migration rather than a query.
CREATE TRIGGER `matter_note_revision_no_update` BEFORE UPDATE ON `matter_note_revision` BEGIN
  SELECT RAISE(ABORT, 'matter_note_revision is append-only; correct a note by appending a revision');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_note_revision_no_delete` BEFORE DELETE ON `matter_note_revision` BEGIN
  SELECT RAISE(ABORT, 'matter_note_revision is append-only; withdraw a note by retracting it');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a body that a plain UPDATE cannot touch. A BEFORE INSERT guard that
-- aborts when the id already exists DOES fire on the insert half of a REPLACE — closing the one
-- remaining path. Ordinary inserts carry a fresh handle and never match.
CREATE TRIGGER `matter_note_revision_no_replace` BEFORE INSERT ON `matter_note_revision` WHEN EXISTS (SELECT 1 FROM `matter_note_revision` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'matter_note_revision is append-only; correct a note by appending a revision');
END;
--> statement-breakpoint
-- The three note permissions, seeded onto the default roles.
--
-- notes:read and notes:write reach the seats that WORK matters — Owner/Admin, Attorney, Paralegal —
-- and deliberately not Billing or Read-only. This is the opposite default from calendar:read, which
-- reaches every seat, and the difference is what the record is: "when is the hearing" is a logistics
-- fact everybody in a firm needs, whereas a note is the firm's candid assessment of a case and the
-- most protected class of text it produces. A billing clerk assembling an invoice has no occasion to
-- read counsel's theory of the indemnity clause, and a Read-only seat is frequently an outside
-- accountant or an auditor.
--
-- AMENDED on 2026-09-01, hours after this migration was written and in the same change that
-- supersedes the model it created: it originally also seeded a third key, notes:retract, for a
-- withdrawal state that no longer exists. Deleting a note now rides notes:write. Migrations are
-- applied by tag and carry no content hash, so amending this one changes only what a firm that has
-- not yet run it receives; 20260901T120000_matter-notes-edit-and-delete additionally DELETEs those
-- grants, so a firm that already ran the original converges on the same state either way.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'notes:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'notes:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'notes:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesWriteOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'notes:write');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesWriteAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'notes:write');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesWriteParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'notes:write');
