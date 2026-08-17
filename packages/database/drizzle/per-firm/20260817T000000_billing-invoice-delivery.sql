-- Billing — the record that a bill was given to a client. One append-only row per delivery attempt,
-- so "has this bill been given to the client" becomes a read over rows rather than a guess.
--
-- Hand-written rather than drizzle-kit-generated because of the append-only and precondition triggers
-- at the foot of this file, which drizzle-kit cannot model. Table and column comments live beside the
-- Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- WHY THIS IS A TABLE AND NOT A COLUMN ON THE INVOICE. A bill is delivered possibly several times and
-- possibly by several channels, and a re-send is not a change to the financial record. "Sent" as an
-- invoice status would force the finalized row to stay mutable for its least load-bearing field,
-- which is the one concession that stops an append-only table being one.
--
-- WHAT THIS RECORDS AND WHAT IT DOES NOT. It records that a firm gave a client a bill. It does not
-- transmit one: there is no invoice renderer and no client-facing channel here, and the delivery a
-- firm records is overwhelmingly one it performed itself — handed over at a meeting, posted, emailed
-- from the firm's own mailbox, or submitted to the client's e-billing portal. That is deliberate
-- rather than a shortfall. Several jurisdictions expect a client to have been given a bill before
-- fees are taken from trust, and a platform that could only record deliveries it performed itself
-- would leave every out-of-band delivery unrecordable — which is exactly the firm that most needs to
-- be able to answer the question.
CREATE TABLE `invoice_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`channel` text NOT NULL,
	`recipient_reference` text NOT NULL,
	`delivery_date` text NOT NULL,
	`external_reference` text,
	`outcome` text NOT NULL,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	-- A CLOSED VOCABULARY, and closed now rather than later on purpose: SQLite cannot widen a table
	-- CHECK without a destructive rebuild, so the channels a bill actually reaches a client by are
	-- enumerated once. `client_portal` is here with nothing yet able to produce it — the portal is
	-- unbuilt — because the alternative is a rebuild of a financial-evidence table on the day it
	-- lands.
	CONSTRAINT `invoice_delivery_channel_check` CHECK (`channel` IN ('email', 'post', 'hand', 'client_portal', 'e_billing_gateway')),
	-- WHO IT WENT TO, in the firm's own words: an address, a mailbox, a portal account, or the person
	-- it was handed to. Free text with no structured subject, on the same footing as the contact a
	-- firm records using to reach a client it holds unclaimed money for. Required and non-empty,
	-- because a record whose whole job is to answer "was this given to the client" and which cannot
	-- say who received it answers nothing.
	CONSTRAINT `invoice_delivery_recipient_nonempty_check` CHECK (length(trim(`recipient_reference`)) > 0),
	-- Two values, and the second is why the column exists: a letter comes back, an address is dead, a
	-- gateway submission is rejected. A firm that can only record successes has a delivery history
	-- that reads as complete when it is not, and a reminder sent on the strength of it would be a
	-- reminder about a bill nobody received.
	CONSTRAINT `invoice_delivery_outcome_check` CHECK (`outcome` IN ('delivered', 'failed')),
	-- An external handle only where the channel has one — a tracking number, a gateway submission id,
	-- the message id of a mail sent elsewhere. Present it is the thread back to the system that
	-- carried the bill; absent it means nothing was carried by a system, which is the ordinary case
	-- for hand delivery.
	CONSTRAINT `invoice_delivery_external_reference_nonempty_check` CHECK (`external_reference` IS NULL OR length(trim(`external_reference`)) > 0)
);
--> statement-breakpoint
-- The read the whole table exists for: every attempt on one bill, which is what the apply-funds
-- surface shows before a firm takes a fee out of trust.
CREATE INDEX `invoice_delivery_invoice_index` ON `invoice_delivery` (`invoice_id`);--> statement-breakpoint
-- DELIBERATELY NOT UNIQUE ON ANYTHING. A bill posted and then emailed is two deliveries; a bill
-- posted twice to the same address after the first came back is also two, and the second is the one
-- that matters. Replay of the same request is held off by the idempotency key on the route, which is
-- the layer that knows the difference between a retry and a second attempt.
CREATE INDEX `invoice_delivery_date_index` ON `invoice_delivery` (`delivery_date`);--> statement-breakpoint
-- APPEND-ONLY, unconditionally — the discipline `credit_note`, `trust_hold`, and `trust_movement`
-- carry, for the reason they carry it. This row is the firm's evidence that it discharged an
-- obligation to its client, read years later by somebody reconstructing a fee dispute or a bar
-- audit. Evidence that can be edited after the fact is not evidence.
CREATE TRIGGER `invoice_delivery_no_update` BEFORE UPDATE ON `invoice_delivery` BEGIN
  SELECT RAISE(ABORT, 'invoice_delivery is append-only; a delivery is a dated attempt that either happened or did not, never a row to be restated');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_delivery_no_delete` BEFORE DELETE ON `invoice_delivery` BEGIN
  SELECT RAISE(ABORT, 'invoice_delivery is append-only; removing a recorded delivery would erase the firm''s own evidence that it gave a client a bill');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default). A BEFORE
-- INSERT guard that aborts when the key already exists DOES fire on the insert half, and never
-- matches on the happy path, where the identifier is freshly generated.
CREATE TRIGGER `invoice_delivery_no_replace` BEFORE INSERT ON `invoice_delivery` WHEN EXISTS (SELECT 1 FROM `invoice_delivery` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'invoice_delivery is append-only; an INSERT OR REPLACE would rewrite a recorded delivery');
END;
--> statement-breakpoint
-- A DELIVERY IS OF A FINALIZED BILL, AND ONLY A FINALIZED BILL. Finalization is the transition to
-- evidence: before it, the document is a working draft whose lines can still change, so a delivery
-- recorded against one would claim the client was given a bill that did not exist yet in the form the
-- row asserts. A voided invoice never became evidence at all. Held by trigger rather than by the
-- service alone, because a route is one code path among several that will reach this table.
CREATE TRIGGER `invoice_delivery_requires_finalized_invoice` BEFORE INSERT ON `invoice_delivery`
WHEN NOT EXISTS (SELECT 1 FROM `invoice` WHERE `id` = NEW.`invoice_id` AND `status` = 'final') BEGIN
  SELECT RAISE(ABORT, 'a delivery records that a finalized bill was given to a client; a draft is still being written and a voided draft was never issued');
END;
--> statement-breakpoint
-- A DELIVERY CANNOT PREDATE THE BILL IT DELIVERED. The date is the firm's, not the platform's — an
-- out-of-band delivery is recorded days after it happened and the firm supplies the date it happened
-- on — which is exactly why the one thing that can be checked is checked: a date before the invoice's
-- own issue date describes something that could not have occurred.
CREATE TRIGGER `invoice_delivery_not_before_issue` BEFORE INSERT ON `invoice_delivery`
WHEN EXISTS (SELECT 1 FROM `invoice` WHERE `id` = NEW.`invoice_id` AND `issue_date` IS NOT NULL AND NEW.`delivery_date` < `issue_date`) BEGIN
  SELECT RAISE(ABORT, 'a delivery cannot predate the bill it delivered');
END;
