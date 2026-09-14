-- A MATTER'S FILE, ATTACHED TO A MAGNUS CONVERSATION BY REFERENCE.
--
-- The row points at the file and copies nothing of it. The readable text the model is sent is taken
-- from the file's current clean version at the moment a question is asked and is kept nowhere else,
-- so the file subsystem's erasure and retention posture is the attachment's too. The pair is the
-- identity: a retried attach of the same file to the same conversation is the same attachment.
--
-- text_status / text_bytes record what became of the file's text on the most recent question, so the
-- conversation can say per file whether the model saw the document whole, saw part of it, or saw
-- nothing of it.
CREATE TABLE `magnus_conversation_attachment` (
	`conversation_id` text NOT NULL,
	`file_id` text NOT NULL,
	`attached_at` text NOT NULL,
	`text_status` text DEFAULT 'pending' NOT NULL,
	`text_bytes` integer,
	PRIMARY KEY(`conversation_id`, `file_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `magnus_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "magnus_conversation_attachment_text_status_check" CHECK("magnus_conversation_attachment"."text_status" IN ('pending', 'sent', 'cut', 'unreadable'))
);
