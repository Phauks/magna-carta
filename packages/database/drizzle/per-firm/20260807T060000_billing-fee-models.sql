-- The fee models: how a matter is billed, as a versioned per-matter agreement, plus the records the
-- non-hourly models bill from. A fee change is a NEW arrangement version — the old one stays, its
-- valid_to closed by the version that superseded it — because an invoice line records which version
-- it was composed under, and an edited agreement would rewrite what a finalized bill was computed
-- from. Absence of any arrangement means hourly, so no matter needs a backfill.
--
-- Contingency is computed, never stored as a decided number: matter_recovery records the settlement
-- or judgment, and the fee is derived from the agreement's share against those recoveries at the
-- moment the bill is composed. The retainer replenishment request is a record of the ask — it moves
-- no money and writes no trust table; a deposit arrives through trust's own path.
--
-- Hand-written because the version-density and append-only rules are triggers, which drizzle-kit
-- cannot model. Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
CREATE TABLE `matter_billing_arrangement` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`flat_fee_amount_minor` integer,
	`contingency_share_e4` integer,
	`contingency_basis` text,
	`retainer_target_minor` integer,
	`retainer_threshold_minor` integer,
	`advance_deposit_destination` text,
	`currency` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `matter_billing_arrangement_kind_check` CHECK (`kind` IN ('hourly', 'flat_fee', 'contingency', 'retainer')),
	CONSTRAINT `matter_billing_arrangement_version_positive_check` CHECK (`version` > 0),
	CONSTRAINT `matter_billing_arrangement_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `matter_billing_arrangement_kind_shape_check` CHECK ((`kind` = 'flat_fee') = (`flat_fee_amount_minor` IS NOT NULL) AND (`kind` = 'contingency') = (`contingency_share_e4` IS NOT NULL) AND (`kind` = 'contingency') = (`contingency_basis` IS NOT NULL) AND (`kind` = 'retainer') = (`retainer_target_minor` IS NOT NULL) AND (`kind` = 'retainer') = (`retainer_threshold_minor` IS NOT NULL)),
	CONSTRAINT `matter_billing_arrangement_flat_fee_positive_check` CHECK (`flat_fee_amount_minor` IS NULL OR `flat_fee_amount_minor` > 0),
	CONSTRAINT `matter_billing_arrangement_share_bounds_check` CHECK (`contingency_share_e4` IS NULL OR (`contingency_share_e4` > 0 AND `contingency_share_e4` <= 10000)),
	CONSTRAINT `matter_billing_arrangement_retainer_bounds_check` CHECK (`retainer_target_minor` IS NULL OR (`retainer_target_minor` > 0 AND `retainer_threshold_minor` >= 0 AND `retainer_threshold_minor` <= `retainer_target_minor`)),
	CONSTRAINT `matter_billing_arrangement_destination_check` CHECK (`advance_deposit_destination` IS NULL OR `advance_deposit_destination` IN ('trust', 'operating'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_billing_arrangement_version_unique_index` ON `matter_billing_arrangement` (`matter_id`,`version`);--> statement-breakpoint
-- One IN-FORCE arrangement per matter: the open row (valid_to null) is the agreement, and a new
-- version closes it in the same batch it lands in.
CREATE UNIQUE INDEX `matter_billing_arrangement_open_unique_index` ON `matter_billing_arrangement` (`matter_id`) WHERE `valid_to` IS NULL;--> statement-breakpoint
-- Versions are DENSE per matter, and the next one is the only one the database accepts: two members
-- amending the agreement concurrently both compute the same next version, and the loser aborts here
-- or on the unique index rather than interleaving. "The version in force" is therefore always
-- well-defined, with no timestamp tie to break.
CREATE TRIGGER `matter_billing_arrangement_version_dense` BEFORE INSERT ON `matter_billing_arrangement`
WHEN NEW.`version` <> (SELECT COALESCE(MAX(`version`), 0) + 1 FROM `matter_billing_arrangement` WHERE `matter_id` = NEW.`matter_id`)
BEGIN
  SELECT RAISE(ABORT, 'a billing arrangement version must be the next version for its matter; re-read the agreement in force and amend it again');
END;
--> statement-breakpoint
-- Append-only amendment history: the ONLY edit a row ever takes is closing its valid_to when a newer
-- version supersedes it, exactly once. Everything else — the kind, the amounts, the dates, even a
-- second write to valid_to — is refused, because an invoice references the version in force and a
-- changed version would rewrite what a finalized bill was computed under.
CREATE TRIGGER `matter_billing_arrangement_close_only` BEFORE UPDATE ON `matter_billing_arrangement`
WHEN OLD.`valid_to` IS NOT NULL
  OR NEW.`valid_to` IS NULL
  OR NEW.`id` <> OLD.`id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`version` <> OLD.`version`
  OR NEW.`kind` <> OLD.`kind`
  OR NEW.`flat_fee_amount_minor` IS NOT OLD.`flat_fee_amount_minor`
  OR NEW.`contingency_share_e4` IS NOT OLD.`contingency_share_e4`
  OR NEW.`contingency_basis` IS NOT OLD.`contingency_basis`
  OR NEW.`retainer_target_minor` IS NOT OLD.`retainer_target_minor`
  OR NEW.`retainer_threshold_minor` IS NOT OLD.`retainer_threshold_minor`
  OR NEW.`advance_deposit_destination` IS NOT OLD.`advance_deposit_destination`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`valid_from` <> OLD.`valid_from`
  OR NEW.`created_at` <> OLD.`created_at`
  OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN
  SELECT RAISE(ABORT, 'a billing arrangement is append-only: a fee change is a new version, and the only edit an open version takes is closing its valid_to when superseded');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_billing_arrangement_no_delete` BEFORE DELETE ON `matter_billing_arrangement` BEGIN
  SELECT RAISE(ABORT, 'matter_billing_arrangement is append-only: history is the point, and a version an invoice was computed under must outlive the agreement that superseded it');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_billing_arrangement_no_replace` BEFORE INSERT ON `matter_billing_arrangement` WHEN EXISTS (SELECT 1 FROM `matter_billing_arrangement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'matter_billing_arrangement is append-only');
END;
--> statement-breakpoint
CREATE TABLE `matter_recovery` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`recovered_date` text NOT NULL,
	`description` text NOT NULL,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `matter_recovery_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `matter_recovery_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `matter_recovery_description_nonempty_check` CHECK (length(`description`) > 0),
	CONSTRAINT `matter_recovery_void_paired_check` CHECK ((`voided_at` IS NULL) = (`void_reason` IS NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_recovery_matter_index` ON `matter_recovery` (`matter_id`);--> statement-breakpoint
-- A recovery is an assertion of fact and takes exactly one edit in its life: the void transition,
-- with a reason, when it was entered in error. The amount, the date, and the description never
-- change — a wrong recovery is voided and re-entered, so both records remain readable.
CREATE TRIGGER `matter_recovery_void_only` BEFORE UPDATE ON `matter_recovery`
WHEN OLD.`voided_at` IS NOT NULL
  OR NEW.`voided_at` IS NULL
  OR NEW.`id` <> OLD.`id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`amount_minor` <> OLD.`amount_minor`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`recovered_date` <> OLD.`recovered_date`
  OR NEW.`description` <> OLD.`description`
  OR NEW.`recorded_by` IS NOT OLD.`recorded_by`
  OR NEW.`recorded_at` <> OLD.`recorded_at`
BEGIN
  SELECT RAISE(ABORT, 'a recorded recovery is corrected by voiding it with a reason and recording a new one, never edited');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_recovery_no_delete` BEFORE DELETE ON `matter_recovery` BEGIN
  SELECT RAISE(ABORT, 'matter_recovery is append-only: a recovery entered in error is voided with a reason, not erased');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_recovery_no_replace` BEFORE INSERT ON `matter_recovery` WHEN EXISTS (SELECT 1 FROM `matter_recovery` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'matter_recovery is append-only');
END;
--> statement-breakpoint
CREATE TABLE `retainer_replenishment_request` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`arrangement_id` text NOT NULL,
	`observed_balance_minor` integer NOT NULL,
	`requested_amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`requested_at` text NOT NULL,
	`requested_by` text,
	`resolved_at` text,
	`resolved_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`arrangement_id`) REFERENCES `matter_billing_arrangement`(`id`),
	CONSTRAINT `retainer_replenishment_request_amount_positive_check` CHECK (`requested_amount_minor` > 0),
	CONSTRAINT `retainer_replenishment_request_observed_not_negative_check` CHECK (`observed_balance_minor` >= 0),
	CONSTRAINT `retainer_replenishment_request_currency_check` CHECK (length(`currency`) = 3)
);
--> statement-breakpoint
-- One OPEN request per matter: a floor that stays crossed must not stack a new ask on every look.
CREATE UNIQUE INDEX `retainer_replenishment_request_open_unique_index` ON `retainer_replenishment_request` (`matter_id`) WHERE `resolved_at` IS NULL;--> statement-breakpoint
CREATE INDEX `retainer_replenishment_request_matter_index` ON `retainer_replenishment_request` (`matter_id`);--> statement-breakpoint
-- The one edit is resolution, once: the observed balance and the ask are the record of why the
-- request was raised and never move afterwards.
CREATE TRIGGER `retainer_replenishment_request_resolve_only` BEFORE UPDATE ON `retainer_replenishment_request`
WHEN OLD.`resolved_at` IS NOT NULL
  OR NEW.`resolved_at` IS NULL
  OR NEW.`id` <> OLD.`id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`arrangement_id` <> OLD.`arrangement_id`
  OR NEW.`observed_balance_minor` <> OLD.`observed_balance_minor`
  OR NEW.`requested_amount_minor` <> OLD.`requested_amount_minor`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`requested_at` <> OLD.`requested_at`
  OR NEW.`requested_by` IS NOT OLD.`requested_by`
BEGIN
  SELECT RAISE(ABORT, 'a replenishment request takes exactly one edit: its resolution');
END;
--> statement-breakpoint
CREATE TRIGGER `retainer_replenishment_request_no_delete` BEFORE DELETE ON `retainer_replenishment_request` BEGIN
  SELECT RAISE(ABORT, 'retainer_replenishment_request is append-only apart from its resolution');
END;
--> statement-breakpoint
CREATE TRIGGER `retainer_replenishment_request_no_replace` BEFORE INSERT ON `retainer_replenishment_request` WHEN EXISTS (SELECT 1 FROM `retainer_replenishment_request` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'retainer_replenishment_request is append-only apart from its resolution');
END;
--> statement-breakpoint
-- The invoice learns how a bill spanning several matters is presented — snapshot at finalize like
-- the letterhead, so a later change to the firm's default never re-shapes a document already given
-- to a client. Null on drafts and on invoices finalized before the column existed, which the render
-- derivation reads as the combined shape.
ALTER TABLE `invoice` ADD COLUMN `render_shape` text CHECK (`render_shape` IS NULL OR `render_shape` IN ('combined', 'per_matter_pages'));--> statement-breakpoint
-- The line learns which fee-agreement version composed it, for the lines an arrangement produces (a
-- flat fee, a contingency fee). Null on hourly and cost lines.
ALTER TABLE `invoice_line` ADD COLUMN `billing_arrangement_id` text REFERENCES `matter_billing_arrangement`(`id`);
