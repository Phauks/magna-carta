CREATE TABLE `firm` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`database_identifier` text NOT NULL,
	`per_firm_schema_version` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firm_database_identifier_unique` ON `firm` (`database_identifier`);