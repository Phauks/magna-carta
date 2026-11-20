-- SHARING A FILE, A FOLDER OR A MATTER'S TOP LEVEL WITH A PERSON OUTSIDE THE FIRM.
--
-- One new leaf table, `share`, and one new permission, files:share, for the three roles that work a
-- matter's files (Owner/Admin, Attorney, Paralegal). Billing and Read Only do not share: sending a
-- firm document outside the firm is a judgment about the matter, not a clerical step. The seed shape
-- is the house one, plain INSERTs, so tooling/lint-ungranted-permissions reads it.
CREATE TABLE `share` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`scope` text NOT NULL,
	`folder_id` text,
	`file_id` text,
	`file_version_id` text,
	`target_id` text NOT NULL,
	`recipient_entity_id` text NOT NULL,
	`role` text NOT NULL,
	`allow_download` integer DEFAULT 1 NOT NULL,
	`sign_in` text DEFAULT 'emailCode' NOT NULL,
	`ends_on` text,
	`status` text DEFAULT 'active' NOT NULL,
	`shared_by_user_id` text NOT NULL,
	`revoked_by_user_id` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shared_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "share_scope_check" CHECK("share"."scope" IN ('matter', 'folder', 'file')),
	CONSTRAINT "share_target_shape_check" CHECK(("share"."scope" = 'matter' AND "share"."folder_id" IS NULL AND "share"."file_id" IS NULL AND "share"."file_version_id" IS NULL AND "share"."target_id" = "share"."matter_id")
        OR ("share"."scope" = 'folder' AND "share"."folder_id" IS NOT NULL AND "share"."file_id" IS NULL AND "share"."file_version_id" IS NULL AND "share"."target_id" = "share"."folder_id")
        OR ("share"."scope" = 'file' AND "share"."file_id" IS NOT NULL AND "share"."folder_id" IS NULL AND "share"."target_id" = "share"."file_id")),
	CONSTRAINT "share_role_check" CHECK("share"."role" IN ('viewer', 'commenter', 'editor')),
	CONSTRAINT "share_allow_download_check" CHECK("share"."allow_download" IN (0, 1)),
	CONSTRAINT "share_sign_in_check" CHECK("share"."sign_in" IN ('link', 'emailCode', 'twoStep')),
	CONSTRAINT "share_status_check" CHECK("share"."status" IN ('active', 'revoked')),
	CONSTRAINT "share_revoked_shape_check" CHECK(("share"."status" = 'revoked') = ("share"."revoked_at" IS NOT NULL AND "share"."revoked_by_user_id" IS NOT NULL)),
	CONSTRAINT "share_ends_on_shape_check" CHECK("share"."ends_on" IS NULL OR "share"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_recipient_target_active_unique_index` ON `share` (`recipient_entity_id`,`target_id`) WHERE "share"."status" = 'active';--> statement-breakpoint
CREATE INDEX `share_matter_id_status_index` ON `share` (`matter_id`,`status`);--> statement-breakpoint
CREATE INDEX `share_target_id_index` ON `share` (`target_id`);
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_filesShareAdmin000000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:share');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_filesShareAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'files:share');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_filesShareParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'files:share');
