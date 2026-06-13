CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_index` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`user_id` text,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_key` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`response_code` integer,
	`response_body` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_key_key_unique_index` ON `idempotency_key` (`key`);--> statement-breakpoint
CREATE INDEX `idempotency_key_created_at_index` ON `idempotency_key` (`created_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`payload` text NOT NULL,
	`aggregate_key` text,
	`seq` integer,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`dispatched_at` text
);
--> statement-breakpoint
CREATE INDEX `outbox_status_created_at_index` ON `outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_index` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_secret_index` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `two_factor_user_id_index` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`two_factor_enabled` integer DEFAULT false,
	`firm_id` text NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_index` ON `verification` (`identifier`);--> statement-breakpoint
-- The firm rebuild below is drizzle-kit's recreate strategy (database_identifier loses NOT NULL,
-- name gains UNIQUE for the provisioning lifecycle; owner_user_id records the activation's
-- owner), HAND-CORRECTED in two ways the generator gets wrong for this lineage:
--   1. The copy SELECT named `status`/`bucket_name`/`owner_user_id`, which do not exist in the
--      0000-era table (this migration introduces them) — they are backfilled as 'active'/NULL/NULL
--      instead, matching the expand-contract DEFAULT for pre-lifecycle rows.
--   2. the generator's foreign-key-toggle pragma pair is not in D1's compatible-PRAGMA set; the
--      D1-supported `PRAGMA defer_foreign_keys = on` defers enforcement to the end of the migration batch
--      (one transaction — see d1-migration-target.ts), by which time `firm` exists again.
-- contract: the DROP TABLE is the rebuild's rename dance, data preserved via INSERT ... SELECT.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_firm` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`database_identifier` text,
	`per_firm_schema_version` text,
	`status` text DEFAULT 'active' NOT NULL,
	`bucket_name` text,
	`owner_user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_firm`("id", "name", "database_identifier", "per_firm_schema_version", "status", "bucket_name", "owner_user_id", "created_at") SELECT "id", "name", "database_identifier", "per_firm_schema_version", 'active', NULL, NULL, "created_at" FROM `firm`;--> statement-breakpoint
DROP TABLE `firm`;--> statement-breakpoint
ALTER TABLE `__new_firm` RENAME TO `firm`;--> statement-breakpoint
CREATE UNIQUE INDEX `firm_name_unique` ON `firm` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `firm_database_identifier_unique` ON `firm` (`database_identifier`);