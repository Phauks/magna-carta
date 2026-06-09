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
CREATE INDEX `outbox_status_created_at_index` ON `outbox` (`status`,`created_at`);