-- Custodian — the register of physical client originals a firm holds in safekeeping. Hand-written
-- rather than drizzle-kit-generated because of the append-only triggers at the end of this file:
-- drizzle-kit cannot model a trigger, and the append-only guarantee on custody_movement is the
-- subsystem's second structural invariant, not a convention. Table and column comments live beside
-- the Drizzle definitions in packages/database/src/per-firm-schema.ts.
ALTER TABLE `matter` ADD COLUMN `system_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_system_key_unique_index` ON `matter` (`system_key`) WHERE `system_key` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `custody_location` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`parent_location_id` text,
	`firm_location_id` text,
	`address` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`firm_location_id`) REFERENCES `location`(`id`),
	CONSTRAINT `custody_location_name_check` CHECK (length(`name`) > 0),
	CONSTRAINT `custody_location_kind_check` CHECK (`kind` IN ('office', 'room', 'safe', 'cabinet', 'shelf', 'box', 'position', 'offsite', 'bank')),
	CONSTRAINT `custody_location_status_check` CHECK (`status` IN ('active', 'closed')),
	CONSTRAINT `custody_location_firm_binding_check` CHECK (`firm_location_id` IS NULL OR `parent_location_id` IS NULL)
);
--> statement-breakpoint
CREATE INDEX `custody_location_parent_index` ON `custody_location` (`parent_location_id`);--> statement-breakpoint
CREATE INDEX `custody_location_firm_location_index` ON `custody_location` (`firm_location_id`);--> statement-breakpoint
CREATE TABLE `custody_item_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`intrinsic_value_default` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `custody_item_type_name_check` CHECK (length(`name`) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_item_type_name_unique_index` ON `custody_item_type` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `custody_item_type_code_unique_index` ON `custody_item_type` (`code`);--> statement-breakpoint
CREATE TABLE `custody_packet` (
	`id` text PRIMARY KEY NOT NULL,
	`custody_number` text NOT NULL,
	`number_source` text NOT NULL,
	`name` text NOT NULL,
	`current_location_id` text,
	`status` text DEFAULT 'held' NOT NULL,
	`matter_id` text,
	`depositor_entity_id` text,
	`deposited_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`current_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `custody_packet_name_check` CHECK (length(`name`) > 0),
	CONSTRAINT `custody_packet_number_check` CHECK (length(`custody_number`) > 0),
	CONSTRAINT `custody_packet_number_source_check` CHECK (`number_source` IN ('drawn', 'manual')),
	CONSTRAINT `custody_packet_status_check` CHECK (`status` IN ('held', 'out', 'released', 'destroyed', 'lost'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_packet_custody_number_unique_index` ON `custody_packet` (`custody_number`);--> statement-breakpoint
CREATE INDEX `custody_packet_status_number_index` ON `custody_packet` (`status`,`custody_number`);--> statement-breakpoint
CREATE INDEX `custody_packet_current_location_index` ON `custody_packet` (`current_location_id`);--> statement-breakpoint
CREATE INDEX `custody_packet_matter_index` ON `custody_packet` (`matter_id`);--> statement-breakpoint
CREATE INDEX `custody_packet_depositor_index` ON `custody_packet` (`depositor_entity_id`);--> statement-breakpoint
CREATE TABLE `custody_item` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`item_type_id` text,
	`description` text NOT NULL,
	`instrument_date` text,
	`intrinsic_value` integer DEFAULT 0 NOT NULL,
	`declared_value_amount_minor` integer,
	`declared_value_currency` text,
	`status` text DEFAULT 'held' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_type_id`) REFERENCES `custody_item_type`(`id`),
	CONSTRAINT `custody_item_description_check` CHECK (length(`description`) > 0),
	CONSTRAINT `custody_item_ordinal_check` CHECK (`ordinal` > 0),
	CONSTRAINT `custody_item_status_check` CHECK (`status` IN ('held', 'out', 'released', 'destroyed', 'lost', 'superseded')),
	CONSTRAINT `custody_item_declared_value_check` CHECK ((`declared_value_amount_minor` IS NULL) = (`declared_value_currency` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_item_packet_ordinal_unique_index` ON `custody_item` (`packet_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `custody_item_item_type_index` ON `custody_item` (`item_type_id`);--> statement-breakpoint
CREATE TABLE `custody_owner` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`ownership_role` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`)
);
--> statement-breakpoint
CREATE INDEX `custody_owner_packet_index` ON `custody_owner` (`packet_id`);--> statement-breakpoint
CREATE INDEX `custody_owner_entity_index` ON `custody_owner` (`entity_id`,`effective_to`);--> statement-breakpoint
CREATE TABLE `custody_movement` (
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
	CONSTRAINT `custody_movement_kind_check` CHECK (`kind` IN ('logged', 'itemized', 'moved', 'checked_out', 'returned', 'withdrawn', 'released', 'superseded', 'destroyed', 'lost', 'found', 'hold_placed', 'hold_released', 'correction')),
	CONSTRAINT `custody_movement_borrower_kind_check` CHECK (`borrower_kind` IS NULL OR `borrower_kind` IN ('member', 'entity', 'external')),
	CONSTRAINT `custody_movement_borrower_shape_check` CHECK ((`borrower_kind` IS NULL) OR (`borrower_kind` = 'member' AND `borrower_user_id` IS NOT NULL) OR (`borrower_kind` = 'entity' AND `borrower_entity_id` IS NOT NULL) OR (`borrower_kind` = 'external' AND `borrower_name` IS NOT NULL)),
	CONSTRAINT `custody_movement_correction_check` CHECK (`corrects_movement_id` IS NULL OR `kind` = 'correction')
);
--> statement-breakpoint
CREATE INDEX `custody_movement_packet_occurred_index` ON `custody_movement` (`packet_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `custody_movement_item_index` ON `custody_movement` (`item_id`);--> statement-breakpoint
CREATE INDEX `custody_movement_borrower_entity_index` ON `custody_movement` (`borrower_entity_id`);--> statement-breakpoint
-- The overdue check-out sweep is THE operational signal this subsystem produces, and it reads a
-- narrow slice of a table that grows without bound for decades. A partial index keeps that read
-- proportional to the open check-outs rather than to the whole ledger.
CREATE INDEX `custody_movement_due_back_index` ON `custody_movement` (`due_back_on`) WHERE `kind` = 'checked_out' AND `due_back_on` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `custody_hold` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`kind` text NOT NULL,
	`placed_at` text NOT NULL,
	`placed_by` text,
	`reason` text,
	`released_at` text,
	`released_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	CONSTRAINT `custody_hold_kind_check` CHECK (`kind` IN ('legal', 'discovery', 'client_instruction', 'dispute', 'unclaimed'))
);
--> statement-breakpoint
CREATE INDEX `custody_hold_packet_released_index` ON `custody_hold` (`packet_id`,`released_at`);--> statement-breakpoint
CREATE INDEX `custody_hold_item_index` ON `custody_hold` (`item_id`);--> statement-breakpoint
CREATE TABLE `custody_scan` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`captured_at` text NOT NULL,
	`captured_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`),
	CONSTRAINT `custody_scan_kind_check` CHECK (`kind` IN ('scan', 'photograph', 'receipt', 'appraisal', 'correspondence'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_scan_file_unique_index` ON `custody_scan` (`file_id`);--> statement-breakpoint
CREATE INDEX `custody_scan_packet_index` ON `custody_scan` (`packet_id`);--> statement-breakpoint
CREATE INDEX `custody_scan_item_index` ON `custody_scan` (`item_id`);--> statement-breakpoint
CREATE TABLE `custody_destruction_request` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`requested_by` text,
	`requested_at` text NOT NULL,
	`basis` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`executed_at` text,
	`outcome` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	CONSTRAINT `custody_destruction_request_basis_check` CHECK (length(`basis`) > 0),
	CONSTRAINT `custody_destruction_request_approver_check` CHECK (`approved_by` IS NULL OR `requested_by` IS NULL OR `approved_by` <> `requested_by`),
	CONSTRAINT `custody_destruction_request_outcome_check` CHECK (`outcome` IS NULL OR `outcome` IN ('approved', 'refused', 'executed', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `custody_destruction_request_packet_index` ON `custody_destruction_request` (`packet_id`);--> statement-breakpoint
CREATE TABLE `custody_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custody_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`packet_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `drawn_value`),
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`)
);
--> statement-breakpoint
CREATE INDEX `custody_number_allocation_packet_index` ON `custody_number_allocation` (`packet_id`);--> statement-breakpoint
-- The append-only ledger, enforced at the database rather than by discipline. A custody register's
-- value in a dispute is that it is a contemporaneous record nobody could have made say otherwise
-- afterwards: "the packet was checked out to Ms. Alvarez on 3 March and returned on 11 March" is
-- worth something only because no later edit could have produced it. A correction is a new
-- compensating row carrying corrects_movement_id, never an edit.
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
