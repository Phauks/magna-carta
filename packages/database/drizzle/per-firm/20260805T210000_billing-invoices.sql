-- Billing — the invoice spine. Hand-written rather than drizzle-kit-generated because of the
-- triggers at the end of this file: drizzle-kit cannot model a trigger, and the freeze at
-- finalization is structural rather than a convention. Table and column comments live beside the
-- Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- The organizing property is mutability. A DRAFT invoice is a working document and is freely
-- editable; a FINALIZED invoice is an evidentiary financial record and is frozen at the database.
-- The numbering pair is append-only from birth, and the one deliberately mutable row is
-- invoice_matter_balance, whose bounds CHECK is what lets a whole batch abort on a business
-- condition — the same arrangement, for the same reason, as account_balance.
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`client_entity_id` text NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`invoice_number` text,
	`number_scope_key` text,
	`number_drawn_value` integer,
	`billing_period_start` text,
	`billing_period_end` text,
	`issue_date` text,
	`due_date` text,
	`notes` text,
	`location_id` text,
	`letterhead_address_block` text,
	`letterhead_footer` text,
	`remit_to` text,
	`client_billing_name` text,
	`finalized_at` text,
	`finalized_by` text,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`),
	CONSTRAINT `invoice_status_check` CHECK (`status` IN ('draft', 'final', 'void')),
	CONSTRAINT `invoice_currency_check` CHECK (length(`currency`) = 3),
	-- A number exists exactly when the invoice is final: it is drawn INSIDE the finalize batch, so a
	-- failed finalize consumes none and the sequence has no gaps by construction.
	CONSTRAINT `invoice_number_paired_check` CHECK ((`status` = 'final') = (`invoice_number` IS NOT NULL)),
	CONSTRAINT `invoice_number_draw_paired_check` CHECK ((`invoice_number` IS NULL) = (`number_drawn_value` IS NULL) AND (`invoice_number` IS NULL) = (`number_scope_key` IS NULL)),
	CONSTRAINT `invoice_finalized_paired_check` CHECK ((`status` = 'final') = (`finalized_at` IS NOT NULL)),
	CONSTRAINT `invoice_voided_paired_check` CHECK ((`status` = 'void') = (`voided_at` IS NOT NULL)),
	-- A bill the firm has issued states when it was issued and when it is due. Both are null while
	-- the invoice is a working document and required the moment it becomes evidence.
	CONSTRAINT `invoice_dates_final_check` CHECK (`status` <> 'final' OR (`issue_date` IS NOT NULL AND `due_date` IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `invoice_client_status_index` ON `invoice` (`client_entity_id`,`status`);--> statement-breakpoint
-- Aging reads the unpaid receivables by how overdue they are; the status leads because only a
-- finalized invoice is ever aged.
CREATE INDEX `invoice_status_due_date_index` ON `invoice` (`status`,`due_date`);--> statement-breakpoint
-- The keyset composite for the list read, matching the platform's (created_at, id) DESC cursor.
CREATE INDEX `invoice_created_at_id_index` ON `invoice` (`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_unique_index` ON `invoice` (`invoice_number`) WHERE `invoice_number` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`quantity_e4` integer,
	`rate_e4` integer,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`utbms_task_code` text,
	`utbms_activity_code` text,
	`utbms_expense_code` text,
	`tax_treatment` text DEFAULT 'exempt' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `invoice_line_kind_check` CHECK (`kind` IN ('fee', 'cost', 'flat_fee', 'discount', 'adjustment', 'interest', 'tax')),
	-- Deliberately NOT a positive-amount check: a discount, a write-down, or a courtesy adjustment is
	-- an ordinary line with a negative amount, which is why roundInvoiceLine is half-away-from-zero.
	-- The ledger's positive-amounts rule governs ledger_line and is untouched by this.
	CONSTRAINT `invoice_line_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `invoice_line_description_nonempty_check` CHECK (length(`description`) > 0),
	CONSTRAINT `invoice_line_tax_treatment_check` CHECK (`tax_treatment` IN ('taxable', 'exempt')),
	CONSTRAINT `invoice_line_index_check` CHECK (`line_index` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_line_position_unique_index` ON `invoice_line` (`invoice_id`,`line_index`);--> statement-breakpoint
-- "Invoices for this matter" is served from here rather than from a stored invoice.matter_id: a
-- column that is supposed to agree with the lines is a column that will eventually disagree.
CREATE INDEX `invoice_line_matter_index` ON `invoice_line` (`matter_id`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_wip_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`invoice_line_id` text,
	`claimed_amount_minor` integer NOT NULL,
	`claimed_at` text NOT NULL,
	`released_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`invoice_line_id`) REFERENCES `invoice_line`(`id`),
	CONSTRAINT `invoice_wip_claim_source_kind_check` CHECK (`source_kind` IN ('time_entry', 'cost_entry'))
);
--> statement-breakpoint
-- THE concurrency control that stops two drafts billing the same hour. A guarded
-- `UPDATE … WHERE invoice_id IS NULL` looks like it prevents a double claim and does not: a zero-row
-- UPDATE is not an error in SQLite, so the losing batch commits happily having changed nothing and
-- the losing draft ends up with a line whose entry belongs to somebody else's invoice. This partial
-- index makes the losing INSERT abort its whole batch — a real refusal the caller can retry or
-- report. A released claim leaves the index (released_at is set), so the entry can be claimed again
-- while its history stays readable.
CREATE UNIQUE INDEX `invoice_wip_claim_active_source_unique_index` ON `invoice_wip_claim` (`source_kind`,`source_id`) WHERE `released_at` IS NULL;--> statement-breakpoint
CREATE INDEX `invoice_wip_claim_invoice_index` ON `invoice_wip_claim` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_wip_claim_line_index` ON `invoice_wip_claim` (`invoice_line_id`);--> statement-breakpoint
-- One row per (invoice, matter), created in the finalize batch. THE most important table here.
--
-- D1 has no interactive transactions, so a bounds CHECK is the only mechanism that can abort a whole
-- batch on a business condition. Because over-application aborts the batch rather than being
-- pre-checked away, "this invoice has enough unpaid balance" is a structural guarantee rather than a
-- hopeful read — which is what an earned-fee transfer out of a client's trust ledger needs it to be.
--
-- Per (invoice, matter) rather than per invoice because a trust transfer draws on exactly one matter
-- leaf: the ceiling it must respect is that matter's share, not the invoice's total. The
-- invoice-level unpaid balance is a SUM over these rows, and the invoice header carries no total and
-- no balance at all, so a payment never has a reason to touch it.
CREATE TABLE `invoice_matter_balance` (
	`invoice_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`total_minor` integer NOT NULL,
	`applied_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`invoice_id`, `matter_id`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `invoice_matter_balance_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `invoice_matter_balance_bounds_check` CHECK (`applied_minor` >= 0 AND `applied_minor` <= `total_minor`)
);
--> statement-breakpoint
CREATE INDEX `invoice_matter_balance_matter_index` ON `invoice_matter_balance` (`matter_id`);--> statement-breakpoint
-- The invoice-number sequence: a counter per scope, and an allocation row per value consumed. The
-- scope key is the empty string firm-wide and may be per-Location for a firm issuing on two
-- letterheads. The mechanism, and the reasoning that makes it correct, live in
-- packages/sequence-numbering.
CREATE TABLE `invoice_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL,
	CONSTRAINT `invoice_number_counter_next_value_check` CHECK (`next_value` > 0)
);
--> statement-breakpoint
CREATE TABLE `invoice_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`invoice_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY (`scope_key`, `drawn_value`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	CONSTRAINT `invoice_number_allocation_drawn_value_check` CHECK (`drawn_value` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_allocation_invoice_unique_index` ON `invoice_number_allocation` (`invoice_id`);--> statement-breakpoint
-- Which of the firm's ledger accounts plays each role a billing posting needs. The product chart of
-- accounts does not exist yet, and this is the seam that stands in for it: an unmapped role REFUSES
-- finalization by name rather than posting somewhere plausible. A fact we do not have is not a fact
-- we invent. The role set is the stable contract across the boundary the operating chart of accounts
-- will populate.
CREATE TABLE `firm_account_role` (
	`role` text PRIMARY KEY NOT NULL,
	`ledger_account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`),
	CONSTRAINT `firm_account_role_role_check` CHECK (`role` IN ('accounts_receivable', 'fee_income', 'client_costs_advanced', 'cost_recovery_income', 'tax_payable', 'fee_adjustments', 'fee_write_off', 'operating_bank', 'client_credit_liability'))
);
--> statement-breakpoint
-- Finalization is the transition to evidence, and the freeze is at the database rather than in the
-- service. There is no un-finalize and no route back: a finalized invoice that should not have been
-- issued is corrected by a credit note, which is a second permanent record rather than the erasure
-- of the first — the same reasoning as the ledger's reversal rule and trust's rule that a release is
-- a new linked row. `void` is reachable only from `draft`, so an abandoned working document leaves
-- no evidentiary trace to explain away.
--
-- The trigger reads OLD.status, so the finalizing UPDATE itself (draft -> final) passes and every
-- update to the resulting row aborts.
CREATE TRIGGER `invoice_frozen_no_update` BEFORE UPDATE ON `invoice` WHEN OLD.`status` <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_frozen_no_delete` BEFORE DELETE ON `invoice` WHEN OLD.`status` <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_line_frozen_no_update` BEFORE UPDATE ON `invoice_line` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_line_frozen_no_delete` BEFORE DELETE ON `invoice_line` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s lines are immutable');
END;
--> statement-breakpoint
-- Releasing a claim after finalization would return an entry that has already been billed to
-- unbilled work-in-progress, so the freeze covers claims too. That is the honest consequence of the
-- entry having become evidence.
CREATE TRIGGER `invoice_wip_claim_frozen_no_update` BEFORE UPDATE ON `invoice_wip_claim` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s work-in-progress claims are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_wip_claim_frozen_no_delete` BEFORE DELETE ON `invoice_wip_claim` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s work-in-progress claims are immutable');
END;
--> statement-breakpoint
-- The allocation ledger is append-only unconditionally: gaps and re-use in an invoice sequence are
-- the first thing an auditor asks about, and an allocation that could be edited would let a number
-- be quietly handed to a second invoice.
CREATE TRIGGER `invoice_number_allocation_no_update` BEFORE UPDATE ON `invoice_number_allocation` BEGIN
  SELECT RAISE(ABORT, 'invoice_number_allocation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_number_allocation_no_delete` BEFORE DELETE ON `invoice_number_allocation` BEGIN
  SELECT RAISE(ABORT, 'invoice_number_allocation is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a row that a plain UPDATE cannot touch. A BEFORE INSERT guard that aborts
-- when the key already exists DOES fire on the insert half of a REPLACE, and never matches on the
-- happy path — a drawer that finds its value taken is the losing race, which is what the retry is for.
CREATE TRIGGER `invoice_number_allocation_no_replace` BEFORE INSERT ON `invoice_number_allocation` WHEN EXISTS (SELECT 1 FROM `invoice_number_allocation` WHERE `scope_key` = NEW.`scope_key` AND `drawn_value` = NEW.`drawn_value`) BEGIN
  SELECT RAISE(ABORT, 'invoice_number_allocation is append-only');
END;
--> statement-breakpoint
-- Billing permissions, seeded onto the default roles. Six keys, because the capabilities genuinely
-- differ and a firm's shape separates them.
--
-- billing:read reaches the roles that answer "what does this client owe us" in the course of their
-- work — Owner/Admin, Attorney, Paralegal, Billing. billing:draft reaches the same four: assembling
-- a working document asserts nothing to anybody and is exactly the clerical work a billing clerk and
-- a paralegal do. billing:finalize is deliberately narrower — Owner/Admin and Attorney — because
-- finalizing turns a draft into evidence a client is charged on and a fee may be taken from trust
-- against; the common firm shape is a clerk assembling and a partner approving, and this is that
-- shape. billing:apply reaches Owner/Admin, Attorney, and Billing on the same footing trust:manage
-- does. billing:credit reaches Owner/Admin and Attorney, since a credit note walks back a record the
-- firm already gave somebody. billing:configure is Owner/Admin only: the account-role map decides
-- where every billing posting lands.
--
-- Read-only receives none of them, the same deliberate exception the trust keys take.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'billing:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'billing:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:draft');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:draft');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'billing:draft');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'billing:draft');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingFinalizeOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:finalize');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingFinalizeAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:finalize');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingApplyOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:apply');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingApplyAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:apply');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingApplyBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'billing:apply');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingCreditOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:credit');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingCreditAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:credit');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingConfigureOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:configure');
