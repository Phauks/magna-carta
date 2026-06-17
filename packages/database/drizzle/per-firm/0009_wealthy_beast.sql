-- Expand the phonetic scheme CHECK to include the primary/secondary split for Double Metaphone.
-- Double Metaphone produces two codes per input; they are stored as separate rows under
-- 'double_metaphone_primary' and 'double_metaphone_secondary' so every scheme row is a single
-- scalar code and the blocking/search layer treats all schemes uniformly.
-- HAND-CORRECTED: drizzle-kit emitted PRAGMA foreign_keys=OFF/ON which is not in D1's
-- compatible-PRAGMA set. Replaced with PRAGMA defer_foreign_keys = on (defers FK enforcement
-- to the end of the migration batch, which runs in one transaction — see d1-migration-target.ts).
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_directory_name_phonetic_code` (
	`name_id` text NOT NULL,
	`scheme` text NOT NULL,
	`code` text NOT NULL,
	PRIMARY KEY(`name_id`, `scheme`),
	FOREIGN KEY (`name_id`) REFERENCES `directory_name`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "directory_name_phonetic_code_scheme_check" CHECK("__new_directory_name_phonetic_code"."scheme" IN ('soundex', 'metaphone', 'double_metaphone_primary', 'double_metaphone_secondary'))
);
--> statement-breakpoint
INSERT INTO `__new_directory_name_phonetic_code`("name_id", "scheme", "code") SELECT "name_id", "scheme", "code" FROM `directory_name_phonetic_code`;--> statement-breakpoint
DROP TABLE `directory_name_phonetic_code`;--> statement-breakpoint
ALTER TABLE `__new_directory_name_phonetic_code` RENAME TO `directory_name_phonetic_code`;--> statement-breakpoint
CREATE INDEX `directory_name_phonetic_code_scheme_code_index` ON `directory_name_phonetic_code` (`scheme`,`code`);
