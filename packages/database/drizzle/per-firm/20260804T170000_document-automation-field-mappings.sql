CREATE TABLE `document_template_field_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`field_name` text NOT NULL,
	`merge_key` text NOT NULL,
	`times_applied` integer DEFAULT 0 NOT NULL,
	`confirmed_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `document_template_field_mapping_field_name_nonempty_check` CHECK (length(`field_name`) > 0),
	CONSTRAINT `document_template_field_mapping_merge_key_nonempty_check` CHECK (length(`merge_key`) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_template_field_mapping_field_name_unique_index` ON `document_template_field_mapping` (`field_name`);
--> statement-breakpoint
ALTER TABLE `document_assembly` ADD `frozen_field_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `document_assembly` ADD `frozen_field_names_json` text DEFAULT '[]' NOT NULL;
