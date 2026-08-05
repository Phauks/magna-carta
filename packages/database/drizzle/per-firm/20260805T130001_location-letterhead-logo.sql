-- The office's letterhead logo asset — the columns document assembly draws a firm's mark from. The
-- bytes live in the firm's own bucket; the row carries the object key, what the bytes are, the mark's
-- intrinsic pixel size, and the width it prints at. Only a width is stored: the height follows from the
-- image's own proportions at render time, so no document can print a stretched logo. Purely additive,
-- so the table is not rebuilt. Column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
ALTER TABLE `location` ADD COLUMN `letterhead_logo_object_key` text;--> statement-breakpoint
ALTER TABLE `location` ADD COLUMN `letterhead_logo_content_type` text;--> statement-breakpoint
ALTER TABLE `location` ADD COLUMN `letterhead_logo_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `location` ADD COLUMN `letterhead_logo_sha256` text;--> statement-breakpoint
ALTER TABLE `location` ADD COLUMN `letterhead_logo_width_pixels` integer;--> statement-breakpoint
ALTER TABLE `location` ADD COLUMN `letterhead_logo_height_pixels` integer;--> statement-breakpoint
ALTER TABLE `location` ADD COLUMN `letterhead_logo_width_emu` integer;--> statement-breakpoint
ALTER TABLE `location` ADD COLUMN `letterhead_logo_updated_at` text;
