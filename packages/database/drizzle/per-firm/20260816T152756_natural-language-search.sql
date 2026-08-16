-- Natural-language document search: the derived feed's catalog, its usage meter, the firm's
-- disclosure acknowledgement, and the per-matter exclusion flag. Column comments live beside the
-- Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- HAND-WRITTEN because the matter column add is the one statement drizzle-kit cannot express
-- additively: a column CHECK makes it emit a full table rebuild (create-copy-drop-rename), which is
-- destructive DDL against a table every firm already holds data in. The additive form below is the
-- same one document_assembly.output_format used — there is no ALTER TABLE ADD CONSTRAINT in SQLite,
-- and a column CHECK on the ADD is the one place the constraint can be stated without rewriting the
-- table. Every existing row takes the default, which the constraint accepts.
CREATE TABLE `ai_search_feed_object` (
	`file_id` text NOT NULL,
	`version` integer NOT NULL,
	`matter_id` text NOT NULL,
	`object_key` text NOT NULL,
	`byte_count` integer NOT NULL,
	`fed_at` text NOT NULL,
	`removed_at` text,
	PRIMARY KEY(`file_id`, `version`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_search_feed_object_version_positive_check" CHECK("ai_search_feed_object"."version" > 0),
	CONSTRAINT "ai_search_feed_object_byte_count_nonnegative_check" CHECK("ai_search_feed_object"."byte_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_search_feed_object_matter_id_index` ON `ai_search_feed_object` (`matter_id`);--> statement-breakpoint
CREATE INDEX `ai_search_feed_object_fed_at_index` ON `ai_search_feed_object` (`fed_at`);--> statement-breakpoint
CREATE TABLE `ai_search_usage_meter` (
	`day` text PRIMARY KEY NOT NULL,
	`semantic_query_count` integer DEFAULT 0 NOT NULL,
	`full_text_query_count` integer DEFAULT 0 NOT NULL,
	`fed_bytes` integer DEFAULT 0 NOT NULL,
	`estimated_ingestion_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_ingestion_bytes_per_token` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_search_usage_meter_semantic_query_count_check" CHECK("ai_search_usage_meter"."semantic_query_count" >= 0),
	CONSTRAINT "ai_search_usage_meter_full_text_query_count_check" CHECK("ai_search_usage_meter"."full_text_query_count" >= 0),
	CONSTRAINT "ai_search_usage_meter_fed_bytes_check" CHECK("ai_search_usage_meter"."fed_bytes" >= 0),
	CONSTRAINT "ai_search_usage_meter_estimated_ingestion_tokens_check" CHECK("ai_search_usage_meter"."estimated_ingestion_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE `ai_search_disclosure_acknowledgement` (
	`scope` text PRIMARY KEY NOT NULL,
	`disclosure_version` integer NOT NULL,
	`acknowledged_by` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_search_disclosure_acknowledgement_scope_check" CHECK("ai_search_disclosure_acknowledgement"."scope" = 'firm')
);
--> statement-breakpoint
ALTER TABLE `matter` ADD COLUMN `natural_language_index_excluded` integer DEFAULT 0 NOT NULL CONSTRAINT `matter_natural_language_index_excluded_check` CHECK (`natural_language_index_excluded` IN (0, 1));
