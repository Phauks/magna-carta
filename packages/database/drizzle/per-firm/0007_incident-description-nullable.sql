-- The incident rebuild below is drizzle-kit's recreate strategy (description loses NOT NULL — new
-- writes are encrypted-only into description_ciphertext, so the plaintext column must accept NULL),
-- HAND-CORRECTED one way the generator gets wrong for this lineage: the generator's
-- foreign-key-toggle pragma pair (PRAGMA foreign_keys=OFF/ON) is not in D1's compatible-PRAGMA set;
-- the D1-supported `PRAGMA defer_foreign_keys = on` defers enforcement to the end of the migration
-- batch (one transaction — see d1-migration-target.ts), by which time `incident` exists again. The
-- copy SELECT preserves every column, description_ciphertext included.
-- contract: this makes the plaintext `description` nullable now; the column itself is dropped in a
-- later slice after a verification window (expand-contract — the encrypt backfill fills ciphertext).
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_incident` (
	`id` text PRIMARY KEY NOT NULL,
	`error_ids` text NOT NULL,
	`breadcrumbs` text NOT NULL,
	`description` text,
	`description_ciphertext` text,
	`context` text NOT NULL,
	`screenshot_key` text,
	`status` text DEFAULT 'open' NOT NULL,
	`reported_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_incident`("id", "error_ids", "breadcrumbs", "description", "description_ciphertext", "context", "screenshot_key", "status", "reported_by", "created_at") SELECT "id", "error_ids", "breadcrumbs", "description", "description_ciphertext", "context", "screenshot_key", "status", "reported_by", "created_at" FROM `incident`;--> statement-breakpoint
DROP TABLE `incident`;--> statement-breakpoint
ALTER TABLE `__new_incident` RENAME TO `incident`;
