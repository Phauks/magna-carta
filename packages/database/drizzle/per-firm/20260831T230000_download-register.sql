-- The download register — one member's shelf of what the platform produced for them.
--
-- The gap this closes: a member who asked the platform to build something and then closed the tab
-- had no way back to it. A bulk bundle is addressed by the content hash of the selection and a
-- conversion by its job id, both held only in a Durable Object and an R2 object, with no row
-- anywhere recording that a person ever asked — so the artifact sat in the bucket, paid for, until
-- its lifecycle rule reaped it, reachable by nobody. Exports were worse: they were composed and
-- handed back and existed nowhere at all.
--
-- A SHELF, NOT A HISTORY. Every row carries its own expiry and is swept. "What have I ever
-- downloaded" is an audit question the audit_log already answers under a different key; this table
-- answers "what did the platform make me lately, and can I have it again", which is a different
-- question with a short useful life. Nothing here is evidence and nothing here is the firm's record:
-- filing an export into a matter stays a separate, audited act that produces a real document.
--
-- Hand-written rather than generated: the CHECK vocabularies below are closed now on purpose, and
-- drizzle-kit does not write the reasoning that has to travel with them.

CREATE TABLE `download_item` (
	`id` text PRIMARY KEY NOT NULL,
	-- WHOSE SHELF. Every read is scoped to this column, never to the firm alone: a colleague's
	-- exports are not the reader's business. A bundle is content-addressed and genuinely shared
	-- between two members who selected the same files — the artifact is shared, these rows are not.
	`member_id` text NOT NULL,
	-- What the reader sees. Composed by the producer from what the member asked for ("Firm Usage",
	-- the matter and file count of a bundle) — never a key, never an identifier.
	`title` text NOT NULL,
	-- TWO KINDS, and the distinction decides what "download again" does.
	--   artifact — bytes the platform built that cannot be re-derived: a bundle of the firm's own
	--     files, a conversion result. `object_key` points at them and a re-download mints a fresh
	--     short-TTL presigned GET. When the prefix's own lifecycle rule has reaped the object the row
	--     reports expired rather than handing over a dead link.
	--   snapshot — an export: the tabular DOCUMENT a screen built from what it was showing, stored
	--     instead of a rendered file, because this platform holds that an export is a document and
	--     formats are renderers. One row therefore serves every format, and the figures are frozen at
	--     the instant of the export rather than recomputed into a different answer later.
	`kind` text NOT NULL,
	-- WHICH PRODUCER made it. Closed, and closed now rather than later: SQLite cannot widen a table
	-- CHECK without a destructive rebuild. `bundle` and `conversion` are here with no client able to
	-- create one yet — both producers exist server-side and neither has a screen — because the
	-- alternative is rebuilding this table on the day one lands.
	`producer` text NOT NULL,
	-- The R2 key. For an artifact it is the producer's own key under the producer's own prefix, which
	-- is what keeps this table a catalog rather than a second store. For a snapshot it is this
	-- register's own object holding the stored document, keyed by this row's id, and it is swept with
	-- the row.
	`object_key` text NOT NULL,
	-- Bytes, where the producer knows them. Null on a snapshot, whose size is a property of a
	-- rendering nobody has asked for yet rather than of the row.
	`byte_size` integer,
	-- WHAT HAS BEEN TAKEN — a JSON array of format tokens, appended to rather than replaced. This is
	-- the half of the owner's ask that a plain list does not answer: a member who can see they
	-- already took the Word copy is looking at a shelf, and one who cannot is looking at a pile.
	-- Empty array means built and never fetched, which is a real and visible state.
	`downloaded_formats_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	-- When the shelf lets go. Written by the producer from one constant so that a row and the
	-- lifecycle rule over its prefix cannot drift into the register outliving the bytes it points at.
	`expires_at` text NOT NULL,
	-- THE STATE, and `building` is the reason it is a column rather than a derivation. A bundle is
	-- enqueued before its bytes exist, so the row appears on the shelf while the work is still
	-- running; a member watching a large archive build should see it here rather than wonder whether
	-- the request was taken. `failed` is terminal and keeps the row so the member learns the outcome
	-- instead of watching it vanish. `expired` is written by the sweep, but a read that finds the
	-- object already gone reports it without waiting for the sweep to catch up.
	`state` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`user_id`),
	CONSTRAINT `download_item_kind_check` CHECK (`kind` IN ('artifact', 'snapshot')),
	CONSTRAINT `download_item_producer_check` CHECK (`producer` IN ('export', 'bundle', 'conversion')),
	CONSTRAINT `download_item_state_check` CHECK (`state` IN ('building', 'ready', 'failed', 'expired')),
	CONSTRAINT `download_item_title_nonempty_check` CHECK (length(trim(`title`)) > 0),
	CONSTRAINT `download_item_object_key_nonempty_check` CHECK (length(trim(`object_key`)) > 0),
	-- A snapshot has no byte size and an artifact's is never negative; a size of zero is a real
	-- answer (an empty archive) and stays representable.
	CONSTRAINT `download_item_byte_size_check` CHECK (`byte_size` IS NULL OR `byte_size` >= 0)
);--> statement-breakpoint

-- The shelf read: one member's rows, newest first, walked by the (created_at, id) pair so the order
-- is total and a page boundary cannot repeat or drop a row that shares an instant with its neighbour.
CREATE INDEX `download_item_member_created_index` ON `download_item` (`member_id`, `created_at`, `id`);--> statement-breakpoint

-- The retention sweep's read, across the whole firm rather than one member: everything whose window
-- has closed. Leading with `expires_at` is what keeps the daily pass a range scan over the tail
-- rather than a walk of every shelf in the firm.
CREATE INDEX `download_item_expiry_index` ON `download_item` (`expires_at`, `state`);
