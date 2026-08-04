-- Custodian review dates, and the movement kind that records a completed review. Hand-written
-- rather than drizzle-kit-generated for two reasons: the append-only triggers on custody_movement
-- have to be dropped and recreated around the table rebuild below, and drizzle-kit cannot model a
-- trigger at all. Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- Deliberately absent, and not an oversight: any retention column, default, or derived date. A
-- review date is "look at this again", set by a firm; it is not a clock that expires anything.
ALTER TABLE `custody_packet` ADD COLUMN `review_on` text;--> statement-breakpoint
ALTER TABLE `custody_packet` ADD COLUMN `review_interval_months` integer CONSTRAINT `custody_packet_review_interval_check` CHECK (`review_interval_months` IS NULL OR (`review_interval_months` > 0 AND `review_interval_months` <= 600));--> statement-breakpoint
ALTER TABLE `custody_item` ADD COLUMN `review_on` text;--> statement-breakpoint
ALTER TABLE `custody_item` ADD COLUMN `review_interval_months` integer CONSTRAINT `custody_item_review_interval_check` CHECK (`review_interval_months` IS NULL OR (`review_interval_months` > 0 AND `review_interval_months` <= 600));--> statement-breakpoint
-- The reviews-due sweep reads the few rows that carry a date out of a register that mostly does not,
-- and it runs against a corpus a firm keeps for decades. A partial index keeps the read proportional
-- to the scheduled reviews rather than to the whole register — the same shape the overdue check-out
-- index takes on custody_movement.
CREATE INDEX `custody_packet_review_index` ON `custody_packet` (`review_on`) WHERE `review_on` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `custody_item_review_index` ON `custody_item` (`review_on`) WHERE `review_on` IS NOT NULL;--> statement-breakpoint
-- Recording a completed review is a custody event: it is what makes "we last looked at this in
-- March 2024" answerable, and the ledger is the only place this subsystem records that anything
-- happened. Adding the kind means widening custody_movement's kind CHECK, and SQLite can only
-- replace a CHECK constraint by rebuilding the table — hence the sequence below rather than an
-- ALTER. The rebuild is safe to do here because nothing references custody_movement: corrects_
-- movement_id is a self-reference carried WITHOUT a foreign key, precisely so the ledger never
-- acquires a referential dependency that would make it un-rebuildable.
--
-- contract: the old custody_movement is dropped after its rows are copied into the replacement.
-- This is a same-transaction table REBUILD, not a data removal — the copy above is exhaustive
-- (every column, no predicate), the drop and the rename run inside the one migration transaction,
-- and a failure at any point rolls the whole thing back with the original table intact. It is the
-- only way SQLite can replace a CHECK constraint, and it is safe here because nothing references
-- custody_movement: corrects_movement_id is a self-reference carried deliberately WITHOUT a foreign
-- key, so no other table's rows depend on the one being dropped.
--
-- Order matters. The BEFORE INSERT replace-guard has to go first or it would fire on every copied
-- row; a drop fires no triggers, so the old table's rows leave without tripping the BEFORE DELETE
-- guard, and the copy is the only path the rows travel.
DROP TRIGGER `custody_movement_no_update`;--> statement-breakpoint
DROP TRIGGER `custody_movement_no_delete`;--> statement-breakpoint
DROP TRIGGER `custody_movement_no_replace`;--> statement-breakpoint
CREATE TABLE `custody_movement_rebuilt` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`kind` text NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by_user_id` text,
	`from_location_id` text,
	`to_location_id` text,
	`borrower_kind` text,
	`borrower_user_id` text,
	`borrower_entity_id` text,
	`borrower_name` text,
	`due_back_on` text,
	`reason` text,
	`corrects_movement_id` text,
	`shipment_id` text,
	`note` text,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	FOREIGN KEY (`from_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`to_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`shipment_id`) REFERENCES `shipment`(`id`),
	CONSTRAINT `custody_movement_kind_check` CHECK (`kind` IN ('logged', 'itemized', 'moved', 'checked_out', 'returned', 'withdrawn', 'released', 'superseded', 'destroyed', 'lost', 'found', 'reviewed', 'hold_placed', 'hold_released', 'correction')),
	CONSTRAINT `custody_movement_borrower_kind_check` CHECK (`borrower_kind` IS NULL OR `borrower_kind` IN ('member', 'entity', 'external')),
	CONSTRAINT `custody_movement_borrower_shape_check` CHECK ((`borrower_kind` IS NULL) OR (`borrower_kind` = 'member' AND `borrower_user_id` IS NOT NULL) OR (`borrower_kind` = 'entity' AND `borrower_entity_id` IS NOT NULL) OR (`borrower_kind` = 'external' AND `borrower_name` IS NOT NULL)),
	CONSTRAINT `custody_movement_correction_check` CHECK (`corrects_movement_id` IS NULL OR `kind` = 'correction')
);
--> statement-breakpoint
INSERT INTO `custody_movement_rebuilt` (`id`, `packet_id`, `item_id`, `kind`, `occurred_at`, `recorded_at`, `recorded_by_user_id`, `from_location_id`, `to_location_id`, `borrower_kind`, `borrower_user_id`, `borrower_entity_id`, `borrower_name`, `due_back_on`, `reason`, `corrects_movement_id`, `shipment_id`, `note`) SELECT `id`, `packet_id`, `item_id`, `kind`, `occurred_at`, `recorded_at`, `recorded_by_user_id`, `from_location_id`, `to_location_id`, `borrower_kind`, `borrower_user_id`, `borrower_entity_id`, `borrower_name`, `due_back_on`, `reason`, `corrects_movement_id`, `shipment_id`, `note` FROM `custody_movement`;--> statement-breakpoint
DROP TABLE `custody_movement`;--> statement-breakpoint
ALTER TABLE `custody_movement_rebuilt` RENAME TO `custody_movement`;--> statement-breakpoint
CREATE INDEX `custody_movement_packet_occurred_index` ON `custody_movement` (`packet_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `custody_movement_item_index` ON `custody_movement` (`item_id`);--> statement-breakpoint
CREATE INDEX `custody_movement_borrower_entity_index` ON `custody_movement` (`borrower_entity_id`);--> statement-breakpoint
CREATE INDEX `custody_movement_due_back_index` ON `custody_movement` (`due_back_on`) WHERE `kind` = 'checked_out' AND `due_back_on` IS NOT NULL;--> statement-breakpoint
-- The append-only ledger, restored byte-for-byte in behaviour. A custody register's value in a
-- dispute is that it is a contemporaneous record nobody could have made say otherwise afterwards; a
-- correction is a new compensating row carrying corrects_movement_id, never an edit.
CREATE TRIGGER `custody_movement_no_update` BEFORE UPDATE ON `custody_movement` BEGIN
  SELECT RAISE(ABORT, 'custody_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_no_delete` BEFORE DELETE ON `custody_movement` BEGIN
  SELECT RAISE(ABORT, 'custody_movement is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a ledger row that a plain UPDATE cannot touch. A BEFORE INSERT guard that
-- aborts when the id already exists DOES fire on the insert half of a REPLACE — closing the one
-- remaining path that could mutate an append-only row in place. Normal inserts carry fresh random
-- ids, so the guard's primary-key existence check never matches on the happy path.
CREATE TRIGGER `custody_movement_no_replace` BEFORE INSERT ON `custody_movement` WHEN EXISTS (SELECT 1 FROM `custody_movement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'custody_movement is append-only');
END;
