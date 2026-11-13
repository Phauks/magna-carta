-- A COPY OF A VIDEO THAT EVERY BROWSER PLAYS.
--
-- A recording the browser in front of a member cannot decode (HEVC on Firefox, Matroska on Safari,
-- 10-bit or 4:2:2 pictures, MP3 or PCM sound in an MP4) can be converted on request into an H.264 and
-- AAC MP4 by the Rust transcode engine. These five columns record that copy on the version it was
-- made from: its state, its key, its size, the engine's reason when it cannot be made, and when it
-- was asked for. Null on every version nobody asked about, which is what makes this additive.
--
-- ADD COLUMN, NOT A REBUILD: `file_version` is a parent table (packages/database/CLAUDE.md).
ALTER TABLE `file_version` ADD `playable_copy_state` text;--> statement-breakpoint
ALTER TABLE `file_version` ADD `playable_copy_r2_key` text;--> statement-breakpoint
ALTER TABLE `file_version` ADD `playable_copy_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `file_version` ADD `playable_copy_reason` text;--> statement-breakpoint
ALTER TABLE `file_version` ADD `playable_copy_requested_at` text;