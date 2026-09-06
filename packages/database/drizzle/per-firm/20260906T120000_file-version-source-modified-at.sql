-- The last-modified instant the uploading device reported for the file a version came from.
--
-- Uploading now asks whether a file is dated by the moment it was uploaded or by the date it already
-- carried. Whichever the reader chooses, the source's own date is a fact worth keeping: it is what
-- lets a later reader see that a file dated last March was uploaded this week, or the reverse. Null
-- for every version that predates the column and for versions that came from no device file (a
-- live-edit save, an assembled document). Column comment lives beside the Drizzle definition in
-- packages/database/src/per-firm-schema.ts.
ALTER TABLE `file_version` ADD COLUMN `source_modified_at` text;--> statement-breakpoint
