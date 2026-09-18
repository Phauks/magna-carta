-- THE REGISTER ADMITS EVERY DOWNLOAD, AND KEEPS THE RECORD AFTER THE BYTES GO.
--
-- Three changes, one rebuild, because SQLite cannot widen a CHECK or relax a NOT NULL in place.
--
--   1. `producer` admits `file`. The table was built with `bundle` and `conversion` named up front
--      precisely so that lighting them up later would cost nothing — and that worked, they need no
--      schema change at all. A single matter file was not foreseen, and is what this rebuild buys.
--   2. `kind` admits `reference` and `record`. The first is a SAFETY boundary rather than a
--      vocabulary; the second is what lets the register be complete without lying, for a bundle
--      streamed inline whose bytes were assembled for one response and never retained — filing
--      those as an artifact would report "expired" for something that was never stored. An
--      artifact fetch presigns the stored object key with no further check, which is right for a
--      frozen bundle the member already had and wrong for a live matter file: a member screened off
--      a matter afterwards would keep a working handle to it. A reference carries no key and
--      resolves through the files route instead, so the matter's own access check runs again at
--      fetch time. Modelling it as a third kind means the presigning branch cannot be reached with a
--      matter file at all, rather than being one forgotten `if` away from a standing hole.
--   3. `object_key` and `expires_at` become nullable, and two CHECKs tie them to the kind: a
--      reference names a file and holds no key, everything else holds a key and names no file. The
--      expiry is now about the BYTES rather than the row — the sweep marks `expired` and takes the
--      object, and the row stays, because the bytes are privileged content in a second place worth
--      destroying on a schedule while the row is a title and two instants whose destruction only
--      loses a member their own history.
--
-- contract: download_item is dropped after its rows are copied into a replacement. This is a
-- same-transaction table REBUILD, not a data removal — the copy is exhaustive (all twelve existing
-- columns, no predicate, no expression between source and target), the drop and the rename run
-- inside the one migration transaction, and a failure at any point rolls the whole thing back with
-- the original table intact. `subject_file_id` is the one new column and takes NULL, which every
-- CHECK below accepts for the two kinds that existed. No CHECK can reject a copied row: `kind` and
-- `producer` only ADD values to their sets, the two shape CHECKs are satisfied by every pre-existing
-- row (none is a reference, and every one carries a key), and the nonempty CHECK was widened to
-- admit the null it now permits.
--
-- WHY THIS REBUILD IS APPLIABLE WHERE A PARENT REBUILD IS NOT. A rebuild drops the table it
-- replaces, and in a Cloudflare durable object foreign keys are enforced at the statement and at the
-- commit, with PRAGMA foreign_keys=OFF a no-op inside the one execution context a migration runs in
-- (the probes are in apps/api-worker/test/durable-object-pragma-context.test.ts). So a drop fires a
-- violation for every child row and cannot complete against a firm that holds data.
--
-- download_item HAS NO CHILDREN. Nothing in the schema references it — it is the shelf row that
-- points OUT, at the member who owns it — so the drop below fires nothing, which is the condition
-- parentRebuildViolations checks for before it refuses a rebuild. Dropping a child is not what the
-- durable object refuses. The bracketing pragmas are kept because they are ordinary practice for a
-- rebuild and are harmless, NOT because they are doing any work here.
--
-- The copy preserves every id verbatim and the replacement takes the original's name, so every shelf
-- item resolves to the member and the object it resolved to before. Nothing is re-keyed. This table
-- carries no triggers, so there are none to recreate — both indexes are.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_download_item` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`producer` text NOT NULL,
	`object_key` text,
	`subject_file_id` text,
	`byte_size` integer,
	`downloaded_formats_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`state` text NOT NULL,
	`requested_format` text,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`user_id`),
	CONSTRAINT `download_item_kind_check` CHECK (`kind` IN ('artifact', 'snapshot', 'reference', 'record')),
	CONSTRAINT `download_item_producer_check` CHECK (`producer` IN ('export', 'bundle', 'conversion', 'file', 'discovery')),
	CONSTRAINT `download_item_state_check` CHECK (`state` IN ('building', 'ready', 'failed', 'expired')),
	CONSTRAINT `download_item_title_nonempty_check` CHECK (length(trim(`title`)) > 0),
	CONSTRAINT `download_item_object_key_nonempty_check` CHECK (`object_key` IS NULL OR length(trim(`object_key`)) > 0),
	-- The two halves of the third kind, stated as constraints rather than trusted to the writers.
	CONSTRAINT `download_item_reference_shape_check` CHECK ((`kind` = 'reference') = (`subject_file_id` IS NOT NULL)),
	CONSTRAINT `download_item_object_key_presence_check` CHECK ((`kind` IN ('artifact', 'snapshot')) = (`object_key` IS NOT NULL)),
	CONSTRAINT `download_item_byte_size_check` CHECK (`byte_size` IS NULL OR `byte_size` >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_download_item` (`id`, `member_id`, `title`, `kind`, `producer`, `object_key`, `byte_size`, `downloaded_formats_json`, `created_at`, `expires_at`, `state`, `requested_format`)
SELECT `id`, `member_id`, `title`, `kind`, `producer`, `object_key`, `byte_size`, `downloaded_formats_json`, `created_at`, `expires_at`, `state`, `requested_format` FROM `download_item`;--> statement-breakpoint
DROP TABLE `download_item`;--> statement-breakpoint
ALTER TABLE `__new_download_item` RENAME TO `download_item`;--> statement-breakpoint
-- The shelf read: one member's rows, newest first, walked by the (created_at, id) pair so the order
-- is total and a page boundary cannot repeat or drop a row sharing an instant with its neighbour.
-- It carries the register's paging now that rows are kept rather than swept, which is what makes
-- that totality load-bearing rather than incidental.
CREATE INDEX `download_item_member_created_index` ON `download_item` (`member_id`, `created_at`, `id`);--> statement-breakpoint
-- The sweep's read, across the firm rather than one member. Leading with the expiry is what keeps
-- the daily pass a range scan over the tail. A reference's NULL expiry never satisfies the range,
-- which is how a row with no bytes of the register's is skipped without a second predicate.
CREATE INDEX `download_item_expiry_index` ON `download_item` (`expires_at`, `state`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
