-- WHAT HAPPENED ON THE LINE, AND THE NAME THE CALLER GAVE.
--
-- Four nullable columns on a populated table, so no CHECK rides along (SQLite cannot add one without
-- the table rebuild the expand-contract rule forbids); packages/communications/src/validation.ts
-- holds the vocabularies instead. Every existing row keeps null in each: nobody recorded an outcome
-- for them, and inventing one would put words in a member's mouth.
ALTER TABLE `communication` ADD `caller_id_name` text;--> statement-breakpoint
ALTER TABLE `communication` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `communication` ADD `spam_kind` text;--> statement-breakpoint
ALTER TABLE `communication` ADD `message_task_id` text;
