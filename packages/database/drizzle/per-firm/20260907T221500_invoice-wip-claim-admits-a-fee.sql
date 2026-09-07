-- THE CLAIM TABLE ADMITS A THIRD KIND OF WORK.
--
-- A draft invoice claims work in progress: a time entry, a cost entry, and now a fee entry — the
-- flat charge somebody typed, which until now had no store at all and so could be recorded and
-- never billed. `source_kind` carries a CHECK naming the kinds, and SQLite cannot widen a CHECK in
-- place, so naming a third costs a rebuild. The billing design saw this shape of problem coming for
-- the invoice application kinds and answered it by naming every kind up front; the claim table was
-- not given that treatment, and this migration is the bill for it.
--
-- contract: invoice_wip_claim is dropped after its rows are copied into a replacement. This is a
-- same-transaction table REBUILD, not a data removal — the copy is exhaustive (all eight columns,
-- no predicate, no expression between source and target), the drop and the rename run inside the
-- one migration transaction, and a failure at any point rolls the whole thing back with the
-- original table intact. The CHECK cannot reject a copied row because the change only ADDS a value
-- to the set: every kind that was legal before is still legal.
--
-- invoice_line does not reference this table, but this table references invoice and invoice_line,
-- which is why the file brackets the work in PRAGMA foreign_keys=OFF / ON. The copy preserves every
-- id verbatim and the replacement takes the original's name, so every claim resolves to the invoice
-- and the line it resolved to before. Nothing is re-keyed.
--
-- THE TWO FREEZE TRIGGERS ARE RECREATED BELOW, VERBATIM, AND THAT IS THE POINT OF HAND-WRITING
-- THIS. They are not in the Drizzle schema — they were written by the migration that created this
-- table — so a generated rebuild would drop the table with its triggers and recreate it without
-- them, leaving every finalized invoice's claims editable. Nothing about the resulting database
-- would look wrong. packages/database/test/invoice-wip-claim-rebuild-migration.test.ts seeds a
-- claim on a finalized invoice and asserts both triggers still fire afterwards.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invoice_wip_claim` (
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
	CONSTRAINT `invoice_wip_claim_source_kind_check` CHECK (`source_kind` IN ('time_entry', 'cost_entry', 'fee_entry'))
);
--> statement-breakpoint
INSERT INTO `__new_invoice_wip_claim` (`id`, `invoice_id`, `source_kind`, `source_id`, `invoice_line_id`, `claimed_amount_minor`, `claimed_at`, `released_at`)
SELECT `id`, `invoice_id`, `source_kind`, `source_id`, `invoice_line_id`, `claimed_amount_minor`, `claimed_at`, `released_at` FROM `invoice_wip_claim`;--> statement-breakpoint
DROP TABLE `invoice_wip_claim`;--> statement-breakpoint
ALTER TABLE `__new_invoice_wip_claim` RENAME TO `invoice_wip_claim`;--> statement-breakpoint
-- THE concurrency control that stops two drafts billing the same hour. A guarded
-- `UPDATE … WHERE invoice_id IS NULL` looks like it prevents a double claim and does not: a zero-row
-- UPDATE is not an error in SQLite, so the losing batch commits happily having changed nothing and
-- the losing draft ends up with a line whose entry belongs to somebody else's invoice. This partial
-- index makes the losing INSERT abort its whole batch — a real refusal the caller can retry or
-- report. A released claim leaves the index (released_at is set), so the entry can be claimed again
-- while its history stays readable.
CREATE UNIQUE INDEX `invoice_wip_claim_active_source_unique_index` ON `invoice_wip_claim` (`source_kind`,`source_id`) WHERE `released_at` IS NULL;--> statement-breakpoint
CREATE INDEX `invoice_wip_claim_invoice_index` ON `invoice_wip_claim` (`invoice_id`);--> statement-breakpoint
-- Releasing a claim after finalization would return an entry that has already been billed to
-- unbilled work-in-progress, so the freeze covers claims too. That is the honest consequence of the
-- entry having become evidence. Verbatim from 20260805T230000_billing-invoices.sql.
CREATE TRIGGER `invoice_wip_claim_frozen_no_update` BEFORE UPDATE ON `invoice_wip_claim` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s work-in-progress claims are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_wip_claim_frozen_no_delete` BEFORE DELETE ON `invoice_wip_claim` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s work-in-progress claims are immutable');
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
