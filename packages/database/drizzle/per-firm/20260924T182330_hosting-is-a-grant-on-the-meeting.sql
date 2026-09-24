-- AUTHORITY OVER A MEETING IS A GRANT ON THE MEETING, NOT A CAPABILITY OF A SEAT.
--
-- `meetings:host` says who a firm lets convene a meeting. It cannot say who is running THIS room,
-- because that changes while the meeting runs: hosting is handed over, co-hosts are named and
-- withdrawn, and the member who opened the room may have been called away an hour ago. So the
-- meeting record carries the answer, as rows in `meeting_host` — the starter gets one when the room
-- is created, a co-host is another under the same meeting, and a hand-over closes one and opens
-- another in one batch.
--
-- A ROW RATHER THAN A COLUMN, and this is the decision worth defending. A `host_user_id` on
-- `meeting` would answer the live question and only the live question: co-hosts are several, so they
-- need rows regardless, and a column overwritten on hand-over erases who was running the room
-- before it. What a firm asks of a meeting record months later is who was hosting when something
-- happened, which is a question about an interval — so a grant is closed, never deleted, on the same
-- principle that makes attendance a row per stay rather than a flag per person.
--
-- THE TWO PARTIAL UNIQUE INDEXES ARE THE INVARIANTS. One live host per meeting, one live grant per
-- member per meeting, held by the database because every write path here is a read-then-write and is
-- blind to the instant it does not span: two members handing the room to two different people at
-- once. The loser's whole batch rolls back, which is the one-meeting-per-event precedent.
--
-- HAND-WRITTEN rather than generated, for the reasons this lineage usually is: drizzle-kit cannot
-- express a partial index, and the two added pairs of columns carry CHECKs that name a second
-- column. Adding a column drops nothing, so both parents keep every row and every child reference —
-- which is the whole reason the vocabulary on `meeting_attendance` grows by a column rather than by
-- widening a CHECK (packages/database/CLAUDE.md). The snapshot is refreshed in the same commit.
CREATE TABLE `meeting_host` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by_user_id` text,
	`granted_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_host_role_check" CHECK("meeting_host"."role" IN ('host', 'co-host')),
	CONSTRAINT "meeting_host_revoked_shape_check" CHECK(("meeting_host"."revoked_at" IS NULL) = ("meeting_host"."revoked_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_host_live_host_unique_index` ON `meeting_host` (`meeting_id`) WHERE "meeting_host"."role" = 'host' AND "meeting_host"."revoked_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_host_live_grant_unique_index` ON `meeting_host` (`meeting_id`,`user_id`) WHERE "meeting_host"."revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX `meeting_host_meeting_revoked_index` ON `meeting_host` (`meeting_id`,`revoked_at`);
--> statement-breakpoint
-- THE DOOR. A locked room refuses arrivals at the join path and touches nobody already in it, so the
-- pair is shaped exactly like the ended pair beside it and constrained with it: an instant with no
-- actor is a record nobody can ask who shut the door.
ALTER TABLE `meeting` ADD `locked_at` text;--> statement-breakpoint
ALTER TABLE `meeting` ADD `locked_by_user_id` text REFERENCES member(user_id) CHECK ((`locked_at` IS NULL) = (`locked_by_user_id` IS NULL));--> statement-breakpoint
-- HOW A STAY ENDED, as a column a read can ask a question of. The reason already travels on the
-- `meetings.meeting.left` audit row and that row stays the accountable half; this is the queryable
-- half, because the join path has to refuse a member whose stay was closed `removed` and a refusal
-- that walked a matter's audit log to decide would be a read of the wrong record entirely.
--
-- NOTHING IS BACKFILLED. Null means "closed before the record kept the reason", and writing 'left'
-- over the existing rows would invent a fact about every socket that was ever lost.
ALTER TABLE `meeting_attendance` ADD `ended_reason` text CHECK (`ended_reason` IS NULL OR (`left_at` IS NOT NULL AND `ended_reason` IN ('left', 'socket-lost', 'removed', 'denied')));
