CREATE TABLE `calendar_sync_firm_limit` (
	`subject` text PRIMARY KEY NOT NULL,
	`event_type_id` text,
	`may_leave` integer NOT NULL,
	`detail` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `matter_event_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calendar_sync_firm_limit_subject_check" CHECK(("calendar_sync_firm_limit"."subject" = 'deadline' AND "calendar_sync_firm_limit"."event_type_id" IS NULL) OR ("calendar_sync_firm_limit"."event_type_id" IS NOT NULL AND "calendar_sync_firm_limit"."subject" = "calendar_sync_firm_limit"."event_type_id")),
	CONSTRAINT "calendar_sync_firm_limit_detail_check" CHECK("calendar_sync_firm_limit"."detail" IN ('full', 'minimal'))
);
--> statement-breakpoint
CREATE TABLE `calendar_sync_rule` (
	`connection_id` text NOT NULL,
	`subject` text NOT NULL,
	`event_type_id` text,
	`calendar_remote_id` text NOT NULL,
	`calendar_name` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `subject`),
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connection`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_type_id`) REFERENCES `matter_event_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calendar_sync_rule_subject_check" CHECK(("calendar_sync_rule"."subject" = 'deadline' AND "calendar_sync_rule"."event_type_id" IS NULL) OR ("calendar_sync_rule"."event_type_id" IS NOT NULL AND "calendar_sync_rule"."subject" = "calendar_sync_rule"."event_type_id")),
	CONSTRAINT "calendar_sync_rule_scope_check" CHECK("calendar_sync_rule"."scope" IN ('mine', 'my_matters')),
	CONSTRAINT "calendar_sync_rule_calendar_check" CHECK(length("calendar_sync_rule"."calendar_remote_id") > 0)
);
--> statement-breakpoint
-- WHO SETS WHAT MAY LEAVE.
--
-- `calendar:manageSyncPolicy` gates the firm's limit on calendar sync: which event types may be
-- copied to a member's own calendar at a provider, and with how much detail. Owner/Admin alone, and
-- not the seats that hold calendar:manage: recording a hearing is a practitioner's act, where
-- deciding that hearings may be copied to a third party's servers is the firm's decision about
-- where its clients' affairs go.
--
-- The house seed shape, plain and unqualified, which tooling/lint-ungranted-permissions reads to
-- prove somebody can reach the permission. The role_id is the Owner/Admin role from the baseline.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarSyncPolicyOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'calendar:manageSyncPolicy');
