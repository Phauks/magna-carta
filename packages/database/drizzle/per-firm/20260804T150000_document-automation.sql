CREATE TABLE `document_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`matter_type_id` text,
	`location_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_version_id` text,
	`created_by` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`),
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`),
	CONSTRAINT `document_template_name_nonempty_check` CHECK (length(`name`) > 0),
	CONSTRAINT `document_template_status_check` CHECK (`status` IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `document_template_status_name_index` ON `document_template` (`status`,`name`);
--> statement-breakpoint
CREATE INDEX `document_template_matter_type_id_index` ON `document_template` (`matter_type_id`);
--> statement-breakpoint
CREATE TABLE `document_template_version` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer,
	`content_sha256` text,
	`storage_encoding` text DEFAULT 'full' NOT NULL,
	`storage_class` text DEFAULT 'standard' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scan_verdict` text,
	`scan_engine_version` text,
	`scan_detail` text,
	`field_manifest_json` text DEFAULT '{}' NOT NULL,
	`normalization_warnings_json` text DEFAULT '[]' NOT NULL,
	`normalizer_version` integer DEFAULT 0 NOT NULL,
	`macro_parts_removed` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`committed_at` text,
	FOREIGN KEY (`template_id`) REFERENCES `document_template`(`id`),
	CONSTRAINT `document_template_version_status_check` CHECK (`status` IN ('pending', 'clean', 'quarantined', 'abandoned')),
	CONSTRAINT `document_template_version_storage_class_check` CHECK (`storage_class` IN ('standard', 'infrequent_access')),
	CONSTRAINT `document_template_version_scan_verdict_check` CHECK (`scan_verdict` IS NULL OR `scan_verdict` IN ('unscanned', 'clean', 'flagged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_template_version_r2_key_unique_index` ON `document_template_version` (`r2_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_template_version_template_version_number_unique_index` ON `document_template_version` (`template_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `document_template_version_template_id_created_at_id_index` ON `document_template_version` (`template_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `document_assembly` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`folder_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`outcome` text,
	`failure_reason` text,
	`file_id` text,
	`file_version_id` text,
	`engine_version` integer DEFAULT 0 NOT NULL,
	`dictionary_version` integer DEFAULT 0 NOT NULL,
	`absent_field_count` integer DEFAULT 0 NOT NULL,
	`absent_field_keys_json` text DEFAULT '[]' NOT NULL,
	`requested_by` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`template_id`) REFERENCES `document_template`(`id`),
	FOREIGN KEY (`template_version_id`) REFERENCES `document_template_version`(`id`),
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`),
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`),
	CONSTRAINT `document_assembly_status_check` CHECK (`status` IN ('queued', 'running', 'done', 'failed')),
	CONSTRAINT `document_assembly_outcome_check` CHECK (`outcome` IS NULL OR `outcome` IN ('succeeded', 'succeeded_with_absences', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `document_assembly_matter_id_created_at_id_index` ON `document_assembly` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `document_assembly_template_version_id_index` ON `document_assembly` (`template_version_id`);
