-- Matching depth for the conflicts corpus: two derived name keys beside the frozen normalization,
-- and the nickname catalogue registered empty.
--
-- Hand-written rather than generated, because drizzle-kit emits the column adds, the CREATE TABLE and
-- the indexes in an order it chooses; the column adds have to land before their indexes on a table
-- that already holds every firm's names.
--
-- Every statement here is additive. `normalized_display` is UNTOUCHED — it is a frozen contract
-- stored across the fleet and the FTS5 external-content column, so the two new keys sit beside it
-- and nothing about merge, entry-time duplicate detection, or the shipped tier-2 comparison moves.
-- Both are nullable with no default: the values are derived per row and are filled by a resumable
-- backfill, and a fitness probe reports the outstanding count while that runs.
ALTER TABLE `directory_name` ADD COLUMN `normalized_match_key` text;--> statement-breakpoint
ALTER TABLE `directory_name` ADD COLUMN `normalized_match_key_bare` text;--> statement-breakpoint
CREATE INDEX `directory_name_normalized_match_key_index` ON `directory_name` (`normalized_match_key`);--> statement-breakpoint
CREATE INDEX `directory_name_normalized_match_key_bare_index` ON `directory_name` (`normalized_match_key_bare`);--> statement-breakpoint
-- The nickname equivalence catalogue, created and left EMPTY. `Bob`/`Robert` is not a phonetic
-- relationship and no algorithm derives it; the pairs are curated data with a licensing question
-- attached. Shipping the empty table is what lets every conflicts check record the dimension as one
-- it could not search, rather than omitting it and letting a reader assume it was covered.
CREATE TABLE `nickname_equivalence` (
	`name_form` text NOT NULL,
	`equivalent_form` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`name_form`, `equivalent_form`),
	CONSTRAINT `nickname_equivalence_name_form_check` CHECK (length(`name_form`) > 0),
	CONSTRAINT `nickname_equivalence_equivalent_form_check` CHECK (length(`equivalent_form`) > 0)
);
--> statement-breakpoint
CREATE INDEX `nickname_equivalence_equivalent_form_index` ON `nickname_equivalence` (`equivalent_form`);
