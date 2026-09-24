-- THE COPY THAT LEAVES THE PLATFORM.
--
-- A word-processing version the browser editor cut keeps every tracked change in its stored bytes,
-- and every copy produced for outside the firm — a download, a bundle — is served from a copy with
-- all changes accepted. These three columns record that copy on the version: its state (pending
-- from the cut, ready once written, unavailable when the document is past what the accept pass can
-- hold), its key, and its size. Null on every version that needs no copy, which is what makes the
-- migration additive: an upload, a check-in, a restore and every version older than the columns
-- read as what they are — served from their own bytes.
--
-- ADD COLUMN, NOT A REBUILD: `file_version` is a parent (`file.current_version_id` and the
-- participant rows point at it), and a rebuild drops the table it replaces, which a durable object
-- refuses. The rule: packages/database/CLAUDE.md.
ALTER TABLE `file_version` ADD `export_copy_state` text;--> statement-breakpoint
ALTER TABLE `file_version` ADD `export_r2_key` text;--> statement-breakpoint
ALTER TABLE `file_version` ADD `export_size_bytes` integer;
