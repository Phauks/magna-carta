-- contract: `user`.`firm_id` loses its NOT NULL, so that an account can exist before it belongs to
-- a firm — the state the joining surface creates between making a person and resolving what they
-- are. SQLite cannot drop a column constraint in place, so this is the standard twelve-step table
-- rebuild, and it is destructive DDL against a table that holds data. What makes it safe to run:
--   * The copy is column-for-column over every column of the table as it stands (the baseline DDL,
--     unaltered since), so no row loses a value and no default is re-applied.
--   * `firm_id` only WIDENS — every existing row keeps the firm it had, and the foreign key is
--     carried across unchanged (a NULL satisfies a foreign key trivially).
--   * `defer_foreign_keys` holds the references from `session`, `account` and `two_factor` across
--     the drop; the rename restores the name they resolve against inside the same transaction (the
--     migration runner applies a migration as ONE D1 batch).
--   * The unique index on `email` is recreated, because dropping the table drops its indexes. It is
--     the fence both account-creating paths rely on, so it is recreated in this same batch or the
--     whole migration rolls back.
-- Reviewed under the rebuild sentinel: the tag is listed in REVIEWED_REBUILDS
-- (tooling/migration-integrity/checks.mts).
PRAGMA defer_foreign_keys = true;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`two_factor_enabled` integer DEFAULT false,
	`firm_id` text,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_user` (`id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`, `two_factor_enabled`, `firm_id`) SELECT `id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`, `two_factor_enabled`, `firm_id` FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
