-- The time-entry record surfaces: the internal memo, the matter-scoped entry number and its
-- sequence tables, and the many-file attachment relation.
--
-- `memo` is the firm's own note about an entry — one audience, the firm. It is stored on the row
-- (like kick_back_reason) so it inherits the entry's tenancy, RBAC and retention, and it never
-- reaches audit_log.metadata, a bill, a print sheet, or the client portal.
--
-- `entry_number` is the matter-scoped human reference ("2026-0147.0042": matter number, dot,
-- zero-padded per-matter sequence), drawn at capture through the shared sequence-numbering draw
-- (counter row + allocation primary key — the allocation is what aborts a losing concurrent draw).
-- Every entry captured before this migration stays NULL: an honest gap, never a backfilled guess.
-- The partial UNIQUE index is the rendered-string backstop the counter cannot provide (the same
-- arrangement matter_number carries).
--
-- `time_entry_attachment` links an entry to files already in its matter, many per entry, by
-- reference — detaching deletes the link row only and the file stays in the matter.
--
-- Purely additive: no table is rebuilt, every existing row takes NULL for the new columns.
ALTER TABLE `time_entry` ADD COLUMN `memo` text;--> statement-breakpoint
ALTER TABLE `time_entry` ADD COLUMN `entry_number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `time_entry_entry_number_unique_index` ON `time_entry` (`entry_number`) WHERE "time_entry"."entry_number" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `time_entry_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entry_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`time_entry_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `drawn_value`),
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entry_number_allocation_time_entry_id_index` ON `time_entry_number_allocation` (`time_entry_id`);--> statement-breakpoint
CREATE TABLE `time_entry_attachment` (
	`time_entry_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	PRIMARY KEY(`time_entry_id`, `file_id`),
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entry_attachment_file_id_index` ON `time_entry_attachment` (`file_id`);
