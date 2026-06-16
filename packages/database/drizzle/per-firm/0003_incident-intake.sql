CREATE TABLE `incident` (
	`id` text PRIMARY KEY NOT NULL,
	`error_ids` text NOT NULL,
	`breadcrumbs` text NOT NULL,
	`description` text NOT NULL,
	`context` text NOT NULL,
	`screenshot_key` text,
	`status` text DEFAULT 'open' NOT NULL,
	`reported_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
-- Seed firm:reportIncident onto EVERY default role (slice 0·6): any member may file a diagnostic
-- incident. The rolePermission_ handles below were minted once with @magna-carta/identifiers and committed as
-- literals (the 0002_member-rbac seeding convention); the role_id values are the 0002 role handles.
-- A fitness test cross-checks the permission value against the @magna-carta/access-control registry.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_J_VyO7k3_3vtHilg3W6_C', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:reportIncident');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_BEmU6-yJ-oxxRgiKej09M', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:reportIncident');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tV_NzqUOofB1b3KhRBWau', 'role_917LCQyRKP50Z9bW89vXl', 'firm:reportIncident');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_aiznofBuFRS1JUUjHVB4N', 'role_hwwC1D98d8Lazc_asL6vO', 'firm:reportIncident');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_dL4NdTy1qANtzn2SihyGJ', 'role_WojF9F7kksBEftsmZGNhb', 'firm:reportIncident');