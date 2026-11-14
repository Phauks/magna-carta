-- A ROOM CAN BE THE FIRM'S AS WELL AS A MEMBER'S, AND ANY ROOM CAN BE NAMED.
--
-- `kind` is `personal` (a member's own room, at most one each) or `shared` (a room the firm keeps, such
-- as "Red Room" or "Large Conference Room", opened by anybody who may host). `title` is the room's
-- name, which a member's own room has only once they give it one. `retired_at` is when a shared room
-- was taken off the firm's list; its sessions stay on the record.
--
-- The one-room-per-member index becomes partial on `personal`, so the member who sets up a shared room
-- is not refused for already having a room of their own.
--
-- contract: nothing is rebuilt. The three are ADDED columns carrying their own CHECK, because the table
-- is a parent (`meeting.personal_room_id`) and a rebuild of a parent cannot commit in a durable object;
-- the index is dropped and made again in the same migration.
ALTER TABLE `meeting_personal_room` ADD `kind` text DEFAULT 'personal' NOT NULL CHECK (`kind` IN ('personal', 'shared'));--> statement-breakpoint
ALTER TABLE `meeting_personal_room` ADD `title` text CHECK (`title` IS NULL OR length(`title`) BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE `meeting_personal_room` ADD `retired_at` text;--> statement-breakpoint
DROP INDEX `meeting_personal_room_owner_unique_index`;--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_personal_room_owner_unique_index` ON `meeting_personal_room` (`owner_user_id`) WHERE "meeting_personal_room"."kind" = 'personal';
