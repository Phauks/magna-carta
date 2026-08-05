-- Three-way trust reconciliation — the bank statement and its lines, the reconciliation record whose
-- close freezes its proof, and the human-confirmed matches between a statement line and a recorded
-- movement. Hand-written rather than drizzle-kit-generated because of the triggers at the end of this
-- file: append-only on all four tables, a one-way freeze on the reconciliation, and the structural
-- rules that keep a match inside the reconciliation it belongs to. Table and column comments live
-- beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `trust_bank_statement` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`opening_balance_minor` integer NOT NULL,
	`closing_balance_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`statement_reference` text,
	`source` text NOT NULL,
	`supersedes_statement_id` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`supersedes_statement_id`) REFERENCES `trust_bank_statement`(`id`),
	CONSTRAINT `trust_bank_statement_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_bank_statement_period_order_check` CHECK (`period_end` >= `period_start`),
	CONSTRAINT `trust_bank_statement_source_check` CHECK (`source` IN ('entered', 'imported'))
);
--> statement-breakpoint
-- A statement is superseded at most once; a second correction supersedes the correction.
CREATE UNIQUE INDEX `trust_bank_statement_supersedes_unique_index` ON `trust_bank_statement` (`supersedes_statement_id`);--> statement-breakpoint
CREATE INDEX `trust_bank_statement_account_period_index` ON `trust_bank_statement` (`trust_account_id`,`period_end`);--> statement-breakpoint
CREATE TABLE `trust_bank_statement_line` (
	`id` text PRIMARY KEY NOT NULL,
	`statement_id` text NOT NULL,
	`posted_on` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`counterparty_name` text,
	`source_row_number` integer,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `trust_bank_statement`(`id`),
	CONSTRAINT `trust_bank_statement_line_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_bank_statement_line_description_nonempty_check` CHECK (length(`description`) > 0),
	CONSTRAINT `trust_bank_statement_line_direction_check` CHECK (`direction` IN ('deposit', 'withdrawal')),
	CONSTRAINT `trust_bank_statement_line_source_row_check` CHECK (`source_row_number` IS NULL OR `source_row_number` > 0)
);
--> statement-breakpoint
CREATE INDEX `trust_bank_statement_line_statement_posted_index` ON `trust_bank_statement_line` (`statement_id`,`posted_on`);--> statement-breakpoint
-- Matching draws candidates by amount before anything else, so the amount leads this index.
CREATE INDEX `trust_bank_statement_line_amount_index` ON `trust_bank_statement_line` (`amount_minor`,`statement_id`);--> statement-breakpoint
CREATE TABLE `trust_reconciliation` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`status` text NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`frozen_statement_closing_minor` integer,
	`frozen_outstanding_deposits_minor` integer,
	`frozen_outstanding_disbursements_minor` integer,
	`frozen_adjusted_bank_minor` integer,
	`frozen_book_balance_minor` integer,
	`frozen_client_total_minor` integer,
	`frozen_unmatched_line_count` integer,
	`frozen_unmatched_movement_count` integer,
	`frozen_balanced` integer,
	`supersedes_reconciliation_id` text,
	`note` text,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`statement_id`) REFERENCES `trust_bank_statement`(`id`),
	FOREIGN KEY (`supersedes_reconciliation_id`) REFERENCES `trust_reconciliation`(`id`),
	CONSTRAINT `trust_reconciliation_status_check` CHECK (`status` IN ('open', 'closed')),
	CONSTRAINT `trust_reconciliation_shape_check` CHECK ((`status` = 'open' AND `closed_by` IS NULL AND `closed_at` IS NULL AND `frozen_statement_closing_minor` IS NULL AND `frozen_outstanding_deposits_minor` IS NULL AND `frozen_outstanding_disbursements_minor` IS NULL AND `frozen_adjusted_bank_minor` IS NULL AND `frozen_book_balance_minor` IS NULL AND `frozen_client_total_minor` IS NULL AND `frozen_unmatched_line_count` IS NULL AND `frozen_unmatched_movement_count` IS NULL AND `frozen_balanced` IS NULL) OR (`status` = 'closed' AND `closed_by` IS NOT NULL AND `closed_at` IS NOT NULL AND `frozen_statement_closing_minor` IS NOT NULL AND `frozen_outstanding_deposits_minor` IS NOT NULL AND `frozen_outstanding_disbursements_minor` IS NOT NULL AND `frozen_adjusted_bank_minor` IS NOT NULL AND `frozen_book_balance_minor` IS NOT NULL AND `frozen_client_total_minor` IS NOT NULL AND `frozen_unmatched_line_count` IS NOT NULL AND `frozen_unmatched_movement_count` IS NOT NULL AND `frozen_balanced` IN (0, 1))),
	CONSTRAINT `trust_reconciliation_outstanding_sign_check` CHECK ((`frozen_outstanding_deposits_minor` IS NULL OR `frozen_outstanding_deposits_minor` >= 0) AND (`frozen_outstanding_disbursements_minor` IS NULL OR `frozen_outstanding_disbursements_minor` >= 0) AND (`frozen_unmatched_line_count` IS NULL OR `frozen_unmatched_line_count` >= 0) AND (`frozen_unmatched_movement_count` IS NULL OR `frozen_unmatched_movement_count` >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_reconciliation_supersedes_unique_index` ON `trust_reconciliation` (`supersedes_reconciliation_id`);--> statement-breakpoint
CREATE INDEX `trust_reconciliation_account_opened_index` ON `trust_reconciliation` (`trust_account_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `trust_reconciliation_statement_index` ON `trust_reconciliation` (`statement_id`);--> statement-breakpoint
CREATE TABLE `trust_reconciliation_match` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`statement_line_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`unmatches_match_id` text,
	`matched_by` text NOT NULL,
	`matched_at` text NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_reconciliation`(`id`),
	FOREIGN KEY (`statement_line_id`) REFERENCES `trust_bank_statement_line`(`id`),
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`),
	FOREIGN KEY (`unmatches_match_id`) REFERENCES `trust_reconciliation_match`(`id`)
);
--> statement-breakpoint
-- A match is withdrawn at most once. Two members withdrawing the same match concurrently leave one
-- row and the loser's whole batch aborts, which is the same mechanism the hold release uses.
CREATE UNIQUE INDEX `trust_reconciliation_match_unmatches_unique_index` ON `trust_reconciliation_match` (`unmatches_match_id`);--> statement-breakpoint
CREATE INDEX `trust_reconciliation_match_reconciliation_index` ON `trust_reconciliation_match` (`reconciliation_id`);--> statement-breakpoint
CREATE INDEX `trust_reconciliation_match_line_index` ON `trust_reconciliation_match` (`statement_line_id`);--> statement-breakpoint
CREATE INDEX `trust_reconciliation_match_entry_index` ON `trust_reconciliation_match` (`entry_id`);--> statement-breakpoint
-- A match names a line on the statement its reconciliation is about. Without this a member could tie
-- a movement to a line from an entirely different period, and the proof would then subtract an
-- outstanding item that never appeared on the statement it is being proved against.
CREATE TRIGGER `trust_reconciliation_match_line_on_statement` BEFORE INSERT ON `trust_reconciliation_match`
WHEN (SELECT `statement_id` FROM `trust_bank_statement_line` WHERE `id` = NEW.`statement_line_id`)
  <> (SELECT `statement_id` FROM `trust_reconciliation` WHERE `id` = NEW.`reconciliation_id`)
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation match names a line on the statement that reconciliation is about');
END;
--> statement-breakpoint
-- And it names an entry that actually touched this account's trust bank account. An entry from
-- somewhere else clearing here would remove a real item from a different account's outstanding list
-- while leaving this account's bank side unexplained — a discrepancy hidden in two places at once.
-- The test is over ledger lines rather than over trust_movement because an earned-fee transfer out
-- of trust posts a bank-affecting entry and no movement row at all.
CREATE TRIGGER `trust_reconciliation_match_entry_on_account` BEFORE INSERT ON `trust_reconciliation_match`
WHEN NOT EXISTS (
  SELECT 1 FROM `ledger_line` l
    JOIN `trust_account` a ON a.`bank_ledger_account_id` = l.`account_id`
    JOIN `trust_reconciliation` r ON r.`trust_account_id` = a.`id`
   WHERE l.`entry_id` = NEW.`entry_id` AND r.`id` = NEW.`reconciliation_id`)
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation match names a ledger entry that touched this trust account''s bank account');
END;
--> statement-breakpoint
-- A closed reconciliation attested to a particular set of matches, so its set can never grow or
-- shrink afterwards. Redoing the period is a new reconciliation naming the one it supersedes.
CREATE TRIGGER `trust_reconciliation_match_only_while_open` BEFORE INSERT ON `trust_reconciliation_match`
WHEN (SELECT `status` FROM `trust_reconciliation` WHERE `id` = NEW.`reconciliation_id`) <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'this reconciliation is closed; open a new one rather than changing what a closed one attested to');
END;
--> statement-breakpoint
-- A withdrawal releases a match in its own reconciliation and repeats exactly what that match tied
-- together — the same discipline a hold release follows, so that "what is still matched" stays a
-- question about rows rather than about which row a reader believes.
CREATE TRIGGER `trust_reconciliation_match_unmatch_agrees` BEFORE INSERT ON `trust_reconciliation_match`
WHEN NEW.`unmatches_match_id` IS NOT NULL
  AND (SELECT `reconciliation_id` || '|' || `statement_line_id` || '|' || `entry_id` FROM `trust_reconciliation_match` WHERE `id` = NEW.`unmatches_match_id`)
   <> (NEW.`reconciliation_id` || '|' || NEW.`statement_line_id` || '|' || NEW.`entry_id`)
BEGIN
  SELECT RAISE(ABORT, 'a withdrawal names the reconciliation, statement line, and ledger entry of the match it releases');
END;
--> statement-breakpoint
-- A withdrawal withdraws a match, never another withdrawal. Chaining them would make "is this match
-- active" a walk of unbounded length instead of the single anti-join every reader uses.
CREATE TRIGGER `trust_reconciliation_match_unmatch_is_a_match` BEFORE INSERT ON `trust_reconciliation_match`
WHEN NEW.`unmatches_match_id` IS NOT NULL
  AND (SELECT `unmatches_match_id` FROM `trust_reconciliation_match` WHERE `id` = NEW.`unmatches_match_id`) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation match withdrawal names a match, not another withdrawal');
END;
--> statement-breakpoint
-- THE FREEZE, and it runs one way. A closed reconciliation is an attestation about a moment: what it
-- said is what it said, and a reversal posted next week with a backdated effective date must not
-- rewrite it. Reopening is not an operation — the correction is a new reconciliation.
CREATE TRIGGER `trust_reconciliation_no_reopen` BEFORE UPDATE ON `trust_reconciliation`
WHEN OLD.`status` <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'a closed trust reconciliation is frozen; record a new one that supersedes it');
END;
--> statement-breakpoint
-- The only permitted update is the close itself. Everything that says WHAT the reconciliation is
-- about is fixed at the moment it was opened, so a close cannot quietly re-aim it at another
-- statement and freeze a proof about something else.
CREATE TRIGGER `trust_reconciliation_close_only` BEFORE UPDATE ON `trust_reconciliation`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`trust_account_id` <> OLD.`trust_account_id`
  OR NEW.`statement_id` <> OLD.`statement_id`
  OR NEW.`opened_by` <> OLD.`opened_by`
  OR NEW.`opened_at` <> OLD.`opened_at`
  OR NEW.`status` <> 'closed'
  OR COALESCE(NEW.`supersedes_reconciliation_id`, '') <> COALESCE(OLD.`supersedes_reconciliation_id`, '')
BEGIN
  SELECT RAISE(ABORT, 'the only update a trust reconciliation takes is its close');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_no_delete` BEFORE DELETE ON `trust_reconciliation` BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a row a plain UPDATE cannot touch. A BEFORE INSERT guard that aborts when
-- the id already exists DOES fire on the insert half of a REPLACE. Normal inserts carry fresh random
-- ids, so the guard's existence check never matches on the happy path.
CREATE TRIGGER `trust_reconciliation_no_replace` BEFORE INSERT ON `trust_reconciliation` WHEN EXISTS (SELECT 1 FROM `trust_reconciliation` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation is append-only');
END;
--> statement-breakpoint
-- Append-only, the discipline every evidentiary trust table already carries. What the bank said, and
-- what a person asserted about it, are the record; an editable one says whatever the last writer
-- wanted. A statement that came in wrong is superseded, and a match that was wrong is withdrawn.
CREATE TRIGGER `trust_bank_statement_no_update` BEFORE UPDATE ON `trust_bank_statement` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_no_delete` BEFORE DELETE ON `trust_bank_statement` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_no_replace` BEFORE INSERT ON `trust_bank_statement` WHEN EXISTS (SELECT 1 FROM `trust_bank_statement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_line_no_update` BEFORE UPDATE ON `trust_bank_statement_line` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_line_no_delete` BEFORE DELETE ON `trust_bank_statement_line` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_line_no_replace` BEFORE INSERT ON `trust_bank_statement_line` WHEN EXISTS (SELECT 1 FROM `trust_bank_statement_line` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_no_update` BEFORE UPDATE ON `trust_reconciliation_match` BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation_match is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_no_delete` BEFORE DELETE ON `trust_reconciliation_match` BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation_match is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_no_replace` BEFORE INSERT ON `trust_reconciliation_match` WHEN EXISTS (SELECT 1 FROM `trust_reconciliation_match` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation_match is append-only');
END;
