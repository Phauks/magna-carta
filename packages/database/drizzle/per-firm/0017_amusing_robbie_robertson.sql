-- The file and file_version rebuilds below are drizzle-kit's recreate strategy: adding the editing
-- columns with their CHECK constraints requires a full table rebuild in SQLite (ALTER TABLE cannot add
-- a CHECK). HAND-CORRECTED the two ways the generator gets this lineage wrong (same as 0015):
--  1. the generator's foreign-key-toggle pragma pair (PRAGMA foreign_keys=OFF/ON) is not in D1's
--     compatible-PRAGMA set; the D1-supported `PRAGMA defer_foreign_keys = on` defers enforcement to
--     the end of the migration batch (one transaction — see d1-migration-target.ts), by which time the
--     rebuilt tables exist again. document_checkout is created first so file_version's checkout_id FK
--     references an existing table; file/file_version are then rebuilt (their FKs defer).
--  2. the copy SELECT must list only the PRE-EXISTING columns — the new columns are absent from the
--     source table, so selecting them errors. They take their declared defaults / NULL on copy.
-- contract: every new column is additive — current_r2_key/current_sha256/current_size_bytes/
-- current_wopi_timestamp/diverged_from_version_id/checkout_id are nullable (no backfill); edit_state
-- defaults to 'idle' and reconciliation_status to 'clean' (the correct value for every existing row).
-- The DROP TABLE statements are part of the recreate strategy — each table is immediately replaced.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `document_checkout` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`holder_member_id` text NOT NULL,
	`lock_type` text NOT NULL,
	`base_version_id` text NOT NULL,
	`acquired_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`idle_release_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holder_member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_checkout_lock_type_check" CHECK("document_checkout"."lock_type" IN ('exclusive', 'offline_working_copy')),
	CONSTRAINT "document_checkout_status_check" CHECK("document_checkout"."status" IN ('active', 'stale', 'released', 'reconciling'))
);
--> statement-breakpoint
CREATE INDEX `document_checkout_file_id_index` ON `document_checkout` (`file_id`);--> statement-breakpoint
CREATE INDEX `document_checkout_holder_member_id_index` ON `document_checkout` (`holder_member_id`);--> statement-breakpoint
CREATE TABLE `__new_file` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`document_type_id` text,
	`current_version_id` text,
	`current_r2_key` text,
	`current_sha256` text,
	`current_size_bytes` integer,
	`current_wopi_timestamp` text,
	`edit_state` text DEFAULT 'idle' NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_type_id`) REFERENCES `document_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_name_nonempty_check" CHECK(length("__new_file"."name") > 0),
	CONSTRAINT "file_edit_state_check" CHECK("__new_file"."edit_state" IN ('idle', 'coediting', 'checked_out'))
);
--> statement-breakpoint
INSERT INTO `__new_file`("id", "matter_id", "folder_id", "name", "document_type_id", "current_version_id", "deleted_at", "created_at", "updated_at") SELECT "id", "matter_id", "folder_id", "name", "document_type_id", "current_version_id", "deleted_at", "created_at", "updated_at" FROM `file`;--> statement-breakpoint
DROP TABLE `file`;--> statement-breakpoint
ALTER TABLE `__new_file` RENAME TO `file`;--> statement-breakpoint
CREATE INDEX `file_matter_id_created_at_id_index` ON `file` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `file_folder_id_created_at_id_index` ON `file` (`folder_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `__new_file_version` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer,
	`declared_content_type` text,
	`sniffed_content_type` text,
	`content_sha256` text,
	`storage_encoding` text DEFAULT 'full' NOT NULL,
	`artifact_role` text DEFAULT 'original' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`storage_class` text DEFAULT 'standard' NOT NULL,
	`scan_verdict` text,
	`scan_engine_version` text,
	`scan_detail` text,
	`inline_playable` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` text,
	`reconciliation_status` text DEFAULT 'clean' NOT NULL,
	`diverged_from_version_id` text,
	`checkout_id` text,
	`created_at` text NOT NULL,
	`committed_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diverged_from_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkout_id`) REFERENCES `document_checkout`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_version_artifact_role_check" CHECK("__new_file_version"."artifact_role" IN ('original', 'derived')),
	CONSTRAINT "file_version_storage_class_check" CHECK("__new_file_version"."storage_class" IN ('standard', 'infrequent_access')),
	CONSTRAINT "file_version_scan_verdict_check" CHECK("__new_file_version"."scan_verdict" IS NULL OR "__new_file_version"."scan_verdict" IN ('unscanned', 'clean', 'infected')),
	CONSTRAINT "file_version_inline_playable_check" CHECK("__new_file_version"."inline_playable" IS NULL OR "__new_file_version"."inline_playable" IN ('playable', 'download-only', 'indeterminate')),
	CONSTRAINT "file_version_status_check" CHECK("__new_file_version"."status" IN ('pending', 'clean', 'quarantined', 'abandoned')),
	CONSTRAINT "file_version_reconciliation_status_check" CHECK("__new_file_version"."reconciliation_status" IN ('clean', 'conflict_pending', 'reconciled')),
	CONSTRAINT "file_version_size_bytes_nonneg_check" CHECK("__new_file_version"."size_bytes" IS NULL OR "__new_file_version"."size_bytes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_file_version`("id", "file_id", "version_number", "r2_key", "size_bytes", "declared_content_type", "sniffed_content_type", "content_sha256", "storage_encoding", "artifact_role", "pinned", "storage_class", "scan_verdict", "scan_engine_version", "scan_detail", "inline_playable", "status", "uploaded_by", "created_at", "committed_at") SELECT "id", "file_id", "version_number", "r2_key", "size_bytes", "declared_content_type", "sniffed_content_type", "content_sha256", "storage_encoding", "artifact_role", "pinned", "storage_class", "scan_verdict", "scan_engine_version", "scan_detail", "inline_playable", "status", "uploaded_by", "created_at", "committed_at" FROM `file_version`;--> statement-breakpoint
DROP TABLE `file_version`;--> statement-breakpoint
ALTER TABLE `__new_file_version` RENAME TO `file_version`;--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_r2_key_unique_index` ON `file_version` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_file_id_version_number_unique_index` ON `file_version` (`file_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `file_version_status_index` ON `file_version` (`status`);
