CREATE TABLE `email_auto_file_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`matter_id` text NOT NULL,
	`match_value` text NOT NULL,
	`promotion` text DEFAULT 'stage' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`suspended_reason` text,
	`created_by` text,
	`created_from_email_message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_from_email_message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_auto_file_rule_kind_check" CHECK("email_auto_file_rule"."kind" IN ('threadContinuation', 'correspondentMatter')),
	CONSTRAINT "email_auto_file_rule_promotion_check" CHECK("email_auto_file_rule"."promotion" IN ('stage', 'file')),
	CONSTRAINT "email_auto_file_rule_state_check" CHECK("email_auto_file_rule"."state" IN ('active', 'suspended', 'revoked')),
	CONSTRAINT "email_auto_file_rule_suspended_reason_check" CHECK("email_auto_file_rule"."suspended_reason" IS NULL OR "email_auto_file_rule"."suspended_reason" IN ('creatorAccessWithdrawn', 'matterClosed', 'blastBound', 'undoRate', 'member')),
	CONSTRAINT "email_auto_file_rule_suspended_reason_state_check" CHECK(("email_auto_file_rule"."state" = 'suspended') = ("email_auto_file_rule"."suspended_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_auto_file_rule_kind_match_matter_unique_index` ON `email_auto_file_rule` (`kind`,`match_value`,`matter_id`);--> statement-breakpoint
CREATE INDEX `email_auto_file_rule_kind_match_index` ON `email_auto_file_rule` (`kind`,`match_value`);--> statement-breakpoint
CREATE INDEX `email_auto_file_rule_matter_id_index` ON `email_auto_file_rule` (`matter_id`);--> statement-breakpoint
CREATE INDEX `email_auto_file_rule_state_index` ON `email_auto_file_rule` (`state`) WHERE "email_auto_file_rule"."state" != 'active';--> statement-breakpoint
CREATE TABLE `email_auto_file_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`auto_file_rule_id` text,
	`matter_id` text,
	`outcome` text NOT NULL,
	`suppression_reason` text,
	`evidence` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auto_file_rule_id`) REFERENCES `email_auto_file_rule`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_auto_file_decision_outcome_check" CHECK("email_auto_file_decision"."outcome" IN ('filed', 'staged', 'suppressed')),
	CONSTRAINT "email_auto_file_decision_suppression_reason_check" CHECK("email_auto_file_decision"."suppression_reason" IS NULL OR "email_auto_file_decision"."suppression_reason" IN ('ambiguousEvidence', 'creatorAccessWithdrawn', 'senderNotAuthenticated', 'signatureFailed', 'humanFilingDecision', 'matterNotOpen', 'ruleNotActive', 'incompleteEvidence')),
	CONSTRAINT "email_auto_file_decision_suppression_reason_outcome_check" CHECK(("email_auto_file_decision"."outcome" = 'suppressed') = ("email_auto_file_decision"."suppression_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `email_auto_file_decision_rule_created_index` ON `email_auto_file_decision` (`auto_file_rule_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_auto_file_decision_email_message_id_index` ON `email_auto_file_decision` (`email_message_id`);--> statement-breakpoint
ALTER TABLE `email_matter_link` ADD `auto_file_rule_id` text REFERENCES email_auto_file_rule(id);--> statement-breakpoint
-- Seed emails:manageAutoFileRules onto the default roles, on the 20260717T120001_seed-emails-permissions
-- pattern. Deliberately narrower than emails:manageLinks: filing mail and configuring the machine to
-- file mail are different grants, so a firm can hand out the first without the second. Owner/Admin and
-- Attorney own the correspondence decision and carry it by seed; Paralegal receives it only by an
-- explicit firm grant. The rolePermission_ handles are minted once and committed as literals; the
-- role_id values are the default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsRulesOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:manageAutoFileRules');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsRulesAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:manageAutoFileRules');
