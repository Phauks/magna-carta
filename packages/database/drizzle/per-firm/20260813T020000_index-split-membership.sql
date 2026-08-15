-- Discovery search index — what is inside a merged split.
--
-- A split the write pipeline publishes carries its own document_id and version on the index_split row,
-- so it needs no membership. A split compaction publishes covers many document versions and leaves both
-- columns NULL, which would otherwise leave nothing in the catalog able to say which versions it holds.
--
-- The catalog has to be able to say, because a merged split is immutable and the corpus is not. When a
-- document is re-indexed its replacement is published as a new per-document split while the merged split
-- still holds the older version's passages, and both are live. The membership is what lets the query path
-- name that stale version to the engine as a per-split exclusion, so it stops matching immediately, and
-- what lets the next compaction of that split pass the same id to the merge, which deletes it and repacks
-- so the postings leave the published bytes.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `index_split_member` (
	`split_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`superseded_at` text,
	PRIMARY KEY(`split_id`, `document_id`, `version`)
);
--> statement-breakpoint
-- The query-path read: the stale members of the splits a corpus holds live.
CREATE INDEX `index_split_member_split_superseded_index` ON `index_split_member` (`split_id`,`superseded_at`);
--> statement-breakpoint
-- The write-path read: every live split carrying any version of the document just re-indexed.
CREATE INDEX `index_split_member_document_index` ON `index_split_member` (`document_id`);
