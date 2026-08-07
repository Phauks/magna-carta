-- The per-firm disbursement-authorization policy: whether money leaving a client ledger takes a
-- second person becomes the firm's own posture — off, threshold, or always, plus an independent
-- requirement that whoever lets money go holds the authority capability (trust:authorize) — instead
-- of a platform-wide rule. Billing's earned-fee application follows the SAME policy through the SAME
-- queue: an application request is a trust_disbursement_request with kind 'earned_fee_application',
-- so one decision table and one trigger set govern every way money leaves a client ledger.
--
-- THE SHIPPED DEFAULT IS THE STRICT ONE. A firm with no policy row keeps exactly the behavior it had
-- before this migration: always two-person, no authority requirement. Nothing relaxes on migrate; a
-- firm relaxes only by writing a policy version, which is itself an append-only audited record.
--
-- AN IN-FLIGHT REQUEST KEEPS ITS POLICY. Requests stamp the policy version current when they were
-- submitted, and every decision trigger reads the STAMP, never the latest row — a posture change
-- governs new authorizations only.
--
-- Hand-written because nearly all of it is triggers, which drizzle-kit cannot model. Table and
-- column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `trust_authorization_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`policy` text NOT NULL,
	`threshold_amount_minor` integer,
	`require_authorized_approver` integer NOT NULL,
	`set_by` text NOT NULL,
	`set_at` text NOT NULL,
	CONSTRAINT `trust_authorization_policy_policy_check` CHECK (`policy` IN ('off', 'threshold', 'always')),
	CONSTRAINT `trust_authorization_policy_threshold_shape_check` CHECK ((`policy` = 'threshold' AND `threshold_amount_minor` IS NOT NULL AND `threshold_amount_minor` >= 0) OR (`policy` <> 'threshold' AND `threshold_amount_minor` IS NULL)),
	CONSTRAINT `trust_authorization_policy_authority_flag_check` CHECK (`require_authorized_approver` IN (0, 1)),
	CONSTRAINT `trust_authorization_policy_version_positive_check` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_authorization_policy_version_unique_index` ON `trust_authorization_policy` (`version`);--> statement-breakpoint
-- Versions are DENSE, and the next one is the only one the database accepts: two members changing
-- the posture concurrently both compute the same next version, and the loser aborts at this trigger
-- or the UNIQUE index rather than interleaving. "The current policy" is therefore always
-- well-defined as MAX(version), with no timestamp tie to break.
CREATE TRIGGER `trust_authorization_policy_version_dense` BEFORE INSERT ON `trust_authorization_policy`
WHEN NEW.`version` <> (SELECT COALESCE(MAX(`version`), 0) + 1 FROM `trust_authorization_policy`)
BEGIN
  SELECT RAISE(ABORT, 'a trust authorization policy version must be the next version; re-read the current policy and change it again');
END;
--> statement-breakpoint
-- Append-only: how a firm's money-movement controls evolved is itself an evidentiary record. A
-- posture change is a new version, never an edit of the row a pending request is stamped with.
CREATE TRIGGER `trust_authorization_policy_no_update` BEFORE UPDATE ON `trust_authorization_policy` BEGIN
  SELECT RAISE(ABORT, 'trust_authorization_policy is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_authorization_policy_no_delete` BEFORE DELETE ON `trust_authorization_policy` BEGIN
  SELECT RAISE(ABORT, 'trust_authorization_policy is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_authorization_policy_no_replace` BEFORE INSERT ON `trust_authorization_policy` WHEN EXISTS (SELECT 1 FROM `trust_authorization_policy` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_authorization_policy is append-only');
END;
--> statement-breakpoint
-- The request learns what its approval will post, where the operating leg's description lives when
-- it posts a transfer, and which policy version it was submitted under.
ALTER TABLE `trust_disbursement_request` ADD COLUMN `kind` text NOT NULL DEFAULT 'disbursement';--> statement-breakpoint
ALTER TABLE `trust_disbursement_request` ADD COLUMN `operating_description` text;--> statement-breakpoint
ALTER TABLE `trust_disbursement_request` ADD COLUMN `policy_id` text REFERENCES `trust_authorization_policy`(`id`);--> statement-breakpoint
-- The kind vocabulary and its shape, as a trigger rather than a CHECK because SQLite cannot widen a
-- CHECK without a table rebuild and this table must stay additively evolvable. An earned-fee
-- application posts a two-legged transfer, so it must carry the operating leg's description; a
-- disbursement has no operating leg to describe.
CREATE TRIGGER `trust_disbursement_request_kind_shape` BEFORE INSERT ON `trust_disbursement_request`
WHEN NEW.`kind` NOT IN ('disbursement', 'earned_fee_application')
  OR (NEW.`kind` = 'earned_fee_application' AND (NEW.`operating_description` IS NULL OR length(NEW.`operating_description`) = 0))
  OR (NEW.`kind` = 'disbursement' AND NEW.`operating_description` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'a trust disbursement request is a disbursement or an earned-fee application, and only an application carries an operating-leg description');
END;
--> statement-breakpoint
-- A new request is stamped with the CURRENT policy version, and no other: a caller who could stamp
-- a superseded version could revive the posture the firm moved away from. When no version exists the
-- stamp is NULL, which every trigger below reads as the shipped default — always two-person.
CREATE TRIGGER `trust_disbursement_request_policy_is_current` BEFORE INSERT ON `trust_disbursement_request`
WHEN EXISTS (SELECT 1 FROM `trust_authorization_policy`)
  AND (NEW.`policy_id` IS NULL OR NEW.`policy_id` <> (SELECT `id` FROM `trust_authorization_policy` ORDER BY `version` DESC LIMIT 1))
BEGIN
  SELECT RAISE(ABORT, 'a trust disbursement request is submitted under the current authorization policy version');
END;
--> statement-breakpoint
-- WIDENING trust_disbursement_decision: the authorization basis gains 'policy_exempt' (the stamped
-- policy did not require a second person and the submitter acted alone under it) and the approval
-- gains transfer_id (an approved earned-fee application posts a transfer, not a movement). Both live
-- inside table CHECK constraints, and SQLite can only replace a CHECK by rebuilding the table.
--
-- contract: the old trust_disbursement_decision is dropped after its rows are copied into the
-- replacement. This is a same-transaction table REBUILD, not a data removal — the copy is exhaustive
-- (every column, no predicate; transfer_id starts NULL on copied rows because no application
-- approvals exist before this migration), the drop and the rename run inside the one migration
-- transaction, and a failure at any point rolls the whole thing back with the original table intact.
-- It is the only way SQLite can replace a CHECK constraint, and it is safe here because nothing
-- references trust_disbursement_decision — every foreign key points out of it.
--
-- The old table's triggers (approver-differs, withdrawal, sole-basis, lone-manager, append-only)
-- drop with the table; their policy-aware replacements are created below.
CREATE TABLE `trust_disbursement_decision_rebuilt` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`decision` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` text NOT NULL,
	`reason` text,
	`authorization_basis` text,
	`movement_id` text,
	`transfer_id` text,
	FOREIGN KEY (`request_id`) REFERENCES `trust_disbursement_request`(`id`),
	FOREIGN KEY (`movement_id`) REFERENCES `trust_movement`(`id`),
	FOREIGN KEY (`transfer_id`) REFERENCES `trust_transfer`(`id`),
	CONSTRAINT `trust_disbursement_decision_decision_check` CHECK (`decision` IN ('approved', 'rejected', 'withdrawn')),
	CONSTRAINT `trust_disbursement_decision_basis_check` CHECK (`authorization_basis` IS NULL OR `authorization_basis` IN ('second_person', 'sole_trust_manager', 'policy_exempt')),
	CONSTRAINT `trust_disbursement_decision_shape_check` CHECK ((`decision` = 'approved' AND `authorization_basis` IS NOT NULL AND `reason` IS NULL AND ((`movement_id` IS NOT NULL AND `transfer_id` IS NULL) OR (`transfer_id` IS NOT NULL AND `movement_id` IS NULL))) OR (`decision` = 'rejected' AND `authorization_basis` IS NULL AND `movement_id` IS NULL AND `transfer_id` IS NULL AND length(`reason`) > 0) OR (`decision` = 'withdrawn' AND `authorization_basis` IS NULL AND `movement_id` IS NULL AND `transfer_id` IS NULL AND (`reason` IS NULL OR length(`reason`) > 0)))
);
--> statement-breakpoint
INSERT INTO `trust_disbursement_decision_rebuilt` (`id`, `request_id`, `decision`, `decided_by`, `decided_at`, `reason`, `authorization_basis`, `movement_id`, `transfer_id`) SELECT `id`, `request_id`, `decision`, `decided_by`, `decided_at`, `reason`, `authorization_basis`, `movement_id`, NULL FROM `trust_disbursement_decision`;--> statement-breakpoint
DROP TABLE `trust_disbursement_decision`;--> statement-breakpoint
ALTER TABLE `trust_disbursement_decision_rebuilt` RENAME TO `trust_disbursement_decision`;--> statement-breakpoint
-- One decision per request; an approval claims exactly one posting, and no second decision can claim
-- the same one. SQLite UNIQUE permits many NULLs, so rejections and withdrawals are unaffected.
CREATE UNIQUE INDEX `trust_disbursement_decision_request_unique_index` ON `trust_disbursement_decision` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_disbursement_decision_movement_unique_index` ON `trust_disbursement_decision` (`movement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_disbursement_decision_transfer_unique_index` ON `trust_disbursement_decision` (`transfer_id`);--> statement-breakpoint
-- Taking back your own request is a withdrawal, not a rejection — independent of any policy, because
-- it is about what the record calls the act, not about who may authorize money.
CREATE TRIGGER `trust_disbursement_decision_rejection_by_requester` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'rejected'
  AND NEW.`decided_by` = (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'only another member may reject a trust disbursement request; the member who submitted it withdraws it instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_withdrawal_by_requester` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'withdrawn'
  AND NEW.`decided_by` <> (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'only the member who requested a trust disbursement may withdraw it; another member rejects it with a reason');
END;
--> statement-breakpoint
-- THE two-person rule, now the firm's policy rather than the platform's. Enforced here rather than
-- in a route because a route is one code path among the several that reach this table. A submitter
-- approving their own request must name the exception basis they act under — sole_trust_manager or
-- policy_exempt — and each of those bases has its own guard below; an unnamed or second_person basis
-- on a self-approval is refused outright.
CREATE TRIGGER `trust_disbursement_decision_approver_differs` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'approved'
  AND (NEW.`authorization_basis` IS NULL OR NEW.`authorization_basis` = 'second_person')
  AND NEW.`decided_by` = (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'a trust disbursement must be decided by a member other than the one who requested it');
END;
--> statement-breakpoint
-- Both exception bases record the submitter acting alone. An approval on either basis by a DIFFERENT
-- member would be an ordinary second-person approval wearing an exception's name, and the exception
-- is the record an examiner reads closely.
CREATE TRIGGER `trust_disbursement_decision_exception_basis_is_self` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` IN ('sole_trust_manager', 'policy_exempt')
  AND NEW.`decided_by` <> (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'an exception basis records a submitter approving their own request; a different approver is an ordinary second-person approval');
END;
--> statement-breakpoint
-- The sole-manager exception is only available to a firm that genuinely has nobody else: the moment
-- a second ACTIVE member holds the trust capability, this refuses. Expiring direct grants count
-- regardless of expiry — over-counting authorizers refuses the exception, the safe direction to be
-- wrong in, and a trigger reading the wall clock would make the answer depend on when it was asked.
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
-- Each exception basis matches the policy stamped on the request — the policy IN FORCE WHEN IT WAS
-- SUBMITTED, never the latest row, which is what makes an in-flight request keep its rules. A NULL
-- stamp is the shipped default: always two-person. sole_trust_manager is for when a second person is
-- required and nobody else exists; policy_exempt is for when the stamp did not require one. Using
-- either where the other applies would misdescribe the approval on its face.
CREATE TRIGGER `trust_disbursement_decision_sole_basis_requires_two_person_policy` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` = 'sole_trust_manager'
  AND (SELECT CASE
         WHEN r.`policy_id` IS NULL THEN 1
         WHEN p.`policy` = 'always' THEN 1
         WHEN p.`policy` = 'threshold' AND r.`amount_minor` > p.`threshold_amount_minor` THEN 1
         ELSE 0 END
       FROM `trust_disbursement_request` r
       LEFT JOIN `trust_authorization_policy` p ON p.`id` = r.`policy_id`
       WHERE r.`id` = NEW.`request_id`) = 0
BEGIN
  SELECT RAISE(ABORT, 'the authorization policy this request was submitted under does not require a second person for this amount; the basis for the submitter acting alone under it is policy_exempt');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_exempt_basis_requires_exempting_policy` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` = 'policy_exempt'
  AND (SELECT CASE
         WHEN r.`policy_id` IS NULL THEN 1
         WHEN p.`policy` = 'always' THEN 1
         WHEN p.`policy` = 'threshold' AND r.`amount_minor` > p.`threshold_amount_minor` THEN 1
         ELSE 0 END
       FROM `trust_disbursement_request` r
       LEFT JOIN `trust_authorization_policy` p ON p.`id` = r.`policy_id`
       WHERE r.`id` = NEW.`request_id`) = 1
BEGIN
  SELECT RAISE(ABORT, 'the authorization policy this request was submitted under requires a second person for this amount');
END;
--> statement-breakpoint
-- The approver-authority option: when the stamped policy requires it, whoever lets money go — a
-- second-person approver or a submitter acting alone under an exception — must be an active member
-- holding trust:authorize, by role or by direct grant. The capability is the predicate, never a role
-- name, so a firm shapes "authority to act" by granting the key.
CREATE TRIGGER `trust_disbursement_decision_approver_holds_authority` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'approved'
  AND (SELECT COALESCE(p.`require_authorized_approver`, 0)
       FROM `trust_disbursement_request` r
       LEFT JOIN `trust_authorization_policy` p ON p.`id` = r.`policy_id`
       WHERE r.`id` = NEW.`request_id`) = 1
  AND NOT EXISTS (SELECT 1 FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:authorize' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:authorize' AND m.`status` = 'active'
      ) WHERE `user_id` = NEW.`decided_by`)
BEGIN
  SELECT RAISE(ABORT, 'this firm requires trust money movement to be authorized by a member holding the authority to act (trust:authorize), and the deciding member does not hold it');
END;
--> statement-breakpoint
-- An approval posts the kind of record its request proposes — a movement for a disbursement, a
-- transfer for an earned-fee application. The shape CHECK already forces exactly one of the two;
-- this pins WHICH one to the request's kind.
CREATE TRIGGER `trust_disbursement_decision_posting_matches_kind` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'approved'
  AND ((SELECT `kind` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`) = 'disbursement') <> (NEW.`movement_id` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'an approval posts what its request proposes: a trust movement for a disbursement, a trust-to-operating transfer for an earned-fee application');
END;
--> statement-breakpoint
-- The posting the decision claims must itself name the deciding member as the one who let the money
-- go, and — for a transfer — must have been composed FROM this request. Without these a decision
-- could ride a batch beside a posting that tells a different story about who authorized what.
CREATE TRIGGER `trust_disbursement_decision_movement_names_decider` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`movement_id` IS NOT NULL
  AND (SELECT `authorized_by` FROM `trust_movement` WHERE `id` = NEW.`movement_id`) IS NOT NEW.`decided_by`
BEGIN
  SELECT RAISE(ABORT, 'the movement an approval posts must name the approving member as the member who authorized it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_transfer_names_decider_and_request` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`transfer_id` IS NOT NULL
  AND ((SELECT `authorized_by` FROM `trust_transfer` WHERE `id` = NEW.`transfer_id`) IS NOT NEW.`decided_by`
    OR (SELECT `approved_request_id` FROM `trust_transfer` WHERE `id` = NEW.`transfer_id`) IS NOT NEW.`request_id`
    OR (SELECT `amount_minor` FROM `trust_transfer` WHERE `id` = NEW.`transfer_id`) <> (SELECT `amount_minor` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`))
BEGIN
  SELECT RAISE(ABORT, 'the transfer an approval posts must name the approving member, the request it was approved from, and the requested amount');
END;
--> statement-breakpoint
-- An approved application settles exactly the invoice lines its request proposed: the lines' sum
-- must equal the request's amount, so nothing leaves trust that the proposal did not account for.
CREATE TRIGGER `trust_disbursement_decision_application_lines_sum` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`transfer_id` IS NOT NULL
  AND (SELECT `amount_minor` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
      <> (SELECT COALESCE(SUM(`amount_minor`), 0) FROM `invoice_trust_application_line` WHERE `request_id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'an earned-fee application settles exactly the invoice amounts its request proposed');
END;
--> statement-breakpoint
-- Append-only, restored byte-for-byte in behaviour around the rebuild. What was decided is the
-- record; an editable one says whatever the last writer wanted.
CREATE TRIGGER `trust_disbursement_decision_no_update` BEFORE UPDATE ON `trust_disbursement_decision` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_no_delete` BEFORE DELETE ON `trust_disbursement_decision` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default). A BEFORE
-- INSERT guard that aborts when the id already exists DOES fire on the insert half of a REPLACE.
CREATE TRIGGER `trust_disbursement_decision_no_replace` BEFORE INSERT ON `trust_disbursement_decision` WHEN EXISTS (SELECT 1 FROM `trust_disbursement_decision` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
-- trust_transfer learns the same two facts trust_movement keeps apart — who recorded, who
-- authorized — plus the policy version governing it and, when it came through the queue, the request
-- it was approved from.
ALTER TABLE `trust_transfer` ADD COLUMN `recorded_by` text;--> statement-breakpoint
ALTER TABLE `trust_transfer` ADD COLUMN `policy_id` text REFERENCES `trust_authorization_policy`(`id`);--> statement-breakpoint
ALTER TABLE `trust_transfer` ADD COLUMN `approved_request_id` text REFERENCES `trust_disbursement_request`(`id`);--> statement-breakpoint
-- Money leaving a client ledger names who entered the record and who let it go — the discipline the
-- movement shape CHECK already imposes on disbursements, imposed here by trigger because SQLite
-- cannot add a NOT NULL constraint to an existing table. Old rows keep their NULLs; every new row
-- carries both.
CREATE TRIGGER `trust_transfer_names_actors` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`recorded_by` IS NULL OR NEW.`authorized_by` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a transfer out of trust names the member who recorded it and the member who authorized it');
END;
--> statement-breakpoint
-- A transfer approved from the queue is composed FROM its request: same submitter recorded, same
-- policy stamp, an application-kind request. The decision row that follows in the same batch pins
-- the approver; this pins everything the transfer itself asserts.
CREATE TRIGGER `trust_transfer_approved_request_shape` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`approved_request_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `trust_disbursement_request` r
        WHERE r.`id` = NEW.`approved_request_id`
          AND r.`kind` = 'earned_fee_application'
          AND r.`requested_by` = NEW.`recorded_by`
          AND r.`policy_id` IS NEW.`policy_id`)
BEGIN
  SELECT RAISE(ABORT, 'a transfer approved from the authorization queue must record the submitting member and carry the policy version stamped on its earned-fee application request');
END;
--> statement-breakpoint
-- A transfer composed DIRECTLY (no queue) is governed by the CURRENT policy and stamps it; only a
-- queued approval may carry an older stamp, and the trigger above pins that stamp to its request —
-- which is how an in-flight application keeps the rules it was submitted against while a direct
-- composer can never revive a superseded posture.
CREATE TRIGGER `trust_transfer_policy_is_current` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`approved_request_id` IS NULL
  AND EXISTS (SELECT 1 FROM `trust_authorization_policy`)
  AND (NEW.`policy_id` IS NULL OR NEW.`policy_id` <> (SELECT `id` FROM `trust_authorization_policy` ORDER BY `version` DESC LIMIT 1))
BEGIN
  SELECT RAISE(ABORT, 'a transfer out of trust is governed by the current authorization policy version');
END;
--> statement-breakpoint
-- The firm's policy applied to the OTHER way money leaves a client ledger. When the governing
-- version requires a second person for this amount, the member who recorded the transfer cannot also
-- be the one who authorized it — unless the firm genuinely has nobody else holding the trust
-- capability, the same lone-manager exception the decision table records explicitly.
CREATE TRIGGER `trust_transfer_requires_second_person` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`recorded_by` = NEW.`authorized_by`
  AND (CASE
         WHEN NEW.`policy_id` IS NULL THEN 1
         WHEN (SELECT `policy` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`) = 'always' THEN 1
         WHEN (SELECT `policy` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`) = 'threshold'
           AND NEW.`amount_minor` > (SELECT `threshold_amount_minor` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`) THEN 1
         ELSE 0 END) = 1
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
  SELECT RAISE(ABORT, 'this firm requires a second person to authorize money leaving a client ledger at this amount; submit it as a pending earned-fee application for another member to approve');
END;
--> statement-breakpoint
-- The approver-authority option, at the transfer: whoever authorized it must hold trust:authorize
-- when the governing policy version requires it.
CREATE TRIGGER `trust_transfer_authorizer_holds_authority` BEFORE INSERT ON `trust_transfer`
WHEN (SELECT COALESCE((SELECT `require_authorized_approver` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`), 0)) = 1
  AND NOT EXISTS (SELECT 1 FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:authorize' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:authorize' AND m.`status` = 'active'
      ) WHERE `user_id` = NEW.`authorized_by`)
BEGIN
  SELECT RAISE(ABORT, 'this firm requires trust money movement to be authorized by a member holding the authority to act (trust:authorize), and the authorizing member does not hold it');
END;
--> statement-breakpoint
-- Billing's side of a pending earned-fee application: the invoice-and-amount lines an approving
-- member is approving.
CREATE TABLE `invoice_trust_application_line` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `trust_disbursement_request`(`id`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	CONSTRAINT `invoice_trust_application_line_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `invoice_trust_application_line_currency_check` CHECK (length(`currency`) = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_trust_application_line_request_invoice_unique_index` ON `invoice_trust_application_line` (`request_id`,`invoice_id`);--> statement-breakpoint
-- A line belongs to an application-kind request in the same currency, and only while that request is
-- undecided: a settled proposal's particulars are frozen, or an approval could be made to have
-- approved something else after the fact.
CREATE TRIGGER `invoice_trust_application_line_request_shape` BEFORE INSERT ON `invoice_trust_application_line`
WHEN NOT EXISTS (SELECT 1 FROM `trust_disbursement_request` r
      WHERE r.`id` = NEW.`request_id` AND r.`kind` = 'earned_fee_application' AND r.`currency` = NEW.`currency`)
  OR EXISTS (SELECT 1 FROM `trust_disbursement_decision` d WHERE d.`request_id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'an application line belongs to a pending earned-fee application request in the same currency');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_trust_application_line_no_update` BEFORE UPDATE ON `invoice_trust_application_line` BEGIN
  SELECT RAISE(ABORT, 'invoice_trust_application_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_trust_application_line_no_delete` BEFORE DELETE ON `invoice_trust_application_line` BEGIN
  SELECT RAISE(ABORT, 'invoice_trust_application_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_trust_application_line_no_replace` BEFORE INSERT ON `invoice_trust_application_line` WHEN EXISTS (SELECT 1 FROM `invoice_trust_application_line` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'invoice_trust_application_line is append-only');
END;
--> statement-breakpoint
-- The authority capability, seeded to the seats whose members have the authority to act on client
-- money by default: Owner/Admin and Attorney. Deliberately narrower than trust:manage (which also
-- reaches Billing): holding the key does nothing until a firm turns the approver-authority option
-- on, and a firm that wants its billing manager to carry authority grants the key — the correction
-- that leaves an audit trail.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustAuthorizeOwner00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'trust:authorize');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustAuthorizeAttorne', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'trust:authorize');
