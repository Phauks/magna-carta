-- Two-person trust disbursement authorization — the pending request and the single decision that
-- settles it. Hand-written rather than drizzle-kit-generated because of the triggers at the end of
-- this file: append-only on both tables, and the approver-differs rule itself, which is structural
-- rather than a convention the route layer is trusted to remember. Table and column comments live
-- beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `trust_disbursement_request` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`node_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`payee` text NOT NULL,
	`purpose` text NOT NULL,
	`description` text NOT NULL,
	`effective_date` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`),
	CONSTRAINT `trust_disbursement_request_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_disbursement_request_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_disbursement_request_method_check` CHECK (`method` IN ('check', 'cash', 'wire', 'electronic_transfer', 'card')),
	CONSTRAINT `trust_disbursement_request_payee_nonempty_check` CHECK (length(`payee`) > 0),
	CONSTRAINT `trust_disbursement_request_purpose_nonempty_check` CHECK (length(`purpose`) > 0),
	CONSTRAINT `trust_disbursement_request_description_nonempty_check` CHECK (length(`description`) > 0)
);
--> statement-breakpoint
CREATE INDEX `trust_disbursement_request_account_requested_at_index` ON `trust_disbursement_request` (`trust_account_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `trust_disbursement_request_node_index` ON `trust_disbursement_request` (`node_id`);--> statement-breakpoint
CREATE TABLE `trust_disbursement_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`decision` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` text NOT NULL,
	`reason` text,
	`authorization_basis` text,
	`movement_id` text,
	FOREIGN KEY (`request_id`) REFERENCES `trust_disbursement_request`(`id`),
	FOREIGN KEY (`movement_id`) REFERENCES `trust_movement`(`id`),
	CONSTRAINT `trust_disbursement_decision_decision_check` CHECK (`decision` IN ('approved', 'rejected', 'withdrawn')),
	CONSTRAINT `trust_disbursement_decision_basis_check` CHECK (`authorization_basis` IS NULL OR `authorization_basis` IN ('second_person', 'sole_trust_manager')),
	CONSTRAINT `trust_disbursement_decision_shape_check` CHECK ((`decision` = 'approved' AND `authorization_basis` IS NOT NULL AND `movement_id` IS NOT NULL AND `reason` IS NULL) OR (`decision` = 'rejected' AND `authorization_basis` IS NULL AND `movement_id` IS NULL AND length(`reason`) > 0) OR (`decision` = 'withdrawn' AND `authorization_basis` IS NULL AND `movement_id` IS NULL AND (`reason` IS NULL OR length(`reason`) > 0)))
);
--> statement-breakpoint
-- One decision per request. Two members approving the same request concurrently both compose a
-- movement; the loser's whole batch — ledger entry, lines, balances, movement row, and this row —
-- aborts here, which is why the decision and the posting are deliberately one batch.
CREATE UNIQUE INDEX `trust_disbursement_decision_request_unique_index` ON `trust_disbursement_decision` (`request_id`);--> statement-breakpoint
-- SQLite UNIQUE permits many NULLs, so rejections and withdrawals are unaffected; an approval claims
-- exactly one movement, and no second decision can claim the same one.
CREATE UNIQUE INDEX `trust_disbursement_decision_movement_unique_index` ON `trust_disbursement_decision` (`movement_id`);--> statement-breakpoint
-- THE two-person rule. Enforced here rather than in the route because the whole value of a
-- second-person control is that it cannot be skipped: a route is one code path among the several
-- that will eventually reach this table, and a rule that lives in one of them protects only that
-- one. A withdrawal is excluded because withdrawing is the submitter's own act, and the
-- `sole_trust_manager` basis is excluded because that is precisely the recorded exception — guarded
-- by its own triggers below.
CREATE TRIGGER `trust_disbursement_decision_approver_differs` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` <> 'withdrawn'
  AND (NEW.`authorization_basis` IS NULL OR NEW.`authorization_basis` <> 'sole_trust_manager')
  AND NEW.`decided_by` = (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'a trust disbursement must be decided by a member other than the one who requested it');
END;
--> statement-breakpoint
-- A withdrawal is the submitter taking their own request back. Anyone else who wants it stopped
-- rejects it, which is a recorded refusal with a reason rather than a silent disappearance.
CREATE TRIGGER `trust_disbursement_decision_withdrawal_by_requester` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'withdrawn'
  AND NEW.`decided_by` <> (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'only the member who requested a trust disbursement may withdraw it; another member rejects it with a reason');
END;
--> statement-breakpoint
-- The sole-manager exception means what it says: the submitter approved their own request. An
-- approval on that basis by a DIFFERENT member would be an ordinary second-person approval wearing
-- the exception's name, and the exception is the one record an examiner will read closely.
CREATE TRIGGER `trust_disbursement_decision_sole_basis_is_self` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` = 'sole_trust_manager'
  AND NEW.`decided_by` <> (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'the sole-trust-manager basis records a submitter approving their own request; a different approver is an ordinary second-person approval');
END;
--> statement-breakpoint
-- And the exception is only available to a firm that genuinely has nobody else: the moment a second
-- ACTIVE member holds the trust capability, this refuses, and the firm is back on the two-person
-- rule with no code change and no setting. Expiring direct grants are counted regardless of their
-- expiry — over-counting authorizers refuses the exception, which is the safe direction to be wrong
-- in, and a trigger that read the wall clock would make the database's answer depend on when it was
-- asked.
CREATE TRIGGER `trust_disbursement_decision_sole_basis_requires_lone_manager` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` = 'sole_trust_manager'
  AND (SELECT COUNT(*) FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:manage' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:manage' AND m.`status` = 'active'
      )) > 1
BEGIN
  SELECT RAISE(ABORT, 'this firm has more than one member who can authorize a trust disbursement, so a second member must approve it');
END;
--> statement-breakpoint
-- Append-only, the discipline every evidentiary trust table already carries. What was proposed, and
-- what was decided about it, are the record; an editable one says whatever the last writer wanted.
-- A request whose particulars were wrong is withdrawn and re-submitted, not amended.
CREATE TRIGGER `trust_disbursement_request_no_update` BEFORE UPDATE ON `trust_disbursement_request` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_request is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_request_no_delete` BEFORE DELETE ON `trust_disbursement_request` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_request is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a row a plain UPDATE cannot touch. A BEFORE INSERT guard that aborts when
-- the id already exists DOES fire on the insert half of a REPLACE. Normal inserts carry fresh random
-- ids, so the guard's existence check never matches on the happy path.
CREATE TRIGGER `trust_disbursement_request_no_replace` BEFORE INSERT ON `trust_disbursement_request` WHEN EXISTS (SELECT 1 FROM `trust_disbursement_request` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_request is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_no_update` BEFORE UPDATE ON `trust_disbursement_decision` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_no_delete` BEFORE DELETE ON `trust_disbursement_decision` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_no_replace` BEFORE INSERT ON `trust_disbursement_decision` WHEN EXISTS (SELECT 1 FROM `trust_disbursement_decision` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
