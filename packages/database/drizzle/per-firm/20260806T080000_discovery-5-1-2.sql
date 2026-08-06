-- Discovery — the review-set model. Six tables, created parent-first so a reader can follow the
-- references down the page, plus the forward-only state machines as triggers and the discovery
-- permission grants.
--
-- Hand-authored beyond what drizzle-kit emits: the partial unique index on a loaded file version
-- (drizzle cannot express a WHERE on a unique index), the three state-machine triggers (which are the
-- rules a second write path would otherwise not know about), and the role seeds.
CREATE TABLE `review_set` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`name` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`document_ceiling` integer NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`semantic_index_enabled` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`locked_at` text,
	`closed_at` text,
	`derived_artifacts_released_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_set_state_check" CHECK("review_set"."state" IN ('open', 'locked', 'closed')),
	CONSTRAINT "review_set_name_nonempty_check" CHECK(length("review_set"."name") > 0),
	CONSTRAINT "review_set_ceiling_positive_check" CHECK("review_set"."document_ceiling" > 0),
	CONSTRAINT "review_set_document_count_nonnegative_check" CHECK("review_set"."document_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_set_matter_name_unique_index` ON `review_set` (`matter_id`,`name`);--> statement-breakpoint
CREATE INDEX `review_set_matter_created_index` ON `review_set` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `record_custodian` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`display_name` text NOT NULL,
	`directory_entity_id` text,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "record_custodian_kind_check" CHECK("record_custodian"."kind" IN ('person', 'organization', 'unattributed')),
	CONSTRAINT "record_custodian_name_nonempty_check" CHECK(length("record_custodian"."display_name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_custodian_review_set_name_unique_index` ON `record_custodian` (`review_set_id`,`display_name`);--> statement-breakpoint
CREATE INDEX `record_custodian_directory_entity_index` ON `record_custodian` (`directory_entity_id`);--> statement-breakpoint
CREATE TABLE `discovery_load` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`lane` text NOT NULL,
	`state` text DEFAULT 'declared' NOT NULL,
	`transcript_scope` text NOT NULL,
	`declared_document_count` integer DEFAULT 0 NOT NULL,
	`loaded_document_count` integer DEFAULT 0 NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`exception_count` integer DEFAULT 0 NOT NULL,
	`default_record_custodian_id` text,
	`source_description` text,
	`initiated_by` text NOT NULL,
	`initiated_at` text NOT NULL,
	`completed_at` text,
	`manifest_r2_key` text,
	`exception_report_r2_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_record_custodian_id`) REFERENCES `record_custodian`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discovery_load_lane_check" CHECK("discovery_load"."lane" IN ('internal-files', 'internal-email', 'received-production', 'direct-collection')),
	CONSTRAINT "discovery_load_state_check" CHECK("discovery_load"."state" IN ('declared', 'loading', 'processing', 'complete', 'failed', 'reversed')),
	CONSTRAINT "discovery_load_transcript_scope_check" CHECK("discovery_load"."transcript_scope" IN ('exclude', 'include')),
	CONSTRAINT "discovery_load_counts_nonnegative_check" CHECK("discovery_load"."declared_document_count" >= 0 AND "discovery_load"."loaded_document_count" >= 0 AND "discovery_load"."processed_count" >= 0 AND "discovery_load"."exception_count" >= 0),
	CONSTRAINT "discovery_load_reconciliation_check" CHECK("discovery_load"."state" <> 'complete' OR "discovery_load"."loaded_document_count" = "discovery_load"."processed_count" + "discovery_load"."exception_count")
);
--> statement-breakpoint
CREATE INDEX `discovery_load_review_set_initiated_index` ON `discovery_load` (`review_set_id`,`initiated_at`,`id`);--> statement-breakpoint
CREATE INDEX `discovery_load_review_set_state_index` ON `discovery_load` (`review_set_id`,`state`);--> statement-breakpoint
CREATE TABLE `review_document` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`discovery_load_id` text NOT NULL,
	`record_custodian_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`file_version_id` text,
	`email_message_id` text,
	`family_id` text NOT NULL,
	`family_role` text DEFAULT 'standalone' NOT NULL,
	`family_sequence` integer DEFAULT 0 NOT NULL,
	`source_name` text,
	`source_path` text,
	`size_bytes` integer,
	`content_sha256` text,
	`content_md5` text,
	`content_sha1` text,
	`text_r2_key` text,
	`metadata_r2_key` text,
	`page_count` integer,
	`text_fingerprint` text,
	`dedup_group_id` text,
	`is_dedup_primary` integer DEFAULT true NOT NULL,
	`processing_state` text DEFAULT 'pending' NOT NULL,
	`format_identified` text,
	`sort_date` text,
	`sort_date_source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discovery_load_id`) REFERENCES `discovery_load`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_custodian_id`) REFERENCES `record_custodian`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_source_kind_check" CHECK("review_document"."source_kind" IN ('file_version', 'email_message', 'email_attachment')),
	CONSTRAINT "review_document_exactly_one_source_check" CHECK(("review_document"."file_version_id" IS NOT NULL) + ("review_document"."email_message_id" IS NOT NULL) = 1),
	CONSTRAINT "review_document_processing_state_check" CHECK("review_document"."processing_state" IN ('pending', 'processing', 'processed', 'excepted')),
	CONSTRAINT "review_document_processed_names_format_check" CHECK("review_document"."processing_state" <> 'processed' OR "review_document"."format_identified" IS NOT NULL),
	CONSTRAINT "review_document_family_role_check" CHECK("review_document"."family_role" IN ('standalone', 'parent', 'attachment', 'container-child')),
	CONSTRAINT "review_document_standalone_family_check" CHECK("review_document"."family_role" <> 'standalone' OR "review_document"."family_id" = "review_document"."id")
);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_sort_index` ON `review_document` (`review_set_id`,`sort_date`,`id`);--> statement-breakpoint
CREATE INDEX `review_document_review_set_load_index` ON `review_document` (`review_set_id`,`discovery_load_id`);--> statement-breakpoint
CREATE INDEX `review_document_review_set_record_custodian_index` ON `review_document` (`review_set_id`,`record_custodian_id`);--> statement-breakpoint
CREATE INDEX `review_document_review_set_state_index` ON `review_document` (`review_set_id`,`processing_state`);--> statement-breakpoint
CREATE INDEX `review_document_family_index` ON `review_document` (`review_set_id`,`family_id`,`family_sequence`);--> statement-breakpoint
CREATE INDEX `review_document_review_set_dedup_index` ON `review_document` (`review_set_id`,`dedup_group_id`);--> statement-breakpoint
CREATE INDEX `review_document_review_set_sha256_index` ON `review_document` (`review_set_id`,`content_sha256`);--> statement-breakpoint
-- STRUCTURAL IDEMPOTENCY, one index per source kind. A load pins a version and a message, so each
-- can appear in a review set exactly once — which is what makes a redelivered or retried load
-- CONVERGE on the rows it already wrote instead of allocating a second set, rather than being
-- guarded by a read the next write path might forget to make.
--
-- Both are needed, and the second is not decoration: the fan-out re-derives its plan on every turn
-- and mints fresh identifiers, so a turn that COMMITS a chunk and then dies before checkpointing its
-- cursor will re-plan and re-insert that chunk. With the index the re-insert is a no-op; without it
-- the corpus quietly gains a second copy of a family, and a duplicate nobody loaded is as bad a
-- defect as a document nobody can find.
--
-- Partial, because a row carries exactly one of the two columns and NULLs are distinct in a SQLite
-- unique index anyway; the WHERE states the intent and keeps each index off the rows it cannot
-- constrain. drizzle cannot express a WHERE on a unique index, which is why both live here by hand.
CREATE UNIQUE INDEX `review_document_review_set_file_version_unique_index` ON `review_document` (`review_set_id`,`file_version_id`) WHERE `file_version_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_review_set_email_message_unique_index` ON `review_document` (`review_set_id`,`email_message_id`) WHERE `email_message_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `review_document_exception` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`review_document_id` text NOT NULL,
	`stage` text NOT NULL,
	`code` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_exception_stage_check" CHECK("review_document_exception"."stage" IN ('load', 'identify', 'extract', 'deduplicate', 'family', 'index')),
	CONSTRAINT "review_document_exception_code_check" CHECK("review_document_exception"."code" IN ('unsupported-format', 'corrupt', 'encrypted', 'password-protected', 'encrypted-container-entry', 'container-not-expanded', 'container-guard-tripped', 'oversize', 'extraction-timeout', 'no-text-extracted', 'malware-flagged', 'conversion-failed', 'recognition-failed', 'load-file-metadata-mismatch', 'source-bytes-missing'))
);
--> statement-breakpoint
CREATE INDEX `review_document_exception_review_set_code_index` ON `review_document_exception` (`review_set_id`,`code`);--> statement-breakpoint
CREATE INDEX `review_document_exception_document_index` ON `review_document_exception` (`review_document_id`);--> statement-breakpoint
CREATE TABLE `review_document_occurrence` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`primary_review_document_id` text NOT NULL,
	`duplicate_review_document_id` text NOT NULL,
	`record_custodian_id` text NOT NULL,
	`discovery_load_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`duplicate_review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_custodian_id`) REFERENCES `record_custodian`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discovery_load_id`) REFERENCES `discovery_load`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_occurrence_distinct_check" CHECK("review_document_occurrence"."primary_review_document_id" <> "review_document_occurrence"."duplicate_review_document_id")
);
--> statement-breakpoint
CREATE INDEX `review_document_occurrence_primary_index` ON `review_document_occurrence` (`review_set_id`,`primary_review_document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_occurrence_duplicate_unique_index` ON `review_document_occurrence` (`duplicate_review_document_id`);--> statement-breakpoint
-- The three forward-only state machines, as triggers rather than as convention.
--
-- A convention is a rule the write path that knows about it obeys. A trigger is a rule the database
-- obeys, including for the write path nobody has written yet — which for a corpus a court may
-- examine is the difference between "we do not do that" and "that cannot happen".

-- A review set moves open -> locked -> closed, and never back. Closing releases a derived cache
-- (extracted text, sidecars, index splits) and keeps every row, every manifest, and every exception
-- report; a reopen would produce a corpus whose contents depend on when you looked at it, and whose
-- index has already been collected.
CREATE TRIGGER `review_set_state_forward_only`
BEFORE UPDATE OF `state` ON `review_set`
FOR EACH ROW WHEN OLD.`state` <> NEW.`state` AND NOT (
	(OLD.`state` = 'open' AND NEW.`state` IN ('locked', 'closed'))
	OR (OLD.`state` = 'locked' AND NEW.`state` = 'closed')
)
BEGIN
	SELECT RAISE(ABORT, 'a review set moves open -> locked -> closed and never back');
END;--> statement-breakpoint
-- A load moves declared -> loading -> processing -> complete, may fail from any state before it
-- completes, and may be reversed once complete. A load is append-only: it is never edited, only
-- superseded or reversed by an explicit removal that is itself recorded.
CREATE TRIGGER `discovery_load_state_forward_only`
BEFORE UPDATE OF `state` ON `discovery_load`
FOR EACH ROW WHEN OLD.`state` <> NEW.`state` AND NOT (
	(OLD.`state` = 'declared' AND NEW.`state` IN ('loading', 'failed'))
	OR (OLD.`state` = 'loading' AND NEW.`state` IN ('processing', 'failed'))
	OR (OLD.`state` = 'processing' AND NEW.`state` IN ('complete', 'failed'))
	OR (OLD.`state` = 'complete' AND NEW.`state` = 'reversed')
)
BEGIN
	SELECT RAISE(ABORT, 'a load moves declared -> loading -> processing -> complete, fails before it completes, and is reversed only once complete');
END;--> statement-breakpoint
-- A document that has reached a terminal state may only leave it by being explicitly reset to
-- `pending` — which is what a recorded re-processing does. It can never flip directly between
-- `processed` and `excepted`, because a document silently changing which of the two terminal answers
-- it gives is exactly the failure the two-terminal-states rule exists to make impossible.
CREATE TRIGGER `review_document_terminal_state_guard`
BEFORE UPDATE OF `processing_state` ON `review_document`
FOR EACH ROW WHEN OLD.`processing_state` IN ('processed', 'excepted')
	AND NEW.`processing_state` <> OLD.`processing_state`
	AND NEW.`processing_state` <> 'pending'
BEGIN
	SELECT RAISE(ABORT, 'a document leaves a terminal processing state only by being reset to pending for a recorded re-processing');
END;--> statement-breakpoint
-- The three discovery permissions, seeded onto the default roles.
--
-- All three reach the seats that do case work (Owner/Admin, Attorney, Paralegal) and neither Billing
-- nor Read-only — the magnus:converse seeding, for the same reason. They are three keys rather than
-- one so a firm can take two away: a contract reviewer working under a protective order holds
-- discovery:read and neither of the others, and that configuration has to be expressible before
-- anyone needs it.
--
-- The namespace is what carries the access rule. Reaching a review set follows from a discovery
-- grant and from nothing else — not from matters:*, not from files:*, not from being on the matter
-- team — because material produced by another party may be attorney's-eyes-only under a protective
-- order, and a platform that leaks it to everyone with matter access has caused a real problem.
--
-- The rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReadOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReadAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReadParaleg0', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryManageOwner0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:manageReviewSets');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryManageAttorn', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:manageReviewSets');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryManageParale', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:manageReviewSets');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryLoadOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:load');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryLoadAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:load');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryLoadParaleg0', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:load');
