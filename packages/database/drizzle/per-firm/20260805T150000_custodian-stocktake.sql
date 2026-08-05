-- Stocktake: periodic physical-inventory verification over the custody register. Hand-written rather
-- than drizzle-kit-generated because of the append-only triggers at the end of this file: drizzle-kit
-- cannot model a trigger, and append-only on custody_stocktake_sighting is structural, not a
-- convention. Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- WHAT IS DELIBERATELY ABSENT FROM THIS MIGRATION, AND WHY IT IS ABSENT.
--
-- Nothing here touches custody_movement, custody_packet, or custody_item. A stocktake observes and
-- reports; it does not dispose of property, relocate it, or correct the register. There is no new
-- movement kind, so custody_movement is not rebuilt and no existing ledger row is copied through
-- anything. A count that silently wrote the register into agreement with itself would destroy the one
-- thing a count is worth having for — the difference between what the register claims and what is on
-- the shelf — and would put a movement in the ledger that no person asserted. The reconciliation
-- names corrective movements as PROPOSALS; a person records each one through the ordinary movement
-- write path, or does not.
CREATE TABLE `custody_stocktake` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_location_id` text,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by_user_id` text,
	`closed_at` text,
	`closed_by_user_id` text,
	`matched_count` integer,
	`missing_count` integer,
	`misplaced_count` integer,
	`unexpected_count` integer,
	`unregistered_count` integer,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`scope_location_id`) REFERENCES `custody_location`(`id`),
	CONSTRAINT `custody_stocktake_name_check` CHECK (length(`name`) > 0),
	CONSTRAINT `custody_stocktake_status_check` CHECK (`status` IN ('open', 'closed', 'abandoned')),
	CONSTRAINT `custody_stocktake_closure_check` CHECK ((`status` = 'open' AND `closed_at` IS NULL) OR (`status` <> 'open' AND `closed_at` IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `custody_stocktake_status_opened_index` ON `custody_stocktake` (`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `custody_stocktake_scope_index` ON `custody_stocktake` (`scope_location_id`);--> statement-breakpoint
-- Deliberately NOT constrained to one open count at a time. A two-office firm counting Reno and Las
-- Vegas on the same Saturday is the ordinary case, not an edge one, and every sighting names its
-- stocktake explicitly, so there is no ambiguity to resolve. Two counts whose scopes overlap each
-- report honestly on what their own counters saw, which is the truth about what was done.
CREATE TABLE `custody_stocktake_sighting` (
	`id` text PRIMARY KEY NOT NULL,
	`stocktake_id` text NOT NULL,
	`kind` text NOT NULL,
	`packet_id` text,
	`item_id` text,
	`location_id` text,
	`expected_location_id` text,
	`description` text,
	`observed_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`observed_by_user_id` text,
	`note` text,
	FOREIGN KEY (`stocktake_id`) REFERENCES `custody_stocktake`(`id`),
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	FOREIGN KEY (`location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`expected_location_id`) REFERENCES `custody_location`(`id`),
	CONSTRAINT `custody_stocktake_sighting_kind_check` CHECK (`kind` IN ('sighted', 'not_found', 'unregistered')),
	CONSTRAINT `custody_stocktake_sighting_shape_check` CHECK ((`kind` = 'sighted' AND `packet_id` IS NOT NULL AND `location_id` IS NOT NULL) OR (`kind` = 'not_found' AND `packet_id` IS NOT NULL) OR (`kind` = 'unregistered' AND `packet_id` IS NULL AND `item_id` IS NULL AND `location_id` IS NOT NULL AND `description` IS NOT NULL AND length(`description`) > 0))
);
--> statement-breakpoint
CREATE INDEX `custody_stocktake_sighting_stocktake_index` ON `custody_stocktake_sighting` (`stocktake_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `custody_stocktake_sighting_packet_index` ON `custody_stocktake_sighting` (`packet_id`);--> statement-breakpoint
CREATE INDEX `custody_stocktake_sighting_location_index` ON `custody_stocktake_sighting` (`location_id`);--> statement-breakpoint
-- Append-only, enforced at the database rather than by discipline — the same rule custody_movement
-- carries, for the same reason. A sighting is a named person's assertion that they physically saw a
-- specific original on a specific shelf on a specific day. That assertion is the whole evidentiary
-- value of a count, and one that could be edited afterwards would say whatever the last writer wanted
-- it to say. A mistake is corrected by recording the later, truer observation; both stay on the
-- record, because both are what actually happened.
CREATE TRIGGER `custody_stocktake_sighting_no_update` BEFORE UPDATE ON `custody_stocktake_sighting` BEGIN
  SELECT RAISE(ABORT, 'custody_stocktake_sighting is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_stocktake_sighting_no_delete` BEFORE DELETE ON `custody_stocktake_sighting` BEGIN
  SELECT RAISE(ABORT, 'custody_stocktake_sighting is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a row that a plain UPDATE cannot touch. A BEFORE INSERT guard that aborts
-- when the id already exists DOES fire on the insert half of a REPLACE. Normal inserts carry fresh
-- random ids, so the guard's existence check never matches on the happy path.
CREATE TRIGGER `custody_stocktake_sighting_no_replace` BEFORE INSERT ON `custody_stocktake_sighting` WHEN EXISTS (SELECT 1 FROM `custody_stocktake_sighting` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'custody_stocktake_sighting is append-only');
END;
--> statement-breakpoint
-- A sighting belongs to a count that is still being taken. Recorded against a closed one it would
-- change a reconciliation somebody has already read and acted on, which is the same falsification the
-- append-only triggers above forbid one row at a time.
CREATE TRIGGER `custody_stocktake_sighting_open_only` BEFORE INSERT ON `custody_stocktake_sighting` WHEN NOT EXISTS (SELECT 1 FROM `custody_stocktake` WHERE `id` = NEW.`stocktake_id` AND `status` = 'open') BEGIN
  SELECT RAISE(ABORT, 'a sighting can only be recorded against an open stocktake');
END;
