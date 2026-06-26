-- Rebuilds file_version to change the scan_verdict CHECK from 'infected' to 'flagged',
-- aligning the persisted enum with the single-flagged-state model (a committed version
-- a re-scan finds suspicious is now recorded as scan_verdict = 'flagged', not 'infected').
-- SQLite cannot ALTER an existing CHECK constraint — the table must be rebuilt.
-- The copy SELECT preserves every column. No rows exist in production at this point.
-- Uses PRAGMA defer_foreign_keys (D1-compatible) rather than PRAGMA foreign_keys=OFF/ON
-- (not in D1's compatible-PRAGMA set) so FK enforcement is deferred until the end of the
-- migration batch (one transaction), by which time the renamed table is in place.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
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
	`inline_playable` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` text,
	`created_at` text NOT NULL,
	`committed_at` text,
	`scan_detail` text,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_version_artifact_role_check" CHECK("__new_file_version"."artifact_role" IN ('original', 'derived')),
	CONSTRAINT "file_version_storage_class_check" CHECK("__new_file_version"."storage_class" IN ('standard', 'infrequent_access')),
	CONSTRAINT "file_version_scan_verdict_check" CHECK("__new_file_version"."scan_verdict" IS NULL OR "__new_file_version"."scan_verdict" IN ('unscanned', 'clean', 'flagged')),
	CONSTRAINT "file_version_inline_playable_check" CHECK("__new_file_version"."inline_playable" IS NULL OR "__new_file_version"."inline_playable" IN ('playable', 'download-only', 'indeterminate')),
	CONSTRAINT "file_version_status_check" CHECK("__new_file_version"."status" IN ('pending', 'clean', 'quarantined', 'abandoned')),
	CONSTRAINT "file_version_size_bytes_nonneg_check" CHECK("__new_file_version"."size_bytes" IS NULL OR "__new_file_version"."size_bytes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_file_version`("id", "file_id", "version_number", "r2_key", "size_bytes", "declared_content_type", "sniffed_content_type", "content_sha256", "storage_encoding", "artifact_role", "pinned", "storage_class", "scan_verdict", "scan_engine_version", "inline_playable", "status", "uploaded_by", "created_at", "committed_at", "scan_detail") SELECT "id", "file_id", "version_number", "r2_key", "size_bytes", "declared_content_type", "sniffed_content_type", "content_sha256", "storage_encoding", "artifact_role", "pinned", "storage_class", "scan_verdict", "scan_engine_version", "inline_playable", "status", "uploaded_by", "created_at", "committed_at", "scan_detail" FROM `file_version`;--> statement-breakpoint
DROP TABLE `file_version`;--> statement-breakpoint
ALTER TABLE `__new_file_version` RENAME TO `file_version`;--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_r2_key_unique_index` ON `file_version` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_file_id_version_number_unique_index` ON `file_version` (`file_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `file_version_status_index` ON `file_version` (`status`);
