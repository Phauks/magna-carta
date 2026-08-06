CREATE TABLE `magnus_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`created_by` text NOT NULL,
	`matter_id` text,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "magnus_conversation_state_check" CHECK("magnus_conversation"."state" IN ('active', 'archived', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `magnus_conversation_created_by_index` ON `magnus_conversation` (`created_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `magnus_conversation_matter_index` ON `magnus_conversation` (`matter_id`);--> statement-breakpoint
CREATE TABLE `magnus_member_acknowledgement` (
	`user_id` text PRIMARY KEY NOT NULL,
	`disclosure_version` integer NOT NULL,
	`acknowledged_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `magnus_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`speaker` text NOT NULL,
	`content` text,
	`status` text NOT NULL,
	`failure_label` text,
	`model_id` text,
	`snapshot_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`context_truncated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `magnus_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "magnus_turn_speaker_check" CHECK("magnus_turn"."speaker" IN ('member', 'magnus')),
	CONSTRAINT "magnus_turn_status_check" CHECK("magnus_turn"."status" IN ('pending', 'complete', 'failed', 'refused')),
	CONSTRAINT "magnus_turn_failure_label_check" CHECK("magnus_turn"."failure_label" IS NULL OR "magnus_turn"."failure_label" IN ('model-unavailable', 'not-eligible', 'ceiling-reached', 'too-large', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magnus_turn_conversation_sequence_unique` ON `magnus_turn` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `magnus_turn_created_at_index` ON `magnus_turn` (`created_at`);--> statement-breakpoint
-- The two Magnus permissions, seeded onto the default roles.
--
-- magnus:converse reaches the seats that do legal work (Owner/Admin, Attorney, Paralegal) and
-- neither Billing nor Read-only by default; magnus:readAllConversations reaches Owner/Admin only,
-- because reading every member's conversation is a supervision capability and not the same grant as
-- being able to hold one. A firm that wants a different list changes role configuration — no code.
--
-- Seeding these grants turns NOTHING on. The firm-level `magnus.enabled` setting defaults closed and
-- so does `inference.aiProcessingEligibility`, and both are read before anything is enqueued; a
-- member holding magnus:converse in a firm that has not opted in is refused at the route.
--
-- The rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusConverseOwner00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'magnus:converse');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusConverseAttorne', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'magnus:converse');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusConverseParaleg', 'role_917LCQyRKP50Z9bW89vXl', 'magnus:converse');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusReadAllOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'magnus:readAllConversations');