-- THE MATTER LIFECYCLE GAINS A HOLD.
--
-- A HOLD is an open matter the firm has stopped working without closing it: a client who has
-- stopped paying, a party who has gone quiet, an instruction to wait. It sits between open and
-- closed — intake -> consultation -> open <-> hold -> closed — and it is reached only from open,
-- because "no longer active" presumes the matter was. The matter keeps its number: a hold is a
-- pause of the engagement, not its end, and no number is ever drawn or surrendered for one. What
-- the row gains is the reason, in the firm's own words, and the instant the pause began; releasing
-- the hold clears both and returns the matter to open. A close leaves them standing, so a reopen
-- returns the matter to the hold it was in, which is the rung it left.
--
-- contract: matter is dropped after its rows are copied into a replacement. This is a same-
-- transaction table REBUILD, not a data removal — the copy is exhaustive (every existing column, no
-- predicate; the two new columns are NULL on every copied row, since no matter is on hold before the
-- status exists), the drop and the rename run inside the one migration transaction, and a failure at
-- any point rolls the whole thing back with the original table intact. It is the only way SQLite can
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
	`held_at` text,
	`hold_reason` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_status_check" CHECK("__new_matter"."status" IN ('intake', 'consultation', 'open', 'hold', 'closed')),
	CONSTRAINT "matter_hold_check" CHECK(("__new_matter"."held_at" IS NULL) = ("__new_matter"."hold_reason" IS NULL)),
	CONSTRAINT "matter_title_nonempty_check" CHECK(length("__new_matter"."title") > 0),
	CONSTRAINT "matter_e_billing_check" CHECK("__new_matter"."e_billing" IN (0, 1)),
	CONSTRAINT "matter_natural_language_index_excluded_check" CHECK("__new_matter"."natural_language_index_excluded" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_matter`("id", "title", "description", "status", "matter_type_id", "location_id", "responsible_member_id", "client_display_name", "client_code", "e_billing", "natural_language_index_excluded", "matter_number", "numbered_at", "consultation_number", "system_key", "opened_at", "held_at", "hold_reason", "closed_at", "created_at", "updated_at") SELECT "id", "title", "description", "status", "matter_type_id", "location_id", "responsible_member_id", "client_display_name", "client_code", "e_billing", "natural_language_index_excluded", "matter_number", "numbered_at", "consultation_number", "system_key", "opened_at", NULL, NULL, "closed_at", "created_at", "updated_at" FROM `matter`;--> statement-breakpoint
DROP TABLE `matter`;--> statement-breakpoint
ALTER TABLE `__new_matter` RENAME TO `matter`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_matter_number_unique_index` ON `matter` (`matter_number`) WHERE "matter"."matter_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_consultation_number_unique_index` ON `matter` (`consultation_number`) WHERE "matter"."consultation_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_system_key_unique_index` ON `matter` (`system_key`) WHERE "matter"."system_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `matter_status_index` ON `matter` (`status`);--> statement-breakpoint
CREATE INDEX `matter_responsible_member_id_created_at_id_index` ON `matter` (`responsible_member_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_created_at_id_index` ON `matter` (`created_at`,`id`);--> statement-breakpoint
-- The one permission for the hold, seeded onto the seats that may close a matter (Owner/Admin and
-- Attorney, the default roles from the member-rbac seed). Putting a matter on hold and releasing it
-- are one authority in two directions — managing the pause — unlike close and reopen, where the
-- reopen undoes an archival and is held narrower. The rolePermission_ handles are minted once and
-- committed as literals.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterHoldOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:hold');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterHoldAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:hold');
