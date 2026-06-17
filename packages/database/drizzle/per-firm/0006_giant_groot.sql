CREATE TABLE `integration_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`adapter_id` text NOT NULL,
	`scope` text NOT NULL,
	`principal_ref` text NOT NULL,
	`credential_ref` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`capability_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connection_principal_category_unique_index` ON `integration_connection` (`category`,`principal_ref`);