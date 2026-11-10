-- A RECORDING IS COMPOSED A WINDOW AT A TIME, AND WHERE IT HAS GOT TO IS ON ITS ROW.
--
-- The compose step mixes a stopped recording's staged tracks into one document a bounded window per
-- queue message, so its cursor has to outlive each invocation. Five columns on meeting_recording, all
-- added rather than rebuilt (it is a parent table), all handles and counts — no audio and no name:
--
--   compose_upload_session_id  the file pipeline's upload session the composite is written through,
--                              by value; the pipeline's own row owns the key and the multipart upload
--   compose_parts_done         how many parts of the composite have uploaded — the cursor
--   compose_parts              the uploaded parts as R2 returned them (number and entity tag, JSON),
--                              which completing the upload needs and the storage binding cannot list
--   compose_attempts           how many times a stalled compose was handed on again, which bounds it
--   compose_progress_at        when it last made progress, which a stall is measured from
ALTER TABLE `meeting_recording` ADD `compose_upload_session_id` text;--> statement-breakpoint
ALTER TABLE `meeting_recording` ADD `compose_parts_done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_recording` ADD `compose_parts` text;--> statement-breakpoint
ALTER TABLE `meeting_recording` ADD `compose_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_recording` ADD `compose_progress_at` text;