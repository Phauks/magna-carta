-- AN EXTERNAL GUEST: A SIGNED LINK FOR ONE NAMED DIRECTORY ENTITY, AND A STAY OF ITS OWN.
--
-- A meeting was firm members only, because a participant was somebody holding a session. A hearing,
-- a settlement conference and a client call are not that, and the client portal's grant model —
-- the real answer to "somebody outside the firm may reach this" — is not started. So a guest is a
-- Directory entity on the meeting's event, holding a signed, expiring link that proves possession of
-- a mailbox and nothing more: it gets them to the lobby, and a host admits them.
--
-- TWO TABLES, BOTH NEW, AND NOTHING EXISTING IS TOUCHED. `meeting_guest_invitation` is the durable
-- authority behind a bearer token that is never stored — it keeps the SHA-256 of the token's secret,
-- a secret version a rotation increments, the expiry instant computed once at mint, and a revocation
-- pair — so a revoked, rotated or expired row refuses a perfectly-signed token at once.
-- `meeting_guest_stay` is the guest's stay, column for column the shape `meeting_attendance` has
-- since the waiting room, so the two presence predicates compose over both tables.
--
-- WHY A SECOND STAY TABLE RATHER THAN A NULLABLE `meeting_attendance.user_id`. SQLite cannot drop a
-- NOT NULL in place, so relaxing that column is a table rebuild — and `meeting_attendance` is a
-- table other rows point at, which a durable object refuses to rebuild (packages/database/CLAUDE.md).
-- Adding a table drops nothing. The chat's author column was made a by-value handle beside a kind in
-- its own migration for exactly this reason, so a guest's line needs nothing here.
--
-- THE ADDRESS IS NOT STORED. `directory_email_id` names which contact point the link was sent to;
-- the address stays the Directory's fact.
--
-- HAND-WRITTEN for the reasons this lineage usually is: drizzle-kit cannot express the partial
-- indexes, and the checks name a second column. The snapshot is refreshed in the same commit.
CREATE TABLE `meeting_guest_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`invited_name` text NOT NULL,
	`directory_email_id` text,
	`token_secret_hash` text NOT NULL,
	`secret_version` integer DEFAULT 1 NOT NULL,
	`issued_by_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`arrival_count` integer DEFAULT 0 NOT NULL,
	`last_arrival_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_guest_invitation_entity_kind_check" CHECK("meeting_guest_invitation"."entity_kind" IN ('person', 'organization')),
	CONSTRAINT "meeting_guest_invitation_invited_name_check" CHECK(length("meeting_guest_invitation"."invited_name") > 0),
	CONSTRAINT "meeting_guest_invitation_secret_hash_check" CHECK(length("meeting_guest_invitation"."token_secret_hash") = 64),
	CONSTRAINT "meeting_guest_invitation_secret_version_check" CHECK("meeting_guest_invitation"."secret_version" >= 1),
	CONSTRAINT "meeting_guest_invitation_arrival_count_check" CHECK("meeting_guest_invitation"."arrival_count" >= 0),
	CONSTRAINT "meeting_guest_invitation_revoked_shape_check" CHECK(("meeting_guest_invitation"."revoked_at" IS NULL) = ("meeting_guest_invitation"."revoked_by_user_id" IS NULL))
);
--> statement-breakpoint
-- ONE LIVE LINK PER ENTITY PER MEETING: a second mint against the same pair rotates this row. Its
-- leading column also serves "every invitation on this meeting", so no second index is kept for it.
CREATE UNIQUE INDEX `meeting_guest_invitation_meeting_entity_unique_index` ON `meeting_guest_invitation` (`meeting_id`,`entity_id`);
--> statement-breakpoint
CREATE TABLE `meeting_guest_stay` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`invitation_id` text NOT NULL,
	`confirmed_name` text NOT NULL,
	`joined_at` text NOT NULL,
	`waiting_from` text NOT NULL,
	`admitted_at` text,
	`admitted_by_user_id` text,
	`left_at` text,
	`ended_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invitation_id`) REFERENCES `meeting_guest_invitation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admitted_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_guest_stay_confirmed_name_check" CHECK(length("meeting_guest_stay"."confirmed_name") > 0 AND length("meeting_guest_stay"."confirmed_name") <= 80),
	CONSTRAINT "meeting_guest_stay_admission_shape_check" CHECK(("meeting_guest_stay"."admitted_at" IS NULL) = ("meeting_guest_stay"."admitted_by_user_id" IS NULL)),
	CONSTRAINT "meeting_guest_stay_span_check" CHECK("meeting_guest_stay"."left_at" IS NULL OR "meeting_guest_stay"."left_at" >= "meeting_guest_stay"."joined_at"),
	CONSTRAINT "meeting_guest_stay_ended_reason_check" CHECK("meeting_guest_stay"."ended_reason" IS NULL
        OR ("meeting_guest_stay"."left_at" IS NOT NULL
          AND "meeting_guest_stay"."ended_reason" IN ('left', 'socket-lost', 'removed', 'denied')))
);
--> statement-breakpoint
CREATE INDEX `meeting_guest_stay_meeting_left_at_index` ON `meeting_guest_stay` (`meeting_id`,`left_at`);
--> statement-breakpoint
-- WHO IS AT THE DOOR: the member table's waiting index, for the second table, partial on exactly the
-- set the lobby list and the door's ceiling are asked of.
CREATE INDEX `meeting_guest_stay_waiting_index` ON `meeting_guest_stay` (`meeting_id`,`waiting_from`) WHERE "meeting_guest_stay"."left_at" IS NULL AND "meeting_guest_stay"."admitted_at" IS NULL;
--> statement-breakpoint
-- ONE OPEN STAY PER INVITATION PER MEETING, held here because two browsers pressing Join on one
-- link at once both read no open stay: the loser's batch rolls back and it is handed the winner's.
CREATE UNIQUE INDEX `meeting_guest_stay_open_stay_unique_index` ON `meeting_guest_stay` (`meeting_id`,`invitation_id`) WHERE "meeting_guest_stay"."left_at" IS NULL;
