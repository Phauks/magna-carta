CREATE TABLE `signing_event` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`signer_id` text,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`actor` text,
	`observed_ip` text,
	`user_agent` text,
	`detail` text,
	FOREIGN KEY (`request_id`) REFERENCES `signing_request`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signer_id`) REFERENCES `signing_signer`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "signing_event_kind_check" CHECK("signing_event"."kind" IN ('created', 'sent', 'delivered', 'viewed', 'identity-verified', 'consented', 'signed', 'declined', 'reassigned', 'reminded', 'voided', 'completed', 'sealed'))
);
--> statement-breakpoint
CREATE INDEX `signing_event_request_index` ON `signing_event` (`request_id`,`at`);--> statement-breakpoint
CREATE TABLE `signing_field` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`signer_id` text NOT NULL,
	`kind` text NOT NULL,
	`page` integer NOT NULL,
	`rect_left_e2` integer NOT NULL,
	`rect_bottom_e2` integer NOT NULL,
	`rect_right_e2` integer NOT NULL,
	`rect_top_e2` integer NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`value_text` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `signing_request`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signer_id`) REFERENCES `signing_signer`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "signing_field_kind_check" CHECK("signing_field"."kind" IN ('signature', 'initials', 'date-signed', 'full-name', 'text', 'checkbox')),
	CONSTRAINT "signing_field_page_check" CHECK("signing_field"."page" >= 1),
	CONSTRAINT "signing_field_rect_check" CHECK("signing_field"."rect_right_e2" > "signing_field"."rect_left_e2" AND "signing_field"."rect_top_e2" > "signing_field"."rect_bottom_e2")
);
--> statement-breakpoint
CREATE INDEX `signing_field_request_index` ON `signing_field` (`request_id`,`signer_id`);--> statement-breakpoint
CREATE TABLE `signing_request` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`file_id` text NOT NULL,
	`file_version_id` text NOT NULL,
	`document_hash_sha256` text,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`signing_order` text DEFAULT 'in-order' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`expires_at` text NOT NULL,
	`remind_every_days` integer,
	`last_reminded_at` text,
	`created_by_user_id` text NOT NULL,
	`sent_at` text,
	`completed_at` text,
	`sealed_at` text,
	`voided_reason` text,
	`signed_file_version_id` text,
	`certificate_file_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`certificate_file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "signing_request_signing_order_check" CHECK("signing_request"."signing_order" IN ('in-order', 'all-at-once')),
	CONSTRAINT "signing_request_status_check" CHECK("signing_request"."status" IN ('draft', 'sent', 'completed', 'declined', 'voided', 'expired')),
	CONSTRAINT "signing_request_title_check" CHECK(length("signing_request"."title") > 0),
	CONSTRAINT "signing_request_hash_check" CHECK("signing_request"."document_hash_sha256" IS NULL OR length("signing_request"."document_hash_sha256") = 64),
	CONSTRAINT "signing_request_sent_check" CHECK("signing_request"."status" = 'draft' OR ("signing_request"."sent_at" IS NOT NULL AND "signing_request"."document_hash_sha256" IS NOT NULL)),
	CONSTRAINT "signing_request_remind_check" CHECK("signing_request"."remind_every_days" IS NULL OR "signing_request"."remind_every_days" BETWEEN 1 AND 30)
);
--> statement-breakpoint
CREATE INDEX `signing_request_file_index` ON `signing_request` (`file_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `signing_request_status_index` ON `signing_request` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `signing_signer` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`attribution_level` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`notified_at` text,
	`opened_at` text,
	`signed_at` text,
	`declined_at` text,
	`decline_reason` text,
	`token_secret_hash` text,
	`secret_version` integer DEFAULT 1 NOT NULL,
	`access_code_hash` text,
	`access_code_expires_at` text,
	`access_code_attempts` integer DEFAULT 0 NOT NULL,
	`identity_verified_at` text,
	`consent_disclosure_version` text,
	`consented_at` text,
	`adoption` text,
	`signature_object_key` text,
	`initials_object_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `signing_request`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "signing_signer_position_check" CHECK("signing_signer"."position" >= 1),
	CONSTRAINT "signing_signer_name_check" CHECK(length("signing_signer"."name") > 0),
	CONSTRAINT "signing_signer_attribution_check" CHECK("signing_signer"."attribution_level" IN ('email-link', 'access-code', 'firm-authenticated')),
	CONSTRAINT "signing_signer_status_check" CHECK("signing_signer"."status" IN ('waiting', 'notified', 'opened', 'signed', 'declined')),
	CONSTRAINT "signing_signer_member_check" CHECK(("signing_signer"."attribution_level" = 'firm-authenticated') = ("signing_signer"."user_id" IS NOT NULL)),
	CONSTRAINT "signing_signer_secret_hash_check" CHECK("signing_signer"."token_secret_hash" IS NULL OR length("signing_signer"."token_secret_hash") = 64),
	CONSTRAINT "signing_signer_secret_version_check" CHECK("signing_signer"."secret_version" >= 1),
	CONSTRAINT "signing_signer_attempts_check" CHECK("signing_signer"."access_code_attempts" >= 0),
	CONSTRAINT "signing_signer_adoption_check" CHECK("signing_signer"."adoption" IS NULL OR "signing_signer"."adoption" IN ('typed', 'drawn', 'uploaded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signing_signer_request_position_unique_index` ON `signing_signer` (`request_id`,`position`);--> statement-breakpoint
CREATE INDEX `signing_signer_user_index` ON `signing_signer` (`user_id`,`status`);--> statement-breakpoint
-- Who may send a document for signature, and who may sign one sent to them as a firm member.
-- Sending is the three roles that prepare documents; signing what is addressed to you is every role.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSendOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'esign:send');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSendAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'esign:send');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSendParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'esign:send');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSignOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'esign:sign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSignAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'esign:sign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSignParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'esign:sign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSignBilling00000', 'role_hwwC1D98d8Lazc_asL6vO', 'esign:sign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSignReadOnly0000', 'role_WojF9F7kksBEftsmZGNhb', 'esign:sign');
