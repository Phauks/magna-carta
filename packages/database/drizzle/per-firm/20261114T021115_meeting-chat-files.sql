-- A file shared in a meeting's chat: the message points at one of the matter's own files. Added as a
-- column, never by rebuilding meeting_message, which questions and their answers reference.
ALTER TABLE `meeting_message` ADD `attached_file_id` text REFERENCES file(id);
