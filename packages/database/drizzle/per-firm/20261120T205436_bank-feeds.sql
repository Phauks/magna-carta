CREATE TABLE `bank_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`remote_item_id` text NOT NULL,
	`institution_name` text NOT NULL,
	`institution_logo` text,
	`credential_ref` text NOT NULL,
	`sync_cursor` text,
	`sign_in_needed` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text,
	`connected_by` text NOT NULL,
	`connected_at` text NOT NULL,
	`disconnected_by` text,
	`disconnected_at` text,
	CONSTRAINT "bank_connection_provider_check" CHECK("bank_connection"."provider" IN ('plaid')),
	CONSTRAINT "bank_connection_sign_in_needed_check" CHECK("bank_connection"."sign_in_needed" IN (0, 1)),
	CONSTRAINT "bank_connection_institution_name_check" CHECK(length("bank_connection"."institution_name") BETWEEN 1 AND 200),
	CONSTRAINT "bank_connection_institution_logo_check" CHECK("bank_connection"."institution_logo" IS NULL OR length("bank_connection"."institution_logo") BETWEEN 1 AND 100000),
	CONSTRAINT "bank_connection_disconnected_shape_check" CHECK(("bank_connection"."disconnected_at" IS NULL) = ("bank_connection"."disconnected_by" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connection_remote_item_unique_index` ON `bank_connection` (`provider`,`remote_item_id`);--> statement-breakpoint
CREATE TABLE `bank_feed_account` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`remote_account_id` text NOT NULL,
	`name` text NOT NULL,
	`mask` text,
	`kind` text NOT NULL,
	`subtype` text,
	`currency` text NOT NULL,
	`current_balance_minor` integer,
	`available_balance_minor` integer,
	`balances_read_at` text,
	`ledger_account_id` text,
	`linked_by` text,
	`linked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `bank_connection`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_feed_account_currency_check" CHECK(length("bank_feed_account"."currency") = 3),
	CONSTRAINT "bank_feed_account_name_check" CHECK(length("bank_feed_account"."name") BETWEEN 1 AND 200),
	CONSTRAINT "bank_feed_account_balances_read_at_check" CHECK(("bank_feed_account"."current_balance_minor" IS NULL AND "bank_feed_account"."available_balance_minor" IS NULL) OR "bank_feed_account"."balances_read_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_feed_account_remote_unique_index` ON `bank_feed_account` (`connection_id`,`remote_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_feed_account_ledger_account_unique_index` ON `bank_feed_account` (`ledger_account_id`) WHERE "bank_feed_account"."ledger_account_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `bank_feed_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_transaction_id` text NOT NULL,
	`posted_on` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`check_number` text,
	`pending` integer DEFAULT 0 NOT NULL,
	`removed_at` text,
	`first_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `bank_feed_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_feed_transaction_posted_on_shape_check" CHECK("bank_feed_transaction"."posted_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "bank_feed_transaction_pending_check" CHECK("bank_feed_transaction"."pending" IN (0, 1)),
	CONSTRAINT "bank_feed_transaction_description_check" CHECK(length("bank_feed_transaction"."description") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_feed_transaction_remote_unique_index` ON `bank_feed_transaction` (`account_id`,`remote_transaction_id`);--> statement-breakpoint
CREATE INDEX `bank_feed_transaction_account_posted_index` ON `bank_feed_transaction` (`account_id`,`posted_on`);--> statement-breakpoint
-- WHO SEES THE BANKING SCREEN, AND WHO SIGNS THE FIRM IN TO ITS BANK.
--
-- banking:read shows what the bank reports about the firm's operating and trust accounts. It goes to
-- the roles that keep or read the firm's money (Owner/Admin, Attorney, Billing); a paralegal sees a
-- client's trust balance through trust:read but not the firm's own bank accounts. banking:manage
-- connects a bank with the firm's bank sign-in, so it goes to Owner/Admin alone. The seed shape is the
-- house one, plain INSERTs, so tooling/lint-ungranted-permissions reads it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_bankingReadAdmin00000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'banking:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_bankingReadAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'banking:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_bankingReadBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'banking:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_bankingManageAdmin0000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'banking:manage');
