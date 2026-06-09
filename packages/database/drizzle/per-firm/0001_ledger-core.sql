CREATE TABLE `account_balance` (
	`account_id` text PRIMARY KEY NOT NULL,
	`balance_minor` integer DEFAULT 0 NOT NULL,
	`min_balance_minor` integer,
	`max_balance_minor` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_balance_bounds_check" CHECK(("account_balance"."min_balance_minor" IS NULL OR "account_balance"."balance_minor" >= "account_balance"."min_balance_minor") AND ("account_balance"."max_balance_minor" IS NULL OR "account_balance"."balance_minor" <= "account_balance"."max_balance_minor"))
);
--> statement-breakpoint
CREATE TABLE `ledger_account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`parent_account_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_account_name_nonempty_check" CHECK(length("ledger_account"."name") > 0)
);
--> statement-breakpoint
CREATE INDEX `ledger_account_parent_account_id_index` ON `ledger_account` (`parent_account_id`);--> statement-breakpoint
CREATE TABLE `ledger_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	`reverses_entry_id` text,
	FOREIGN KEY (`reverses_entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_entry_description_nonempty_check" CHECK(length("ledger_entry"."description") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entry_reverses_entry_id_unique_index` ON `ledger_entry` (`reverses_entry_id`);--> statement-breakpoint
CREATE INDEX `ledger_entry_effective_date_index` ON `ledger_entry` (`effective_date`);--> statement-breakpoint
CREATE TABLE `ledger_line` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_line_amount_minor_positive_check" CHECK("ledger_line"."amount_minor" > 0),
	CONSTRAINT "ledger_line_direction_check" CHECK("ledger_line"."direction" IN ('debit', 'credit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_line_entry_id_line_index_unique_index` ON `ledger_line` (`entry_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `ledger_line_account_id_index` ON `ledger_line` (`account_id`);