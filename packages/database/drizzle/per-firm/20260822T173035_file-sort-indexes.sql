-- The two orders the file listing gained beyond creation order: by name and by last activity. Same
-- shape as the two `created_at` composites already on this table — lead with the filter column so one
-- ascending index serves the filter, both directions of the sort (SQLite walks an index backwards),
-- and the bare foreign-key lookup.
--
-- `COLLATE NOCASE` on the name indexes is deliberate, and it is the first NOCASE index in this
-- lineage. SQLite uses an index to satisfy an ORDER BY only when the collations match, so a plain
-- index here would be dead weight for `ORDER BY name COLLATE NOCASE` and the listing would sort every
-- file in the matter in a temporary B-tree on every page. Without the NOCASE the alternative is worse
-- than slow: a case-sensitive name sort puts every capitalised file ahead of every lowercase one.
-- NOCASE folds ASCII only, so a firm filing under non-ASCII names gets an order that is stable and
-- locally wrong; the upgrade for that is a normalised sort-key column, which changes an index rather
-- than a contract.
--
-- The `updated_at` pair is the expensive one and is taken knowingly: `file.updated_at` moves on every
-- metadata write, including both co-editing state transitions, so a matter under active editing
-- rewrites two B-tree entries per session open and close.
CREATE INDEX `file_matter_id_name_id_index` ON `file` (`matter_id`,"name" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `file_folder_id_name_id_index` ON `file` (`folder_id`,"name" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `file_matter_id_updated_at_id_index` ON `file` (`matter_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `file_folder_id_updated_at_id_index` ON `file` (`folder_id`,`updated_at`,`id`);
