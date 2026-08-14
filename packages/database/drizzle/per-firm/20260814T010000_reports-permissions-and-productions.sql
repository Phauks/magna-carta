-- The reporting surface: its capabilities, and the record of a report turned into a firm document.
--
-- The five `reports:` keys are seeded to Owner/Admin and to nothing else. That is deliberately
-- narrower than the trust and billing reads a firm already grants more widely: an aggregate spanning
-- every matter and client is a different exposure from a per-matter read, and a member who may read
-- one client's trust balance is not thereby a member who may read every client's ledger in one
-- document. A firm that wants its bookkeeper to run reconciliation packs reaches for a direct grant,
-- which leaves a record; widening a seed later is a conversation nobody has to have, while narrowing
-- one is a conversation with every firm that had got used to the wider default.
--
-- `reports:productivity` is seeded on the same row as the rest and is still its own key, because a
-- report about PEOPLE is a different grant from a report about money: a firm must be able to hand a
-- bookkeeper the financial reports without also handing them a supervision surface over every lawyer.
--
-- The two production tables are the ONE write in the whole reporting surface, and it belongs to the
-- route and the queue consumer rather than to the reporting package, which composes nothing. Both are
-- APPEND-ONLY, enforced by the triggers at the foot of this file: a production is a record that
-- somebody asked for a document on a day, and re-running a period is a new production rather than an
-- edit to the old one. There is no status column on either — whether a production is finished is the
-- presence of its completion row, the same derivation that keeps a status column off `trust_hold`
-- and off `invoice_application`.
--
-- Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsTrustComplianc', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:trustCompliance');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsFinancialOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:financial');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsProductivityOw', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:productivity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsOperationalOwn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:operational');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsProduceOwnerAd', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:produce');--> statement-breakpoint
CREATE TABLE `report_production` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`trust_account_id` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`known_as_of` text,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_production_kind_check" CHECK("report_production"."kind" IN ('trust_compliance')),
	CONSTRAINT "report_production_scope_shape_check" CHECK("report_production"."kind" <> 'trust_compliance' OR "report_production"."trust_account_id" IS NOT NULL),
	CONSTRAINT "report_production_period_ordered_check" CHECK("report_production"."period_start" <= "report_production"."period_end")
);
--> statement-breakpoint
CREATE INDEX `report_production_requested_at_index` ON `report_production` (`requested_at`);--> statement-breakpoint
CREATE INDEX `report_production_trust_account_index` ON `report_production` (`trust_account_id`,`requested_at`);--> statement-breakpoint
CREATE TABLE `report_production_completion` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`outcome` text NOT NULL,
	`file_version_id` text,
	`content_hash` text,
	`refusal_code` text,
	`refusal_detail` text,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `report_production`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_production_completion_outcome_check" CHECK("report_production_completion"."outcome" IN ('filed', 'refused')),
	CONSTRAINT "report_production_completion_shape_check" CHECK(("report_production_completion"."outcome" = 'filed' AND "report_production_completion"."file_version_id" IS NOT NULL AND "report_production_completion"."content_hash" IS NOT NULL AND "report_production_completion"."refusal_code" IS NULL AND "report_production_completion"."refusal_detail" IS NULL)
        OR ("report_production_completion"."outcome" = 'refused' AND "report_production_completion"."file_version_id" IS NULL AND "report_production_completion"."content_hash" IS NULL AND "report_production_completion"."refusal_code" IS NOT NULL AND length("report_production_completion"."refusal_code") > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_production_completion_production_unique_index` ON `report_production_completion` (`production_id`);--> statement-breakpoint
-- APPEND-ONLY. A produced report is evidence about what a firm's books said on a day; the request
-- that produced it, and the answer that settled it, are both facts that stay on the record. A period
-- re-run later is a NEW production naming the same period, so a reader can see that it was re-run.
CREATE TRIGGER `report_production_no_update` BEFORE UPDATE ON `report_production` BEGIN
  SELECT RAISE(ABORT, 'report_production is append-only; produce the report again rather than editing the request that produced it');
END;--> statement-breakpoint
CREATE TRIGGER `report_production_no_delete` BEFORE DELETE ON `report_production` BEGIN
  SELECT RAISE(ABORT, 'report_production is append-only; a report somebody asked for cannot be un-asked');
END;--> statement-breakpoint
CREATE TRIGGER `report_production_no_replace` BEFORE INSERT ON `report_production` WHEN EXISTS (SELECT 1 FROM `report_production` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'report_production is append-only; an INSERT OR REPLACE would rewrite a recorded request');
END;--> statement-breakpoint
-- A LIVE PRODUCTION IS DISTINGUISHABLE FROM AN AS-OF ONE, at the database and not only in the code
-- that wrote it. A null `known_as_of` means the report was taken over everything known when it ran
-- and is not claimed to reproduce; a value means the figures re-derive from that instant forever.
-- The two are read differently by anybody relying on the document, so a value that is present must
-- be a real instant rather than a date or an empty string.
CREATE TRIGGER `report_production_knowledge_instant_shape` BEFORE INSERT ON `report_production`
WHEN NEW.`known_as_of` IS NOT NULL AND NEW.`known_as_of` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' BEGIN
  SELECT RAISE(ABORT, 'a production''s knowledge instant is a UTC instant (YYYY-MM-DDThh:mm:ss.sssZ) or null for a live report');
END;--> statement-breakpoint
CREATE TRIGGER `report_production_completion_no_update` BEFORE UPDATE ON `report_production_completion` BEGIN
  SELECT RAISE(ABORT, 'report_production_completion is append-only; a production is settled once');
END;--> statement-breakpoint
CREATE TRIGGER `report_production_completion_no_delete` BEFORE DELETE ON `report_production_completion` BEGIN
  SELECT RAISE(ABORT, 'report_production_completion is append-only; the answer that settled a production stays on the record');
END;--> statement-breakpoint
CREATE TRIGGER `report_production_completion_no_replace` BEFORE INSERT ON `report_production_completion` WHEN EXISTS (SELECT 1 FROM `report_production_completion` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'report_production_completion is append-only; an INSERT OR REPLACE would rewrite a settled production');
END;
