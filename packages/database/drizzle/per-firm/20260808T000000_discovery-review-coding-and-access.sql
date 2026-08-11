-- Discovery — the review-set access list and the coding model. Five tables, created parent-first so
-- a reader can follow the references down the page, plus the access-list backfill and the two new
-- discovery permission grants.
--
-- Hand-authored beyond what drizzle-kit emits: the three partial unique indexes (drizzle-kit emits
-- the index but this lineage keeps every WHERE clause written out where a reader will see it), the
-- backfill that keeps every review set created before this migration reachable, and the role seeds.
CREATE TABLE `review_set_access` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_set_access_member_unique_index` ON `review_set_access` (`review_set_id`,`member_user_id`);--> statement-breakpoint
CREATE INDEX `review_set_access_member_index` ON `review_set_access` (`member_user_id`,`review_set_id`);--> statement-breakpoint
CREATE TABLE `review_tag_group` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`cardinality` text NOT NULL,
	`required_for_completion` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_tag_group_kind_check" CHECK("review_tag_group"."kind" IN ('system', 'custom')),
	CONSTRAINT "review_tag_group_cardinality_check" CHECK("review_tag_group"."cardinality" IN ('single', 'multi')),
	CONSTRAINT "review_tag_group_name_nonempty_check" CHECK(length("review_tag_group"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_tag_group_review_set_name_unique_index` ON `review_tag_group` (`review_set_id`,`name`);--> statement-breakpoint
CREATE INDEX `review_tag_group_review_set_order_index` ON `review_tag_group` (`review_set_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `review_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`review_tag_group_id` text NOT NULL,
	`review_set_id` text NOT NULL,
	`name` text NOT NULL,
	`semantic` text,
	`color_token` text NOT NULL,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_tag_group_id`) REFERENCES `review_tag_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_tag_semantic_check" CHECK("review_tag"."semantic" IS NULL OR "review_tag"."semantic" IN ('responsive', 'non-responsive', 'needs-further-review', 'privileged', 'privileged-redact', 'not-privileged', 'confidential')),
	CONSTRAINT "review_tag_name_nonempty_check" CHECK(length("review_tag"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_tag_group_name_unique_index` ON `review_tag` (`review_tag_group_id`,`name`);--> statement-breakpoint
CREATE INDEX `review_tag_review_set_index` ON `review_tag` (`review_set_id`,`review_tag_group_id`);--> statement-breakpoint
CREATE TABLE `review_tag_event` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`kind` text NOT NULL,
	`review_tag_id` text NOT NULL,
	`scope` text NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`criteria` text,
	`selection_r2_key` text,
	`state` text DEFAULT 'running' NOT NULL,
	`reverses_event_id` text,
	`actor_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_tag_id`) REFERENCES `review_tag`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_tag_event_kind_check" CHECK("review_tag_event"."kind" IN ('apply', 'remove', 'bulk-apply', 'bulk-remove', 'undo')),
	CONSTRAINT "review_tag_event_scope_check" CHECK("review_tag_event"."scope" IN ('document', 'family', 'selection')),
	CONSTRAINT "review_tag_event_state_check" CHECK("review_tag_event"."state" IN ('running', 'complete', 'undone')),
	CONSTRAINT "review_tag_event_document_count_check" CHECK("review_tag_event"."document_count" >= 0),
	CONSTRAINT "review_tag_event_reverses_check" CHECK(("review_tag_event"."kind" = 'undo') = ("review_tag_event"."reverses_event_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `review_tag_event_review_set_created_index` ON `review_tag_event` (`review_set_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `review_tag_event_review_set_actor_index` ON `review_tag_event` (`review_set_id`,`actor_user_id`);--> statement-breakpoint
-- At most one undo per event: history never shortens, and a second reversal of the same act would
-- remove rows the first reversal already attributed.
CREATE UNIQUE INDEX `review_tag_event_reverses_unique_index` ON `review_tag_event` (`reverses_event_id`) WHERE "review_tag_event"."reverses_event_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `review_document_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`review_document_id` text NOT NULL,
	`review_tag_id` text NOT NULL,
	`review_tag_group_id` text NOT NULL,
	`single_choice` integer NOT NULL,
	`applied_by_event_id` text NOT NULL,
	`applied_at` text NOT NULL,
	`removed_by_event_id` text,
	`removed_at` text,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_tag_id`) REFERENCES `review_tag`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_tag_group_id`) REFERENCES `review_tag_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_by_event_id`) REFERENCES `review_tag_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_tag_removal_check" CHECK(("review_document_tag"."removed_at" IS NULL) = ("review_document_tag"."removed_by_event_id" IS NULL))
);
--> statement-breakpoint
-- SINGLE CHOICE IS STRUCTURAL, NOT GUARDED. Two concurrent writers cannot leave a document both
-- responsive and non-responsive, because the index refuses the second row. The denormalized
-- `review_tag_group_id` and `single_choice` columns exist so this index can be written at all — an
-- index cannot reach through a join.
CREATE UNIQUE INDEX `review_document_tag_single_choice_unique_index` ON `review_document_tag` (`review_document_id`,`review_tag_group_id`) WHERE "review_document_tag"."removed_at" IS NULL AND "review_document_tag"."single_choice" = 1;--> statement-breakpoint
-- At most one LIVE row per (document, tag), so a double-apply converges instead of accumulating rows
-- a later removal would only half-clear.
CREATE UNIQUE INDEX `review_document_tag_live_unique_index` ON `review_document_tag` (`review_document_id`,`review_tag_id`) WHERE "review_document_tag"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `review_document_tag_document_index` ON `review_document_tag` (`review_document_id`,`removed_at`);--> statement-breakpoint
CREATE INDEX `review_document_tag_review_set_tag_index` ON `review_document_tag` (`review_set_id`,`review_tag_id`,`removed_at`);--> statement-breakpoint
CREATE INDEX `review_document_tag_applied_event_index` ON `review_document_tag` (`applied_by_event_id`);--> statement-breakpoint
CREATE INDEX `review_document_tag_removed_event_index` ON `review_document_tag` (`removed_by_event_id`);--> statement-breakpoint
-- THE BACKFILL. Every review set that existed before this migration gets exactly one access row, for
-- the member who created it. Without it those corpora would become reachable by nobody the instant
-- the list starts being enforced, because the list is fail-closed and they have no rows.
--
-- One row for the creator rather than for the matter team, deliberately: widening an access list is a
-- recorded act somebody performs on purpose, and inferring a wall's membership from staffing at
-- migration time would assert something about who was cleared that nobody ever decided. The creator
-- can add the rest, and the audit log will say when they did.
--
-- The row id is DERIVED from the review set's own handle rather than minted, because a migration has
-- no random source: `reviewSet_` is ten characters, so substr(id, 11) is the 21-character token, and
-- re-prefixing it yields a well-formed reviewSetAccess handle that is unique because the review set's
-- was. `granted_by` names the creator too — nobody else made this grant.
INSERT INTO `review_set_access` (`id`, `review_set_id`, `member_user_id`, `granted_by`, `created_at`)
SELECT 'reviewSetAccess_' || substr(`id`, 11), `id`, `created_by`, `created_by`, `created_at`
FROM `review_set`;--> statement-breakpoint
-- The two new discovery permissions, seeded onto the same three default roles the first three reach
-- (Owner/Admin, Attorney, Paralegal) and neither Billing nor Read-only.
--
-- `discovery:review` codes documents; `discovery:produce` is the consequential gate — it manages the
-- access list, and later stages and cuts productions. Privilege DESIGNATION rides discovery:review
-- with everything else rather than taking a tier of its own: the produce gate is where a designation
-- becomes consequential to the outside world, and gating the coding gesture itself would make
-- privilege review a bottleneck in exactly the small firms this platform serves.
--
-- The rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReviewOwner0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:review');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReviewAttorn', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:review');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReviewParale', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:review');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryProduceOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:produce');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryProduceAttor', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:produce');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryProduceParal', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:produce');
