-- Billing — corrections after finalization: the credit note, the client credit it can open, and the
-- source, posting, and reason columns the write-off and the reversal need on the application row.
--
-- Hand-written rather than drizzle-kit-generated because of the append-only and shape triggers at
-- the foot of this file, which drizzle-kit cannot model. Table and column comments live beside the
-- Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- The premise the whole file rests on: a finalized invoice is frozen by trigger and there is no
-- un-finalize, so nothing here edits one. A credit note is a second permanent record standing beside
-- the first; a write-off and a reversal are append-only application rows; and the invoice's own
-- total never moves, so what the client was told stays what the client was told.
CREATE TABLE `credit_note` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`currency` text NOT NULL,
	`reason` text NOT NULL,
	`effective_date` text NOT NULL,
	`entry_id` text NOT NULL,
	`issued_by` text,
	`issued_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`),
	CONSTRAINT `credit_note_currency_check` CHECK (length(`currency`) = 3),
	-- Not optional and not a code. A credit note is read years later by somebody reconstructing a fee
	-- dispute, and a reason vocabulary the platform invented would flatten the one fact only the firm
	-- has.
	CONSTRAINT `credit_note_reason_nonempty_check` CHECK (length(trim(`reason`)) > 0)
);
--> statement-breakpoint
CREATE INDEX `credit_note_invoice_index` ON `credit_note` (`invoice_id`);--> statement-breakpoint
-- One note, one posting. A second note sharing an entry would mean two corrections crediting the
-- receivable once between them, which is the subledger-versus-control-account drift the whole
-- application model exists to make impossible.
CREATE UNIQUE INDEX `credit_note_entry_unique_index` ON `credit_note` (`entry_id`);--> statement-breakpoint
CREATE TABLE `credit_note_line` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`credits_invoice_line_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_note`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`credits_invoice_line_id`) REFERENCES `invoice_line`(`id`),
	-- POSITIVE, unlike an invoice line. An invoice line may be negative because a discount is one
	-- line among many on a document whose direction is "you owe us"; a credit note's direction is the
	-- document's, so its lines carry magnitude only. The ledger's own rule, one level up.
	CONSTRAINT `credit_note_line_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `credit_note_line_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `credit_note_line_kind_check` CHECK (`kind` IN ('fee', 'cost', 'flat_fee', 'discount', 'adjustment', 'interest', 'tax'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_line_index_unique_index` ON `credit_note_line` (`credit_note_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `credit_note_line_matter_index` ON `credit_note_line` (`matter_id`);--> statement-breakpoint
-- The read behind "what has already been charged, net of what has since been credited" — the
-- question a fee derived from a basis has to ask before it charges its increment.
CREATE INDEX `credit_note_line_credits_index` ON `credit_note_line` (`credits_invoice_line_id`);--> statement-breakpoint
CREATE TABLE `client_credit` (
	`id` text PRIMARY KEY NOT NULL,
	`client_entity_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`credit_note_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`discharged_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`opened_by` text,
	`opened_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_note`(`id`),
	CONSTRAINT `client_credit_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `client_credit_currency_check` CHECK (length(`currency`) = 3),
	-- The guarantee, and the reason there is no status column. Two discharges racing for the same
	-- remainder both read it as available; the second one drives `discharged_minor` past `amount_minor`
	-- and aborts its WHOLE batch, ledger entry included. `account_balance` and `invoice_matter_balance`
	-- are the same arrangement for the same reason: D1 has no interactive transactions, so a bounds
	-- CHECK is the only mechanism that can abort a batch on a business condition.
	CONSTRAINT `client_credit_bounds_check` CHECK (`discharged_minor` >= 0 AND `discharged_minor` <= `amount_minor`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_credit_note_matter_unique_index` ON `client_credit` (`credit_note_id`,`matter_id`);--> statement-breakpoint
CREATE INDEX `client_credit_client_index` ON `client_credit` (`client_entity_id`);--> statement-breakpoint
CREATE INDEX `client_credit_matter_index` ON `client_credit` (`matter_id`);--> statement-breakpoint
ALTER TABLE `invoice_application` ADD `credit_note_id` text REFERENCES credit_note(id);--> statement-breakpoint
ALTER TABLE `invoice_application` ADD `client_credit_id` text REFERENCES client_credit(id);--> statement-breakpoint
ALTER TABLE `invoice_application` ADD `entry_id` text REFERENCES ledger_entry(id);--> statement-breakpoint
ALTER TABLE `invoice_application` ADD `reason` text;--> statement-breakpoint
CREATE INDEX `invoice_application_credit_note_index` ON `invoice_application` (`credit_note_id`);--> statement-breakpoint
CREATE INDEX `invoice_application_client_credit_index` ON `invoice_application` (`client_credit_id`);--> statement-breakpoint
-- APPEND-ONLY, unconditionally. A credit note that could be edited would let a correction the firm
-- has already given a client be quietly restated after its posting had moved the ledger; a wrong
-- credit note is answered by a further correction, never by rewriting this one.
CREATE TRIGGER `credit_note_no_update` BEFORE UPDATE ON `credit_note` BEGIN
  SELECT RAISE(ABORT, 'credit_note is append-only; a wrong credit note is answered by a further correction, never by an edit');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_no_delete` BEFORE DELETE ON `credit_note` BEGIN
  SELECT RAISE(ABORT, 'credit_note is append-only; a wrong credit note is answered by a further correction, never by a deletion');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default). A BEFORE
-- INSERT guard that aborts when the key already exists DOES fire on the insert half, and never
-- matches on the happy path, where the identifier is freshly generated.
CREATE TRIGGER `credit_note_no_replace` BEFORE INSERT ON `credit_note` WHEN EXISTS (SELECT 1 FROM `credit_note` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'credit_note is append-only; an INSERT OR REPLACE would rewrite an issued correction');
END;
--> statement-breakpoint
-- A CREDIT NOTE CORRECTS A FINALIZED BILL, AND ONLY A FINALIZED BILL. A draft is a working document
-- and the correction for a wrong draft is to edit it; a voided draft asserted nothing to anybody.
-- Issuing a note against either would create a permanent correction to a document that never became
-- evidence, and would leave the note's posting crediting a receivable that was never debited.
CREATE TRIGGER `credit_note_requires_finalized_invoice` BEFORE INSERT ON `credit_note`
WHEN NOT EXISTS (SELECT 1 FROM `invoice` WHERE `id` = NEW.`invoice_id` AND `status` = 'final') BEGIN
  SELECT RAISE(ABORT, 'a credit note corrects a finalized invoice; a draft is edited and a voided draft asserted nothing');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_line_no_update` BEFORE UPDATE ON `credit_note_line` BEGIN
  SELECT RAISE(ABORT, 'credit_note_line is append-only; it is frozen with the note it belongs to');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_line_no_delete` BEFORE DELETE ON `credit_note_line` BEGIN
  SELECT RAISE(ABORT, 'credit_note_line is append-only; it is frozen with the note it belongs to');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_line_no_replace` BEFORE INSERT ON `credit_note_line` WHEN EXISTS (SELECT 1 FROM `credit_note_line` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'credit_note_line is append-only; an INSERT OR REPLACE would rewrite an issued correction');
END;
--> statement-breakpoint
-- A LINE CREDITS A CHARGE ON THE BILL ITS NOTE CORRECTS, on the same matter. The attribution is what
-- lets "already charged" mean "charged and not since credited", so a link pointing at another bill's
-- line, or at another matter's, would subtract a credit from a charge it has nothing to do with.
CREATE TRIGGER `credit_note_line_credits_a_line_of_the_same_bill` BEFORE INSERT ON `credit_note_line`
WHEN NEW.`credits_invoice_line_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `invoice_line` l
    JOIN `credit_note` n ON n.`id` = NEW.`credit_note_id`
   WHERE l.`id` = NEW.`credits_invoice_line_id`
     AND l.`invoice_id` = n.`invoice_id`
     AND l.`matter_id` = NEW.`matter_id`
) BEGIN
  SELECT RAISE(ABORT, 'a credit note line may only credit a line of the invoice it corrects, on its own matter');
END;
--> statement-breakpoint
-- The frozen half of a client credit. Everything about the obligation — whose it is, which matter it
-- arose on, which note opened it, and how much it was — is fixed at birth; only the running total of
-- what has been given back moves, and only inside a posting batch. Written as a shape trigger rather
-- than an append-only one because that one column has to move: it is the bounds CHECK's subject, and
-- the CHECK is what makes a concurrent double discharge abort rather than overdraw.
CREATE TRIGGER `client_credit_only_discharge_moves` BEFORE UPDATE ON `client_credit`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`client_entity_id` <> OLD.`client_entity_id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`credit_note_id` <> OLD.`credit_note_id`
  OR NEW.`amount_minor` <> OLD.`amount_minor`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`opened_at` <> OLD.`opened_at`
  OR COALESCE(NEW.`opened_by`, '') <> COALESCE(OLD.`opened_by`, '') BEGIN
  SELECT RAISE(ABORT, 'a client credit records an obligation that was fixed when it opened; only the amount discharged moves');
END;
--> statement-breakpoint
CREATE TRIGGER `client_credit_no_delete` BEFORE DELETE ON `client_credit` BEGIN
  SELECT RAISE(ABORT, 'client_credit is never deleted; money the firm has conceded is not its own does not stop existing because a row was removed');
END;
--> statement-breakpoint
CREATE TRIGGER `client_credit_no_replace` BEFORE INSERT ON `client_credit` WHEN EXISTS (SELECT 1 FROM `client_credit` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'client_credit is never overwritten; an INSERT OR REPLACE would erase an open obligation');
END;
--> statement-breakpoint
-- THE SOURCE PAIRING, one trigger per kind, because SQLite cannot widen a table CHECK without a
-- destructive rebuild and these columns arrived after the table did. Same job the
-- trust_transfer_paired and reversal_paired CHECKs do for the kinds that shipped first: the
-- provenance column and the kind agree, in both directions, so a row cannot claim to be a credit
-- note without naming one or name one without being one.
CREATE TRIGGER `invoice_application_credit_note_paired` BEFORE INSERT ON `invoice_application`
WHEN (NEW.`kind` = 'credit_note') <> (NEW.`credit_note_id` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'a credit_note application names the note it came from, and nothing else may');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_client_credit_paired` BEFORE INSERT ON `invoice_application`
WHEN (NEW.`kind` = 'client_credit') <> (NEW.`client_credit_id` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'a client_credit application names the credit it draws on, and nothing else may');
END;
--> statement-breakpoint
-- BILLING COMPOSES NO LEDGER ENTRY FOR A TRUST APPLICATION, now enforced by the database rather than
-- by a rule a caller has to remember. A transfer out of a client ledger is two linked entries
-- composed by the trust package, and its operating leg has ALREADY credited accounts receivable; a
-- second credit composed here would leave the ledger balanced, every entry valid, nothing failing —
-- and the receivable control account drifting below the invoice subledger by the total of every
-- trust-funded fee the firm has ever taken.
--
-- The credit note is the other side of the same rule: it is one posting across however many
-- per-matter applications it produces, and that posting is recorded on the note. Every remaining
-- kind is one posting per application and records it here. So the pairing is: no entry for those
-- two, exactly one for the rest.
CREATE TRIGGER `invoice_application_entry_paired` BEFORE INSERT ON `invoice_application`
WHEN (NEW.`kind` IN ('trust_transfer', 'credit_note')) <> (NEW.`entry_id` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a trust transfer''s posting is trust''s and a credit note''s sits on the note; every other application records its own');
END;
--> statement-breakpoint
-- A WRITE-OFF AND A REVERSAL STATE WHY. A firm giving up a receivable, or unwinding value it had
-- already applied, is exactly the entry a bar audit or an accountant asks about, and an unexplained
-- one is indistinguishable from a mistake.
CREATE TRIGGER `invoice_application_reason_required` BEFORE INSERT ON `invoice_application`
WHEN NEW.`kind` IN ('write_off', 'reversal')
 AND (NEW.`reason` IS NULL OR length(trim(NEW.`reason`)) = 0) BEGIN
  SELECT RAISE(ABORT, 'a write-off and a reversal each state why; an unexplained one is indistinguishable from a mistake');
END;
