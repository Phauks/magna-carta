-- A CONFLICTS CHECK NUMBER IS DRAWN FROM THE FIRM'S NUMBERING SCHEME, LIKE A MATTER'S.
--
-- A check number was `CC-` and four digits from MAX(check_sequence) + 1 under a unique index on the
-- sequence: a shape the firm could not change, drawn from a firm-wide run that every intake, every
-- new party and every automatic re-check consumed. This moves the check onto the shared draw every
-- other numbered record uses — a counter row per scope, an allocation row per value consumed — so the
-- firm shapes it from the one numbering screen, and the built-in default restarts the count each
-- year (CC2026-00001).
--
-- The unique index on check_sequence is dropped because the sequence is now unique only together
-- with its scope: two years both draw a 1. The rendered number keeps its own unique index, which is
-- what a person quotes and what the draw's bounded retry steps past on a collision.
--
-- Nothing already numbered changes: CC-0001 and its successors stay the numbers they were. The
-- firm-wide counter is seeded past them so a firm that chooses to keep a firm-wide `CC-` run under
-- its own scheme continues from where the old run stopped rather than colliding with it.
CREATE TABLE `conflicts_check_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`check_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `drawn_value`),
	FOREIGN KEY (`check_id`) REFERENCES `conflicts_numbered_check`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conflicts_check_number_allocation_check_index` ON `conflicts_check_number_allocation` (`check_id`);--> statement-breakpoint
CREATE TABLE `conflicts_check_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX `conflicts_numbered_check_sequence_unique_index`;--> statement-breakpoint
INSERT INTO `conflicts_check_number_counter` (`scope_key`, `next_value`)
SELECT '', MAX(`check_sequence`) + 1 FROM `conflicts_numbered_check`
HAVING COUNT(*) > 0
ON CONFLICT(`scope_key`) DO UPDATE SET `next_value` = max(`next_value`, excluded.`next_value`);
