-- Matter staffing beyond the single responsible attorney, and the member professional profile
-- documents read from. Two tables, no seed rows: staffing is recorded per matter by the firm, and a
-- profile exists only once a member (or an administrator) writes one.
--
-- The responsible attorney deliberately STAYS on matter.responsible_member_id — one home per fact —
-- and the write path refuses an assignment role that normalizes to it. A member's bar number is
-- deliberately NOT a profile column: it lives encrypted in directory_identifier on the member's
-- mapped Directory person, read only through the protected-field chokepoint.
CREATE TABLE `matter_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`assignment_role` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "matter_assignment_role_nonempty_check" CHECK(length("matter_assignment"."assignment_role") > 0),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matter_assignment_matter_id_index` ON `matter_assignment` (`matter_id`);--> statement-breakpoint
CREATE INDEX `matter_assignment_member_user_id_index` ON `matter_assignment` (`member_user_id`);--> statement-breakpoint
CREATE INDEX `directory_person_member_id_index` ON `directory_person` (`member_id`) WHERE "directory_person"."member_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `member_professional_profile` (
	`member_user_id` text PRIMARY KEY NOT NULL,
	`title` text,
	`admissions` text,
	`direct_dial` text,
	`professional_email` text,
	`signature_block` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
