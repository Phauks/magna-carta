-- A TRANSCRIPT OUTLASTS A SPEECH MODEL THAT IS DOWN FOR A WHILE, AND COUNTS EVERY MILLISECOND IT SENDS.
--
-- Two columns on meeting_transcript, both ADDED rather than rebuilt (it is a parent table: its segments
-- reference it), each carrying its own CHECK, and both counts — no content:
--
--   model_failures            how many windows in a row met a speech model that refused for now (busy,
--                             unreachable) with no progress between them. Each retry is sent with a
--                             delay that doubles, and the transcript fails only past a limit that
--                             outlasts an outage of tens of minutes; any progress resets the count. It
--                             replaces counting the queue's deliveries of one message, which failed a
--                             transcript after about thirty seconds of an outage — and failed one that
--                             was moving on every delivery but met a different refusal each time.
--   transcribed_milliseconds  the audio sent to the model, which is what it is billed by, added up
--                             exactly. `transcribed_seconds` rounded each piece to a whole second before
--                             adding it, so every piece under half a second — a "yes", a name — counted
--                             as none. It is backfilled here from the seconds already counted, and the
--                             old column is no longer written; it stays where it stands, because
--                             dropping a column from a parent table is a rebuild.
--
-- contract: nothing is dropped and nothing is rebuilt. Two columns are added and the second is filled
-- from the column it supersedes; a firm with no transcript runs the UPDATE and changes nothing.
ALTER TABLE `meeting_transcript` ADD `model_failures` integer DEFAULT 0 NOT NULL CHECK (`model_failures` >= 0);--> statement-breakpoint
ALTER TABLE `meeting_transcript` ADD `transcribed_milliseconds` integer DEFAULT 0 NOT NULL CHECK (`transcribed_milliseconds` >= 0);--> statement-breakpoint
UPDATE `meeting_transcript` SET `transcribed_milliseconds` = `transcribed_seconds` * 1000;
