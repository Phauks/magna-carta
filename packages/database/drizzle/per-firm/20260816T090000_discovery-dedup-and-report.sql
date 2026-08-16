-- Discovery processing, the remainder: exactly one primary per duplicate group, and the exception
-- report's own read. Purely additive — one column and two indexes, no table rebuilt. Column comments
-- live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- WHY PRIMACY IS HELD BY THE DATABASE. Deduplication decides which copy of a document a reviewer
-- opens and which copies are suppressed behind it. A group with two primaries is a group whose
-- copies were extracted twice and attributed to neither, and — worse — a group whose occurrence rows
-- point at two different documents, so "which custodians held this document" has two answers. The
-- consumer takes primacy with a single guarded statement; this index is the same rule held for the
-- write path nobody has written yet, which is the difference between "we do not do that" and "that
-- cannot happen".
--
-- Partial on both conditions. A document with no content identity carries a NULL group and stays its
-- own primary, and NULLs are distinct in a SQLite unique index, so those rows are unconstrained —
-- which is right, because the platform is declining to assert anything about them rather than
-- putting them all in one group. drizzle cannot express a WHERE on a unique index, which is why this
-- lives here by hand, exactly as the two source-kind indexes on this table already do.
CREATE UNIQUE INDEX `review_document_dedup_primary_unique_index` ON `review_document` (`review_set_id`,`dedup_group_id`) WHERE `dedup_group_id` IS NOT NULL AND `is_dedup_primary` = 1;--> statement-breakpoint
-- WHICH LOAD AN EXCEPTION BELONGS TO. The exception report is written per load and is the artifact a
-- firm hands to opposing counsel; reaching the load through the document means joining every row in
-- the corpus to group the few thousand that carry a reason. The same argument that already put
-- `review_set_id` on this table, one grain finer.
--
-- Nullable because SQLite has no ALTER TABLE that adds a NOT NULL column to a populated table. The
-- insert in packages/discovery/src/processing-statements.ts is the only writer and always binds it.
ALTER TABLE `review_document_exception` ADD COLUMN `discovery_load_id` text REFERENCES `discovery_load`(`id`);--> statement-breakpoint
-- One load's exceptions in document order, so the report walks them alongside the manifest's own
-- document walk and merges the two in one pass rather than reading exceptions per document.
CREATE INDEX `review_document_exception_load_index` ON `review_document_exception` (`discovery_load_id`,`review_document_id`);
