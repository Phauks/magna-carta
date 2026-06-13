CREATE TABLE `direct_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`member_user_id` text NOT NULL,
	`permission` text NOT NULL,
	`expires_at` text,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `direct_grant_member_user_id_index` ON `direct_grant` (`member_user_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member_role` (
	`id` text PRIMARY KEY NOT NULL,
	`member_user_id` text NOT NULL,
	`role_id` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_role_member_user_id_role_id_unique` ON `member_role` (`member_user_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `role` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_name_unique` ON `role` (`name`);--> statement-breakpoint
CREATE TABLE `role_permission` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permission_role_id_permission_unique` ON `role_permission` (`role_id`,`permission`);--> statement-breakpoint
-- Seeded default roles (hand-appended). The rol_/rpm_ handles below were minted ONCE with
-- @magna-carta/identifiers and committed as literals, so every firm's defaults match byte-for-byte.
-- created_at is the migration's authoring instant — a fixed literal, never a runtime expression.
-- Permission values are registry keys from @magna-carta/access-control; a fitness test cross-checks
-- every seeded value against the registry. firm:manageMembers goes to Owner/Admin ONLY.
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('rol_Gw-zKO8hOHQuNv2bWokMp', 'Owner/Admin', '2026-06-10T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('rol_gEyJ_YqL1_RI_yDqSa28Y', 'Attorney', '2026-06-10T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('rol_917LCQyRKP50Z9bW89vXl', 'Paralegal', '2026-06-10T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('rol_hwwC1D98d8Lazc_asL6vO', 'Billing', '2026-06-10T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('rol_WojF9F7kksBEftsmZGNhb', 'Read-only', '2026-06-10T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rpm_bjqp0FuxHVqfwweoS4lNd', 'rol_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageMembers');
