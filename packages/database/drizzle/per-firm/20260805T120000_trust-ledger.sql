-- Trust accounting — the sub-ledger tree over the existing ledger, and the restrictions layered
-- above a balance. Hand-written rather than drizzle-kit-generated because of the append-only
-- triggers at the end of this file: drizzle-kit cannot model a trigger, and append-only on
-- trust_hold and trust_transfer is structural, not a convention. Table and column comments live
-- beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `trust_account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location_id` text NOT NULL,
	`jurisdiction` text,
	`bank_name` text,
	`account_number_last_four` text,
	`currency` text NOT NULL,
	`iolta` integer DEFAULT 1 NOT NULL,
	`bank_ledger_account_id` text NOT NULL,
	`client_liability_account_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_on` text NOT NULL,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`),
	FOREIGN KEY (`bank_ledger_account_id`) REFERENCES `ledger_account`(`id`),
	FOREIGN KEY (`client_liability_account_id`) REFERENCES `ledger_account`(`id`),
	CONSTRAINT `trust_account_name_nonempty_check` CHECK (length(`name`) > 0),
	CONSTRAINT `trust_account_status_check` CHECK (`status` IN ('open', 'closed')),
	CONSTRAINT `trust_account_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_account_distinct_sides_check` CHECK (`bank_ledger_account_id` <> `client_liability_account_id`),
	CONSTRAINT `trust_account_last_four_check` CHECK (`account_number_last_four` IS NULL OR `account_number_last_four` GLOB '[0-9][0-9][0-9][0-9]'),
	CONSTRAINT `trust_account_closed_at_check` CHECK ((`status` = 'closed') = (`closed_at` IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_account_bank_ledger_account_unique_index` ON `trust_account` (`bank_ledger_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_account_client_liability_account_unique_index` ON `trust_account` (`client_liability_account_id`);--> statement-breakpoint
CREATE INDEX `trust_account_location_index` ON `trust_account` (`location_id`);--> statement-breakpoint
CREATE INDEX `trust_account_status_index` ON `trust_account` (`status`);--> statement-breakpoint
CREATE TABLE `trust_ledger_node` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`ledger_account_id` text NOT NULL,
	`kind` text NOT NULL,
	`client_entity_id` text,
	`matter_id` text,
	`parent_node_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`parent_node_id`) REFERENCES `trust_ledger_node`(`id`),
	CONSTRAINT `trust_ledger_node_kind_check` CHECK (`kind` IN ('client', 'matter', 'firm_funds')),
	CONSTRAINT `trust_ledger_node_shape_check` CHECK ((`kind` = 'client' AND `client_entity_id` IS NOT NULL AND `matter_id` IS NULL AND `parent_node_id` IS NULL) OR (`kind` = 'matter' AND `client_entity_id` IS NOT NULL AND `matter_id` IS NOT NULL AND `parent_node_id` IS NOT NULL) OR (`kind` = 'firm_funds' AND `client_entity_id` IS NULL AND `matter_id` IS NULL AND `parent_node_id` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_ledger_account_unique_index` ON `trust_ledger_node` (`ledger_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_client_unique_index` ON `trust_ledger_node` (`trust_account_id`,`client_entity_id`) WHERE `kind` = 'client';--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_matter_unique_index` ON `trust_ledger_node` (`trust_account_id`,`matter_id`) WHERE `kind` = 'matter';--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_firm_funds_unique_index` ON `trust_ledger_node` (`trust_account_id`) WHERE `kind` = 'firm_funds';--> statement-breakpoint
CREATE INDEX `trust_ledger_node_account_kind_index` ON `trust_ledger_node` (`trust_account_id`,`kind`);--> statement-breakpoint
CREATE INDEX `trust_ledger_node_matter_index` ON `trust_ledger_node` (`matter_id`);--> statement-breakpoint
CREATE INDEX `trust_ledger_node_parent_index` ON `trust_ledger_node` (`parent_node_id`);--> statement-breakpoint
CREATE TABLE `trust_hold` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`reason` text NOT NULL,
	`placed_at` text NOT NULL,
	`placed_by` text,
	`releases_hold_id` text,
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`releases_hold_id`) REFERENCES `trust_hold`(`id`),
	CONSTRAINT `trust_hold_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_hold_reason_nonempty_check` CHECK (length(`reason`) > 0),
	CONSTRAINT `trust_hold_currency_check` CHECK (length(`currency`) = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_hold_releases_hold_unique_index` ON `trust_hold` (`releases_hold_id`);--> statement-breakpoint
CREATE INDEX `trust_hold_node_active_index` ON `trust_hold` (`node_id`) WHERE `releases_hold_id` IS NULL;--> statement-breakpoint
CREATE TABLE `trust_transfer` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`trust_entry_id` text NOT NULL,
	`operating_entry_id` text NOT NULL,
	`authorized_by` text,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`from_node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`trust_entry_id`) REFERENCES `ledger_entry`(`id`),
	FOREIGN KEY (`operating_entry_id`) REFERENCES `ledger_entry`(`id`),
	CONSTRAINT `trust_transfer_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_transfer_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_transfer_distinct_entries_check` CHECK (`trust_entry_id` <> `operating_entry_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_transfer_trust_entry_unique_index` ON `trust_transfer` (`trust_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_transfer_operating_entry_unique_index` ON `trust_transfer` (`operating_entry_id`);--> statement-breakpoint
CREATE INDEX `trust_transfer_from_node_index` ON `trust_transfer` (`from_node_id`);--> statement-breakpoint
CREATE INDEX `trust_transfer_account_effective_date_index` ON `trust_transfer` (`trust_account_id`,`effective_date`);--> statement-breakpoint
-- Append-only, enforced at the database rather than by discipline. It is easy to build an
-- append-only ledger and then hang a mutable table off it that quietly becomes the real record:
-- a hold that could be edited down would let disputed money be released with no trace, and a
-- transfer whose amount could be edited would restate a movement that already cleared a bank. A
-- correction is a new row — a release naming the hold it lifts, a reversing pair of ledger entries
-- for a transfer — never an edit.
CREATE TRIGGER `trust_hold_no_update` BEFORE UPDATE ON `trust_hold` BEGIN
  SELECT RAISE(ABORT, 'trust_hold is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_hold_no_delete` BEFORE DELETE ON `trust_hold` BEGIN
  SELECT RAISE(ABORT, 'trust_hold is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a row that a plain UPDATE cannot touch. A BEFORE INSERT guard that
-- aborts when the id already exists DOES fire on the insert half of a REPLACE. Normal inserts carry
-- fresh random ids, so the guard's existence check never matches on the happy path.
CREATE TRIGGER `trust_hold_no_replace` BEFORE INSERT ON `trust_hold` WHEN EXISTS (SELECT 1 FROM `trust_hold` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_hold is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_no_update` BEFORE UPDATE ON `trust_transfer` BEGIN
  SELECT RAISE(ABORT, 'trust_transfer is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_no_delete` BEFORE DELETE ON `trust_transfer` BEGIN
  SELECT RAISE(ABORT, 'trust_transfer is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_no_replace` BEFORE INSERT ON `trust_transfer` WHEN EXISTS (SELECT 1 FROM `trust_transfer` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_transfer is append-only');
END;
