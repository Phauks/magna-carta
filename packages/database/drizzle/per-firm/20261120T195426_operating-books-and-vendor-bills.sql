-- THE FIRM'S OWN BOOKS: A CHART OF ACCOUNTS, OPERATING BANK ACCOUNTS, AND VENDOR BILLS.
--
-- The chart is four columns on ledger_account, laid over the one ledger rather than beside it.
-- ledger_account is a PARENT (every line, balance and trust account points at it), so it cannot be
-- rebuilt in a durable object; the columns are ADDED, each carrying its own CHECK. The statement
-- section CHECK names `type`, which an added column may do, so a section is always one of the
-- account's own type and a re-section can never move an account between statements.
--
-- firm_account_role gains two roles, accounts_payable and owners_equity. A CHECK cannot widen in
-- place, so that table is rebuilt; it is a LEAF (nothing references it), the copy is column for
-- column with no WHERE, and every existing mapping survives because the change only adds values.
--
-- The vendor-bill tables are evidence: header, lines and payments are append-only by trigger, each
-- with the BEFORE INSERT guard that catches INSERT OR REPLACE (which fires neither the UPDATE nor
-- the DELETE trigger). The balance row moves only by an in-batch delta under its bounds CHECK.
--
-- contract: nothing is dropped except the leaf being rebuilt, and no existing row changes.
ALTER TABLE `ledger_account` ADD `code` text CHECK (`code` IS NULL OR length(`code`) > 0);--> statement-breakpoint
ALTER TABLE `ledger_account` ADD `statement_section` text CHECK (`statement_section` IS NULL
        OR (`type` = 'asset' AND `statement_section` IN ('cash', 'currentAssets', 'fixedAssets', 'otherAssets', 'trustAssets'))
        OR (`type` = 'liability' AND `statement_section` IN ('currentLiabilities', 'longTermLiabilities', 'clientTrustLiability'))
        OR (`type` = 'equity' AND `statement_section` IN ('equity'))
        OR (`type` = 'income' AND `statement_section` IN ('feeIncome', 'otherIncome'))
        OR (`type` = 'expense' AND `statement_section` IN ('costOfServices', 'operatingExpenses', 'otherExpenses')));--> statement-breakpoint
ALTER TABLE `ledger_account` ADD `system_account` integer DEFAULT 0 NOT NULL CHECK (`system_account` IN (0, 1));--> statement-breakpoint
ALTER TABLE `ledger_account` ADD `description` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_account_code_unique_index` ON `ledger_account` (`code`) WHERE "ledger_account"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `ledger_account_statement_section_index` ON `ledger_account` (`statement_section`);--> statement-breakpoint
CREATE TABLE `operating_bank_account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`bank_name` text,
	`account_number_last_four` text,
	`ledger_account_id` text NOT NULL,
	`currency` text NOT NULL,
	`opened_on` text NOT NULL,
	`closed_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "operating_bank_account_name_nonempty_check" CHECK(length("operating_bank_account"."name") > 0),
	CONSTRAINT "operating_bank_account_currency_check" CHECK("operating_bank_account"."currency" = 'USD'),
	CONSTRAINT "operating_bank_account_opened_on_shape_check" CHECK("operating_bank_account"."opened_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "operating_bank_account_last_four_check" CHECK("operating_bank_account"."account_number_last_four" IS NULL OR (length("operating_bank_account"."account_number_last_four") = 4 AND "operating_bank_account"."account_number_last_four" GLOB '[0-9][0-9][0-9][0-9]'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operating_bank_account_ledger_account_unique_index` ON `operating_bank_account` (`ledger_account_id`);--> statement-breakpoint
CREATE TABLE `vendor_default_account` (
	`vendor_id` text PRIMARY KEY NOT NULL,
	`ledger_account_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vendor_bill` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`bill_reference` text,
	`bill_date` text NOT NULL,
	`due_date` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`memo` text,
	`entry_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vendor_bill_amount_positive_check" CHECK("vendor_bill"."amount_minor" > 0),
	CONSTRAINT "vendor_bill_currency_check" CHECK("vendor_bill"."currency" = 'USD'),
	CONSTRAINT "vendor_bill_bill_date_shape_check" CHECK("vendor_bill"."bill_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "vendor_bill_due_date_shape_check" CHECK("vendor_bill"."due_date" IS NULL OR "vendor_bill"."due_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "vendor_bill_due_after_bill_check" CHECK("vendor_bill"."due_date" IS NULL OR "vendor_bill"."due_date" >= "vendor_bill"."bill_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_bill_entry_unique_index` ON `vendor_bill` (`entry_id`);--> statement-breakpoint
CREATE INDEX `vendor_bill_vendor_index` ON `vendor_bill` (`vendor_id`,`bill_date`);--> statement-breakpoint
CREATE INDEX `vendor_bill_due_date_index` ON `vendor_bill` (`due_date`);--> statement-breakpoint
CREATE TABLE `vendor_bill_balance` (
	`vendor_bill_id` text PRIMARY KEY NOT NULL,
	`amount_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`vendor_bill_id`) REFERENCES `vendor_bill`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vendor_bill_balance_bounds_check" CHECK("vendor_bill_balance"."paid_minor" >= 0 AND "vendor_bill_balance"."paid_minor" <= "vendor_bill_balance"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE `vendor_bill_line` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_bill_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`disbursement_class` text,
	`matter_id` text,
	`disbursement_entry_id` text,
	`ledger_account_id` text NOT NULL,
	FOREIGN KEY (`vendor_bill_id`) REFERENCES `vendor_bill`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`disbursement_entry_id`) REFERENCES `cost_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vendor_bill_line_amount_positive_check" CHECK("vendor_bill_line"."amount_minor" > 0),
	CONSTRAINT "vendor_bill_line_index_check" CHECK("vendor_bill_line"."line_index" >= 0),
	CONSTRAINT "vendor_bill_line_description_nonempty_check" CHECK(length("vendor_bill_line"."description") > 0),
	CONSTRAINT "vendor_bill_line_disbursement_class_check" CHECK("vendor_bill_line"."disbursement_class" IS NULL OR "vendor_bill_line"."disbursement_class" IN ('hard', 'soft')),
	CONSTRAINT "vendor_bill_line_matter_shape_check" CHECK(("vendor_bill_line"."matter_id" IS NOT NULL AND "vendor_bill_line"."disbursement_class" IS NOT NULL AND "vendor_bill_line"."disbursement_entry_id" IS NOT NULL)
        OR ("vendor_bill_line"."matter_id" IS NULL AND "vendor_bill_line"."disbursement_class" IS NULL AND "vendor_bill_line"."disbursement_entry_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_bill_line_index_unique_index` ON `vendor_bill_line` (`vendor_bill_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `vendor_bill_line_matter_index` ON `vendor_bill_line` (`matter_id`);--> statement-breakpoint
CREATE TABLE `vendor_bill_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_bill_id` text NOT NULL,
	`operating_bank_account_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`paid_on` text NOT NULL,
	`method` text NOT NULL,
	`check_number` integer,
	`reference` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`vendor_bill_id`) REFERENCES `vendor_bill`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operating_bank_account_id`) REFERENCES `operating_bank_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vendor_bill_payment_amount_positive_check" CHECK("vendor_bill_payment"."amount_minor" > 0),
	CONSTRAINT "vendor_bill_payment_paid_on_shape_check" CHECK("vendor_bill_payment"."paid_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "vendor_bill_payment_method_check" CHECK("vendor_bill_payment"."method" IN ('check', 'bank_transfer', 'card', 'cash')),
	CONSTRAINT "vendor_bill_payment_check_number_check" CHECK("vendor_bill_payment"."check_number" IS NULL OR ("vendor_bill_payment"."method" = 'check' AND "vendor_bill_payment"."check_number" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_bill_payment_entry_unique_index` ON `vendor_bill_payment` (`entry_id`);--> statement-breakpoint
CREATE INDEX `vendor_bill_payment_bill_index` ON `vendor_bill_payment` (`vendor_bill_id`);--> statement-breakpoint
CREATE INDEX `vendor_bill_payment_account_index` ON `vendor_bill_payment` (`operating_bank_account_id`,`paid_on`);--> statement-breakpoint
CREATE TABLE `vendor_bill_reversal` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_bill_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`reason` text NOT NULL,
	`reversed_by` text NOT NULL,
	`reversed_at` text NOT NULL,
	FOREIGN KEY (`vendor_bill_id`) REFERENCES `vendor_bill`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vendor_bill_reversal_reason_nonempty_check" CHECK(length(trim("vendor_bill_reversal"."reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_bill_reversal_bill_unique_index` ON `vendor_bill_reversal` (`vendor_bill_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_firm_account_role` (
	`role` text PRIMARY KEY NOT NULL,
	`ledger_account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_account_role_role_check" CHECK("__new_firm_account_role"."role" IN ('accounts_receivable', 'fee_income', 'client_costs_advanced', 'cost_recovery_income', 'tax_payable', 'fee_adjustments', 'fee_write_off', 'operating_bank', 'client_credit_liability', 'accounts_payable', 'owners_equity'))
);
--> statement-breakpoint
INSERT INTO `__new_firm_account_role`("role", "ledger_account_id", "created_at", "updated_at") SELECT "role", "ledger_account_id", "created_at", "updated_at" FROM `firm_account_role`;--> statement-breakpoint
DROP TABLE `firm_account_role`;--> statement-breakpoint
ALTER TABLE `__new_firm_account_role` RENAME TO `firm_account_role`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TRIGGER `vendor_bill_no_update` BEFORE UPDATE ON `vendor_bill` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_no_delete` BEFORE DELETE ON `vendor_bill` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_no_replace` BEFORE INSERT ON `vendor_bill` WHEN EXISTS (SELECT 1 FROM `vendor_bill` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'vendor_bill is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_line_no_update` BEFORE UPDATE ON `vendor_bill_line` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_line_no_delete` BEFORE DELETE ON `vendor_bill_line` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_line_no_replace` BEFORE INSERT ON `vendor_bill_line` WHEN EXISTS (SELECT 1 FROM `vendor_bill_line` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_payment_no_update` BEFORE UPDATE ON `vendor_bill_payment` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_payment is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_payment_no_delete` BEFORE DELETE ON `vendor_bill_payment` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_payment is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_payment_no_replace` BEFORE INSERT ON `vendor_bill_payment` WHEN EXISTS (SELECT 1 FROM `vendor_bill_payment` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_payment is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_reversal_no_update` BEFORE UPDATE ON `vendor_bill_reversal` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_reversal is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_reversal_no_delete` BEFORE DELETE ON `vendor_bill_reversal` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_reversal is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_reversal_no_replace` BEFORE INSERT ON `vendor_bill_reversal` WHEN EXISTS (SELECT 1 FROM `vendor_bill_reversal` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_reversal is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_balance_shape` BEFORE UPDATE ON `vendor_bill_balance` WHEN NEW.`amount_minor` <> OLD.`amount_minor` OR NEW.`vendor_bill_id` <> OLD.`vendor_bill_id` BEGIN
  SELECT RAISE(ABORT, 'a vendor bill amount never changes');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_balance_no_delete` BEFORE DELETE ON `vendor_bill_balance` BEGIN
  SELECT RAISE(ABORT, 'vendor_bill_balance rows are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_payment_not_reversed` BEFORE INSERT ON `vendor_bill_payment` WHEN EXISTS (SELECT 1 FROM `vendor_bill_reversal` WHERE `vendor_bill_id` = NEW.`vendor_bill_id`) BEGIN
  SELECT RAISE(ABORT, 'a reversed vendor bill takes no payment');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_payment_open_account` BEFORE INSERT ON `vendor_bill_payment` WHEN (SELECT `closed_at` FROM `operating_bank_account` WHERE `id` = NEW.`operating_bank_account_id`) IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'a closed operating account pays nothing');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_reversal_unpaid` BEFORE INSERT ON `vendor_bill_reversal` WHEN EXISTS (SELECT 1 FROM `vendor_bill_payment` WHERE `vendor_bill_id` = NEW.`vendor_bill_id`) BEGIN
  SELECT RAISE(ABORT, 'a vendor bill with payments is not reversed');
END;
--> statement-breakpoint
CREATE TRIGGER `operating_bank_account_ledger_account_fixed` BEFORE UPDATE ON `operating_bank_account` WHEN NEW.`ledger_account_id` <> OLD.`ledger_account_id` OR NEW.`currency` <> OLD.`currency` BEGIN
  SELECT RAISE(ABORT, 'an operating bank account keeps its ledger account');
END;
--> statement-breakpoint
CREATE TRIGGER `operating_bank_account_no_delete` BEFORE DELETE ON `operating_bank_account` BEGIN
  SELECT RAISE(ABORT, 'an operating bank account is closed, never deleted');
END;--> statement-breakpoint
-- Entering and paying vendor bills spends the firm's money: seeded onto Admin and Billing, the two
-- roles that already hold billing:apply and billing:configure between them.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_payablesManageAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'payables:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_payablesManageBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'payables:manage');
