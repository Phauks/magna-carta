ALTER TABLE `index_split` ADD `document_id` text;--> statement-breakpoint
ALTER TABLE `index_split` ADD `version` integer;--> statement-breakpoint
CREATE INDEX `index_split_document_index` ON `index_split` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `index_split_document_version_unique` ON `index_split` (`document_id`,`version`) WHERE "index_split"."document_id" IS NOT NULL AND "index_split"."superseded_at" IS NULL;
