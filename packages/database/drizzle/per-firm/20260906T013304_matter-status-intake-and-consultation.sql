-- THE MATTER LIFECYCLE GAINS ITS FIRST RUNG, AND THE SECOND TAKES ITS PROPER NAME.
--
-- A matter now passes through intake -> consultation -> open -> closed. An INTAKE is the walk from
-- first contact to a consultation the firm's own intake procedure lets through; it draws no number
-- of any kind. A CONSULTATION is what the status called `prospective` until now: a prospective
-- client's matter, numbered from the consultation sequence, not yet taken on. The owner renamed it
-- on 2026-09-05 because "prospective" is the conduct rules' word for the client's standing while
-- "consultation" is the firm's word for the phase, and the product already said consultation
-- everywhere but the status chip. The stored value changes with the word, so the copy below
-- REWRITES it: a row spelled `prospective` is carried across as `consultation`, which is the same
-- rung under its new name. Every other status copies verbatim. The rewrite is in the copy rather
-- than a follow-up UPDATE because the replacement's CHECK admits only the new vocabulary — a
-- verbatim copy of `prospective` fails the constraint and takes the whole migration down with it,
-- and a migration that cannot complete leaves the firm database unreachable, since it is applied
-- in the FirmDatabase durable object's constructor before any read or write is served.
--
-- contract: matter is dropped after its rows are copied into a replacement. This is a same-
-- transaction table REBUILD, not a data removal — the copy is exhaustive (every column, no
-- predicate), the drop and the rename run inside the one migration transaction, and a failure at any
-- point rolls the whole thing back with the original table intact. It is the only way SQLite can
-- widen a CHECK constraint.
--
-- Many tables carry a foreign key into matter (matter_party, matter_event, file, the ledgers, the
-- intake records, and more), which is why the file brackets the work in PRAGMA foreign_keys=OFF /
-- ON. The copy preserves every id verbatim and the replacement takes the original's name, so every
-- referencing row resolves to the row it resolved to before. Nothing is re-keyed. The six indexes
-- are recreated after the rename.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_matter` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`matter_type_id` text,
	`location_id` text,
	`responsible_member_id` text NOT NULL,
	`client_display_name` text,
	`client_code` text,
	`e_billing` integer DEFAULT 0 NOT NULL,
	`natural_language_index_excluded` integer DEFAULT 0 NOT NULL,
	`matter_number` text,
	`numbered_at` text,
	`consultation_number` text,
	`system_key` text,
	`opened_at` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_status_check" CHECK("__new_matter"."status" IN ('intake', 'consultation', 'open', 'closed')),
	CONSTRAINT "matter_title_nonempty_check" CHECK(length("__new_matter"."title") > 0),
	CONSTRAINT "matter_e_billing_check" CHECK("__new_matter"."e_billing" IN (0, 1)),
	CONSTRAINT "matter_natural_language_index_excluded_check" CHECK("__new_matter"."natural_language_index_excluded" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_matter`("id", "title", "description", "status", "matter_type_id", "location_id", "responsible_member_id", "client_display_name", "client_code", "e_billing", "natural_language_index_excluded", "matter_number", "numbered_at", "consultation_number", "system_key", "opened_at", "closed_at", "created_at", "updated_at") SELECT "id", "title", "description", CASE WHEN "status" = 'prospective' THEN 'consultation' ELSE "status" END, "matter_type_id", "location_id", "responsible_member_id", "client_display_name", "client_code", "e_billing", "natural_language_index_excluded", "matter_number", "numbered_at", "consultation_number", "system_key", "opened_at", "closed_at", "created_at", "updated_at" FROM `matter`;--> statement-breakpoint
DROP TABLE `matter`;--> statement-breakpoint
ALTER TABLE `__new_matter` RENAME TO `matter`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_matter_number_unique_index` ON `matter` (`matter_number`) WHERE "matter"."matter_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_consultation_number_unique_index` ON `matter` (`consultation_number`) WHERE "matter"."consultation_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_system_key_unique_index` ON `matter` (`system_key`) WHERE "matter"."system_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `matter_status_index` ON `matter` (`status`);--> statement-breakpoint
CREATE INDEX `matter_responsible_member_id_created_at_id_index` ON `matter` (`responsible_member_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_created_at_id_index` ON `matter` (`created_at`,`id`);