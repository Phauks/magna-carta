-- Billing — the one door value reaches an invoice through. Hand-written rather than
-- drizzle-kit-generated because of the append-only triggers at the end of this file, which
-- drizzle-kit cannot model. Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- An invoice is frozen the moment it is finalized, so value arriving at it can never be an edit to
-- the invoice: it is a new append-only row here plus a delta on invoice_matter_balance.applied_minor,
-- and the bounds CHECK on that balance is what makes over-application structurally impossible rather
-- than merely pre-checked away.
CREATE TABLE `invoice_application` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`trust_transfer_id` text,
	`reverses_application_id` text,
	`effective_date` text NOT NULL,
	`applied_by` text,
	`applied_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`trust_transfer_id`) REFERENCES `trust_transfer`(`id`),
	FOREIGN KEY (`reverses_application_id`) REFERENCES `invoice_application`(`id`),
	-- The whole closed set of kinds, including the four no code writes yet. SQLite cannot widen a
	-- CHECK without rebuilding the table, and a table rebuild is destructive DDL this schema does not
	-- permit against a table holding data — so narrowing this to what ships today would mean the
	-- credit-note and payment paths could never be added additively. The set is the design's, and the
	-- pairing CHECKs below are written so they stay true when the rest of it lands.
	CONSTRAINT `invoice_application_kind_check` CHECK (`kind` IN ('trust_transfer', 'payment', 'credit_note', 'client_credit', 'write_off', 'reversal')),
	-- Amounts are positive and direction is the row's KIND, never a sign — the ledger's rule applied
	-- to the subledger. A reversal carries a positive amount and subtracts because it is a reversal.
	CONSTRAINT `invoice_application_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `invoice_application_currency_check` CHECK (length(`currency`) = 3),
	-- A trust application names the transfer it came from, and nothing else may. This is the column
	-- that lets the no-double-credit rule be re-proved over stored rows: a trust application is
	-- exactly the case where billing composes NO ledger entry, because trust's transfer already
	-- credited accounts receivable on its operating leg.
	CONSTRAINT `invoice_application_trust_transfer_paired_check` CHECK ((`kind` = 'trust_transfer') = (`trust_transfer_id` IS NOT NULL)),
	CONSTRAINT `invoice_application_reversal_paired_check` CHECK ((`kind` = 'reversal') = (`reverses_application_id` IS NOT NULL))
);
--> statement-breakpoint
-- A double reversal is structurally impossible rather than checked: the same precedent as the
-- ledger's reverses_entry_id and trust's releases_hold_id, and for the same reason — the loser of a
-- concurrent pair aborts its whole batch at commit.
CREATE UNIQUE INDEX `invoice_application_reverses_unique_index` ON `invoice_application` (`reverses_application_id`);--> statement-breakpoint
-- The read that answers "what has reached this invoice, and on which matter" — and the read the
-- earned-fee precondition's balance figures are re-derived against.
CREATE INDEX `invoice_application_invoice_matter_index` ON `invoice_application` (`invoice_id`,`matter_id`);--> statement-breakpoint
CREATE INDEX `invoice_application_matter_index` ON `invoice_application` (`matter_id`);--> statement-breakpoint
-- One trust transfer settles one or more applications, so this is an ordinary index rather than a
-- unique one: a single transfer out of a matter's client ledger may pay down two of that client's
-- invoices, and each is its own row.
CREATE INDEX `invoice_application_trust_transfer_index` ON `invoice_application` (`trust_transfer_id`);--> statement-breakpoint
-- Append-only from birth, unconditionally — the discipline trust_transfer, trust_hold, and
-- trust_movement already carry. An application that could be edited would let money that reached an
-- invoice be quietly un-reached: the balance delta it rode with has already moved, so an edit here
-- desynchronizes the subledger from the control account with no record of having done so. A mistaken
-- application is corrected by a REVERSAL row, which is a second permanent record.
CREATE TRIGGER `invoice_application_no_update` BEFORE UPDATE ON `invoice_application` BEGIN
  SELECT RAISE(ABORT, 'invoice_application is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_no_delete` BEFORE DELETE ON `invoice_application` BEGIN
  SELECT RAISE(ABORT, 'invoice_application is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a row a plain UPDATE cannot touch. A BEFORE INSERT guard that aborts when
-- the key already exists DOES fire on the insert half of a REPLACE, and never matches on the happy
-- path, where the identifier is freshly generated.
CREATE TRIGGER `invoice_application_no_replace` BEFORE INSERT ON `invoice_application` WHEN EXISTS (SELECT 1 FROM `invoice_application` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'invoice_application is append-only');
END;
