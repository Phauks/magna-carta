-- The bank-charge carve-out and the unclaimed-funds diligence file.
--
-- Two independent additions that share a migration because they land in one slice.
--
-- `trust_firm_funds_movement` is the record beside an entry touching the firm's OWN money in a trust
-- account — the cushion the professional-conduct rules permit a firm to keep there to bear the
-- institution's service charges. The narrowness is in the SHAPE: the table has no node, matter,
-- client, or payee column, so a row of it cannot describe a movement of anybody else's money.
--
-- The three unclaimed-funds tables are a diligence file and nothing else. No row in them moves
-- money, and none of them carries a dormancy flag or a deadline: dormancy is a read-time comparison
-- over the movement rows the ledger already has, and a closure attaches a disbursement that already
-- happened rather than composing one.
--
-- Everything below is APPEND-ONLY, enforced by the triggers at the foot of this file, on the same
-- reasoning that keeps every other trust record append-only: a correction is a new row.
--
-- Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
CREATE TABLE `trust_firm_funds_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`entry_id` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`description` text NOT NULL,
	`recorded_by` text NOT NULL,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_firm_funds_movement_amount_positive_check" CHECK("trust_firm_funds_movement"."amount_minor" > 0),
	CONSTRAINT "trust_firm_funds_movement_currency_check" CHECK(length("trust_firm_funds_movement"."currency") = 3),
	CONSTRAINT "trust_firm_funds_movement_description_nonempty_check" CHECK(length("trust_firm_funds_movement"."description") > 0),
	CONSTRAINT "trust_firm_funds_movement_kind_check" CHECK("trust_firm_funds_movement"."kind" IN ('firm_funds_deposit', 'bank_charge')),
	CONSTRAINT "trust_firm_funds_movement_shape_check" CHECK(("trust_firm_funds_movement"."kind" = 'bank_charge' AND "trust_firm_funds_movement"."method" = 'bank_debit')
        OR ("trust_firm_funds_movement"."kind" = 'firm_funds_deposit' AND "trust_firm_funds_movement"."method" <> 'bank_debit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_firm_funds_movement_entry_unique_index` ON `trust_firm_funds_movement` (`entry_id`);--> statement-breakpoint
CREATE INDEX `trust_firm_funds_movement_account_effective_date_index` ON `trust_firm_funds_movement` (`trust_account_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `trust_unclaimed_funds_contact_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`channel` text NOT NULL,
	`attempted_on` text NOT NULL,
	`contact_used` text,
	`outcome` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `trust_unclaimed_funds_review`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_unclaimed_funds_contact_attempt_channel_check" CHECK("trust_unclaimed_funds_contact_attempt"."channel" IN ('regular_mail', 'certified_mail', 'telephone', 'email', 'record_review', 'other')),
	CONSTRAINT "trust_unclaimed_funds_contact_attempt_outcome_check" CHECK("trust_unclaimed_funds_contact_attempt"."outcome" IN ('no_response', 'undeliverable', 'reached', 'declined', 'wrong_contact', 'other')),
	CONSTRAINT "trust_unclaimed_funds_contact_attempt_shape_check" CHECK(("trust_unclaimed_funds_contact_attempt"."channel" = 'record_review' AND "trust_unclaimed_funds_contact_attempt"."contact_used" IS NULL)
        OR ("trust_unclaimed_funds_contact_attempt"."channel" <> 'record_review' AND "trust_unclaimed_funds_contact_attempt"."contact_used" IS NOT NULL AND length("trust_unclaimed_funds_contact_attempt"."contact_used") > 0))
);
--> statement-breakpoint
CREATE INDEX `trust_unclaimed_funds_contact_attempt_review_index` ON `trust_unclaimed_funds_contact_attempt` (`review_id`,`attempted_on`);--> statement-breakpoint
CREATE TABLE `trust_unclaimed_funds_review` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`node_id` text NOT NULL,
	`observed_balance_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`observed_earliest_receipt_date` text,
	`observed_last_activity_date` text,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_unclaimed_funds_review_balance_positive_check" CHECK("trust_unclaimed_funds_review"."observed_balance_minor" > 0),
	CONSTRAINT "trust_unclaimed_funds_review_currency_check" CHECK(length("trust_unclaimed_funds_review"."currency") = 3)
);
--> statement-breakpoint
CREATE INDEX `trust_unclaimed_funds_review_account_index` ON `trust_unclaimed_funds_review` (`trust_account_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `trust_unclaimed_funds_review_node_index` ON `trust_unclaimed_funds_review` (`node_id`);--> statement-breakpoint
CREATE TABLE `trust_unclaimed_funds_review_closure` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`outcome` text NOT NULL,
	`movement_id` text,
	`closed_by` text NOT NULL,
	`closed_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`review_id`) REFERENCES `trust_unclaimed_funds_review`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movement_id`) REFERENCES `trust_movement`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_unclaimed_funds_review_closure_outcome_check" CHECK("trust_unclaimed_funds_review_closure"."outcome" IN ('distributed_to_owner', 'resolved_without_distribution', 'not_dormant', 'search_continues')),
	CONSTRAINT "trust_unclaimed_funds_review_closure_shape_check" CHECK(("trust_unclaimed_funds_review_closure"."outcome" = 'distributed_to_owner' AND "trust_unclaimed_funds_review_closure"."movement_id" IS NOT NULL)
        OR ("trust_unclaimed_funds_review_closure"."outcome" <> 'distributed_to_owner' AND "trust_unclaimed_funds_review_closure"."movement_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_unclaimed_funds_review_closure_review_unique_index` ON `trust_unclaimed_funds_review_closure` (`review_id`);--> statement-breakpoint
ALTER TABLE `trust_reconciliation` ADD `frozen_firm_funds_minor` integer;
--> statement-breakpoint
-- APPEND-ONLY. A firm-funds movement that could be edited would let a bank charge be quietly
-- restated after a reconciliation had already accounted for it; a correction is a reversing entry
-- with its own row, exactly as it is on trust_movement.
CREATE TRIGGER `trust_firm_funds_movement_no_update` BEFORE UPDATE ON `trust_firm_funds_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_firm_funds_movement is append-only; correct a firm-funds movement with a reversing entry and its own record');
END;--> statement-breakpoint
CREATE TRIGGER `trust_firm_funds_movement_no_delete` BEFORE DELETE ON `trust_firm_funds_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_firm_funds_movement is append-only; correct a firm-funds movement with a reversing entry and its own record');
END;--> statement-breakpoint
CREATE TRIGGER `trust_firm_funds_movement_no_replace` BEFORE INSERT ON `trust_firm_funds_movement` WHEN EXISTS (SELECT 1 FROM `trust_firm_funds_movement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_firm_funds_movement is append-only; an INSERT OR REPLACE would rewrite a recorded movement');
END;--> statement-breakpoint
-- THE CARVE-OUT'S OWN NODE, AND ONLY IT. A firm-funds movement addresses the single `firm_funds`
-- node of the account it names; a row on an account that never opened one would be a record of money
-- the ledger has no place to hold. The trigger is here as well as in the composer because a route is
-- one code path among several that will reach this table.
CREATE TRIGGER `trust_firm_funds_movement_requires_firm_funds_node` BEFORE INSERT ON `trust_firm_funds_movement`
WHEN NOT EXISTS (
  SELECT 1 FROM `trust_ledger_node` n WHERE n.`trust_account_id` = NEW.`trust_account_id` AND n.`kind` = 'firm_funds'
) BEGIN
  SELECT RAISE(ABORT, 'this trust account keeps none of the firm''s own funds; open the bank-charge carve-out on it before recording a firm-funds movement against it');
END;--> statement-breakpoint
-- APPEND-ONLY across the whole diligence file. An attempt that was made cannot be un-made, an
-- observation somebody acted on cannot be restated afterwards, and a closure is the one row that
-- ends a review — which is what makes the file evidence rather than a working note.
CREATE TRIGGER `trust_unclaimed_funds_review_no_update` BEFORE UPDATE ON `trust_unclaimed_funds_review` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review is append-only; a review records what a person saw when they opened it');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_no_delete` BEFORE DELETE ON `trust_unclaimed_funds_review` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review is append-only; a review that was opened stays opened');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_no_replace` BEFORE INSERT ON `trust_unclaimed_funds_review` WHEN EXISTS (SELECT 1 FROM `trust_unclaimed_funds_review` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review is append-only; an INSERT OR REPLACE would rewrite a recorded review');
END;--> statement-breakpoint
-- A REVIEW IS ABOUT A CLIENT'S MATTER LEDGER, under the account it names. A review over a roll-up
-- would be a diligence file about a balance that is always zero; one over the firm-funds node would
-- be the firm searching for itself.
CREATE TRIGGER `trust_unclaimed_funds_review_node_is_a_matter_leaf` BEFORE INSERT ON `trust_unclaimed_funds_review`
WHEN NOT EXISTS (
  SELECT 1 FROM `trust_ledger_node` n WHERE n.`id` = NEW.`node_id` AND n.`kind` = 'matter' AND n.`trust_account_id` = NEW.`trust_account_id`
) BEGIN
  SELECT RAISE(ABORT, 'an unclaimed-funds review is about one client matter ledger under the trust account it names');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_no_update` BEFORE UPDATE ON `trust_unclaimed_funds_contact_attempt` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_contact_attempt is append-only; correct an attempt by recording a further one that says so');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_no_delete` BEFORE DELETE ON `trust_unclaimed_funds_contact_attempt` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_contact_attempt is append-only; an attempt that was made cannot be un-made');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_no_replace` BEFORE INSERT ON `trust_unclaimed_funds_contact_attempt` WHEN EXISTS (SELECT 1 FROM `trust_unclaimed_funds_contact_attempt` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_contact_attempt is append-only; an INSERT OR REPLACE would rewrite a recorded attempt');
END;--> statement-breakpoint
-- NOTHING IS ADDED TO A CLOSED FILE. A further attempt after the closure belongs to a new review,
-- which is what makes each round of diligence readable as a round.
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_review_is_open` BEFORE INSERT ON `trust_unclaimed_funds_contact_attempt`
WHEN EXISTS (
  SELECT 1 FROM `trust_unclaimed_funds_review_closure` c WHERE c.`review_id` = NEW.`review_id`
) BEGIN
  SELECT RAISE(ABORT, 'this unclaimed-funds review is closed; record a further attempt against a new review');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_closure_no_update` BEFORE UPDATE ON `trust_unclaimed_funds_review_closure` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review_closure is append-only; a review is closed once, and a later round is a new review');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_closure_no_delete` BEFORE DELETE ON `trust_unclaimed_funds_review_closure` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review_closure is append-only; a closed review cannot be reopened');
END;--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_closure_no_replace` BEFORE INSERT ON `trust_unclaimed_funds_review_closure` WHEN EXISTS (SELECT 1 FROM `trust_unclaimed_funds_review_closure` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review_closure is append-only; an INSERT OR REPLACE would rewrite a recorded closure');
END;--> statement-breakpoint
-- THE MANUAL-CONFIRMATION GATE, PROVEN AT COMMIT. A closure that records a distribution names a
-- disbursement THAT ALREADY EXISTS and that came out of the very ledger under review. The composer
-- checks it and the shape CHECK proves a distribution carries a movement at all, but neither can
-- prove the movement is this ledger's — and a closure naming somebody else's payment would read, on
-- the certification a firm eventually signs, as a search that succeeded.
CREATE TRIGGER `trust_unclaimed_funds_review_closure_movement_is_this_ledger` BEFORE INSERT ON `trust_unclaimed_funds_review_closure`
WHEN NEW.`movement_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `trust_movement` m
    JOIN `trust_unclaimed_funds_review` r ON r.`id` = NEW.`review_id`
   WHERE m.`id` = NEW.`movement_id` AND m.`node_id` = r.`node_id` AND m.`kind` = 'disbursement'
) BEGIN
  SELECT RAISE(ABORT, 'the movement a closure names must be a disbursement from the client ledger under review');
END;
