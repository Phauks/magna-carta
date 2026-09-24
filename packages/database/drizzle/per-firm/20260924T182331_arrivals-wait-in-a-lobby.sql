-- ONE LOBBY PER MEETING, because a firm holds several meetings at once.
--
-- A firm-level door would put the people arriving at a partner's deposition in the same queue as the
-- people arriving at a staff briefing, in front of a host who is in neither. So the setting is a
-- column on the meeting, off by default — every participant today is a firm member arriving at an
-- event they are on, and a lobby on by default would queue a colleague for every ordinary hearing.
--
-- IT CHANGES, UNLIKE THE MEDIUM BESIDE IT, and the difference is worth stating because `medium` is
-- deliberately write-once. A medium is what the people already in the room agreed to, so widening it
-- would be a camera switched on for everybody by somebody else's click. A lobby is about who may
-- come in, which is a standing decision of the host's and has no bearing on what anybody agreed to.
--
-- A WAITING ARRIVAL IS A STAY FROM THE MOMENT IT REACHES THE DOOR. The alternative — holding waiters
-- in the signaling room's own storage and writing the attendance row only on admission — was
-- rejected for three reasons: the socket upgrade's ticket is an open stay and a waiter needs a
-- socket, the room's storage is transient signaling state deleted when the last socket closes, and
-- the record would keep nothing about who waited and was never let in, which is a thing a firm may
-- need to say. `joined_at` therefore widens to mean "when this stay began", at the door or in the
-- room, and `admitted_at` is when the person was actually in it; making `joined_at` nullable would
-- be a table rebuild that buys nothing the second column does not.
--
-- NOTHING IS BACKFILLED and nothing needs to be: both columns are null on every stay that predates
-- the lobby, which is the truth — none of those people waited.
--
-- HAND-WRITTEN for the reasons this lineage usually is: drizzle-kit cannot express a partial index,
-- and the added column carries a CHECK naming a second column. Adding a column drops nothing, so
-- `meeting` and `meeting_attendance` keep every row and every child reference — which is why a
-- vocabulary on a parent grows by a column here rather than by widening a CHECK
-- (packages/database/CLAUDE.md). The snapshot is refreshed in the same commit.
ALTER TABLE `meeting` ADD `lobby` text DEFAULT 'off' NOT NULL CHECK (`lobby` IN ('off', 'on'));--> statement-breakpoint
ALTER TABLE `meeting_attendance` ADD `waiting_from` text;--> statement-breakpoint
ALTER TABLE `meeting_attendance` ADD `admitted_at` text CHECK (`admitted_at` IS NULL OR `waiting_from` IS NOT NULL);--> statement-breakpoint
-- WHO IS AT THE DOOR OF ONE MEETING, and the set the admission's own capacity count is taken
-- beside. Partial on the stays that are neither closed nor admitted, which is the only set either
-- question is asked of; `waiting_from` second, so the lobby list comes back in arrival order
-- without a sort.
CREATE INDEX `meeting_attendance_waiting_index` ON `meeting_attendance` (`meeting_id`,`waiting_from`) WHERE "meeting_attendance"."left_at" IS NULL AND "meeting_attendance"."admitted_at" IS NULL;
