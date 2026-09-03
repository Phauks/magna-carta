-- THE MATTER PLAN: two tables and two provenance columns.
--
-- A plan is a firm's own statement of the work a kind of matter takes, as a template that PROPOSES
-- tasks rather than one that writes them. Opening a matter whose type carries a plan offers its
-- tasks with their proposed dates and role-resolved assignees; nothing is written until a member
-- accepts. Writing them outright was the obvious reading and is not what ships, on the owner's call
-- of 2026-09-01 rather than a design preference: the offset below is plain calendar-day
-- addition, so a template can propose a task due on Christmas Day; a role can resolve to nobody on a
-- matter opened before it is staffed; and assignment notifies, so writing silently would tell a
-- member they own work on a matter they have never heard of.
--
-- THE PLATFORM SEEDS NO TEMPLATES. This migration creates the tables and inserts none. A plan is a
-- statement about how THIS firm practises in THIS jurisdiction, and one shipped by the platform with
-- a step in the wrong order is a malpractice vector carrying the platform's name — trusted precisely
-- because it shipped, which is the calendar's own argument about computed dates.
--
-- The anchor vocabulary is `matter_opened` and `none` and nothing else, held by a CHECK so a third
-- value is a migration somebody reviews. Every candidate beyond it — a service date, a filing date, a
-- trigger event — is the front half of a docketing rule, and keeping the vocabulary at one value is
-- the whole reason the offset arithmetic is defensible while the calendar refuses to compute
-- deadlines.
--
-- The two columns added to `matter_task` are PROVENANCE and never a live link: nothing resolves them
-- on a read, so editing a template cannot reach into a matter that already accepted one. They answer
-- the question a firm actually asks — which matters came off the old intake plan.
--
-- Additive throughout: two creates and two nullable column adds, no rebuild.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
CREATE TABLE `matter_plan_task_template` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`default_assignee_role` text,
	`due_anchor` text DEFAULT 'none' NOT NULL,
	`offset_days` integer,
	`blocked_by_template_task_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `matter_plan_template`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_plan_task_template_title_check" CHECK(length("matter_plan_task_template"."title") > 0),
	CONSTRAINT "matter_plan_task_template_priority_check" CHECK("matter_plan_task_template"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "matter_plan_task_template_due_anchor_check" CHECK("matter_plan_task_template"."due_anchor" IN ('matter_opened', 'none')),
	CONSTRAINT "matter_plan_task_template_offset_shape_check" CHECK(("matter_plan_task_template"."due_anchor" = 'none' AND "matter_plan_task_template"."offset_days" IS NULL)
        OR ("matter_plan_task_template"."due_anchor" != 'none' AND "matter_plan_task_template"."offset_days" IS NOT NULL)),
	CONSTRAINT "matter_plan_task_template_blocked_by_self_check" CHECK("matter_plan_task_template"."blocked_by_template_task_id" != "matter_plan_task_template"."id")
);
--> statement-breakpoint
CREATE INDEX `matter_plan_task_template_template_position_index` ON `matter_plan_task_template` (`template_id`,`position`);--> statement-breakpoint
CREATE INDEX `matter_plan_task_template_blocked_by_index` ON `matter_plan_task_template` (`blocked_by_template_task_id`);--> statement-breakpoint
CREATE TABLE `matter_plan_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`matter_type_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_plan_template_name_nonempty_check" CHECK(length("matter_plan_template"."name") > 0),
	CONSTRAINT "matter_plan_template_active_check" CHECK("matter_plan_template"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `matter_plan_template_matter_type_active_index` ON `matter_plan_template` (`matter_type_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_plan_template_name_unique_index` ON `matter_plan_template` (`name`);--> statement-breakpoint
ALTER TABLE `matter_task` ADD `plan_template_id` text REFERENCES matter_plan_template(id);--> statement-breakpoint
ALTER TABLE `matter_task` ADD `plan_task_template_id` text REFERENCES matter_plan_task_template(id);--> statement-breakpoint
CREATE INDEX `matter_task_plan_template_index` ON `matter_task` (`plan_template_id`);--> statement-breakpoint

-- tasks:managePlans, seeded onto Owner/Admin and Attorney and no further.
--
-- Narrower than the other three task keys, and deliberately: those govern doing the work, and this
-- governs the firm's statement of what the work IS. A wrong step in a plan propagates to every matter
-- opened under it, which is closer to the matter-type catalog than to a task. A paralegal who runs
-- the intake plan every week is exactly who should be consulted about changing it and is not
-- necessarily who signs off on the change; a firm that disagrees grants the key, which leaves a
-- record.
--
-- Accepting a proposed plan needs no key of its own: it creates tasks, which tasks:write and
-- tasks:assign already govern.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.

INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksPlansOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:managePlans');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksPlansAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:managePlans');
