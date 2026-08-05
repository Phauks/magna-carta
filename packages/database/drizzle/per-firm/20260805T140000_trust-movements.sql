-- Trust movements — the client-ledger record beside a trust ledger entry: who the money came from
-- or went to, why, by what method, and who authorized it. Hand-written rather than
-- drizzle-kit-generated because of the append-only triggers at the end of this file: drizzle-kit
-- cannot model a trigger, and append-only on trust_movement is structural, not a convention. Table
-- and column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `trust_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`kind` text NOT NULL,
	`node_id` text NOT NULL,
	`counterparty_node_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`entry_id` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`counterparty_name` text,
	`purpose` text NOT NULL,
	`recorded_by` text NOT NULL,
	`authorized_by` text,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`counterparty_node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`),
	CONSTRAINT `trust_movement_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_movement_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_movement_purpose_nonempty_check` CHECK (length(`purpose`) > 0),
	CONSTRAINT `trust_movement_kind_check` CHECK (`kind` IN ('deposit', 'disbursement', 'matter_transfer')),
	CONSTRAINT `trust_movement_method_check` CHECK (`method` IN ('check', 'cash', 'wire', 'electronic_transfer', 'card', 'internal')),
	CONSTRAINT `trust_movement_shape_check` CHECK ((`kind` = 'deposit' AND `counterparty_node_id` IS NULL AND `method` <> 'internal' AND `counterparty_name` IS NOT NULL) OR (`kind` = 'disbursement' AND `counterparty_node_id` IS NULL AND `method` <> 'internal' AND `counterparty_name` IS NOT NULL AND `authorized_by` IS NOT NULL) OR (`kind` = 'matter_transfer' AND `counterparty_node_id` IS NOT NULL AND `counterparty_node_id` <> `node_id` AND `method` = 'internal' AND `counterparty_name` IS NULL AND `authorized_by` IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_movement_entry_unique_index` ON `trust_movement` (`entry_id`);--> statement-breakpoint
CREATE INDEX `trust_movement_node_effective_date_index` ON `trust_movement` (`node_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `trust_movement_counterparty_node_index` ON `trust_movement` (`counterparty_node_id`);--> statement-breakpoint
CREATE INDEX `trust_movement_account_effective_date_index` ON `trust_movement` (`trust_account_id`,`effective_date`);--> statement-breakpoint
-- Append-only, enforced at the database rather than by discipline — the same rule the ledger,
-- trust_hold, and trust_transfer already carry. A payee or purpose that could be edited after the
-- fact is a client-ledger record that says whatever the last writer wanted it to say, which is the
-- opposite of the record the trust rules require. A correction is a reversing ledger entry with its
-- own movement row.
CREATE TRIGGER `trust_movement_no_update` BEFORE UPDATE ON `trust_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_movement_no_delete` BEFORE DELETE ON `trust_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_movement is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a row that a plain UPDATE cannot touch. A BEFORE INSERT guard that
-- aborts when the id already exists DOES fire on the insert half of a REPLACE. Normal inserts carry
-- fresh random ids, so the guard's existence check never matches on the happy path.
CREATE TRIGGER `trust_movement_no_replace` BEFORE INSERT ON `trust_movement` WHEN EXISTS (SELECT 1 FROM `trust_movement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_movement is append-only');
END;
