CREATE TABLE `communication` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`matter_id` text,
	`counterparty_number` text NOT NULL,
	`counterparty_entity_id` text,
	`member_user_id` text,
	`occurred_at` text NOT NULL,
	`duration_seconds` integer,
	`body` text,
	`summary` text,
	`producer` text NOT NULL,
	`logged_by_user_id` text,
	`carrier_reference` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "communication_counterparty_number_check" CHECK(length("communication"."counterparty_number") > 0),
	CONSTRAINT "communication_channel_check" CHECK("communication"."channel" IN ('voice', 'sms', 'mms')),
	CONSTRAINT "communication_direction_check" CHECK("communication"."direction" IN ('inbound', 'outbound')),
	CONSTRAINT "communication_producer_check" CHECK("communication"."producer" IN ('member', 'carrier')),
	CONSTRAINT "communication_duration_channel_check" CHECK("communication"."duration_seconds" IS NULL OR ("communication"."channel" = 'voice' AND "communication"."duration_seconds" >= 0)),
	CONSTRAINT "communication_body_channel_check" CHECK("communication"."body" IS NULL OR "communication"."channel" IN ('sms', 'mms')),
	CONSTRAINT "communication_producer_shape_check" CHECK(("communication"."producer" = 'member') = ("communication"."logged_by_user_id" IS NOT NULL)
        AND ("communication"."producer" = 'carrier' OR "communication"."carrier_reference" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `communication_matter_occurred_at_id_index` ON `communication` (`matter_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `communication_occurred_at_id_index` ON `communication` (`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `communication_counterparty_entity_id_index` ON `communication` (`counterparty_entity_id`);--> statement-breakpoint
CREATE INDEX `communication_counterparty_number_index` ON `communication` (`counterparty_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `communication_carrier_reference_unique_index` ON `communication` (`carrier_reference`) WHERE "communication"."carrier_reference" IS NOT NULL;--> statement-breakpoint
-- The three communication permissions, seeded onto the default roles.
--
-- communications:read and communications:log reach the seats that WORK matters — Owner/Admin,
-- Attorney, Paralegal — plus Billing on the read alone. The Billing grant is the one that differs
-- from the notes seed, and it is deliberate: "did anyone ever reach this client about the unpaid
-- invoice" is a question a billing clerk has to answer, and the log's metadata answers it without
-- putting counsel's assessment of the case in front of them. Read-only gets nothing, on the notes
-- reasoning — that seat is frequently an outside accountant or an auditor, and what a firm said to a
-- client on the phone is not theirs to read.
--
-- communications:reviewUnrouted is narrower than either, and reaches Owner/Admin and Paralegal
-- rather than every matter seat. Working the unrouted queue is reception's job in most firms, and
-- the queue's contents are unfiltered by construction: nothing has decided yet which matter — or
-- which walled matter — a message belongs to. A firm that wants its attorneys in that queue grants
-- it; the default does not assume it.
--
-- Each rolePermission_ handle is minted once and committed as a literal, opaque rather than spelled
-- out: a readable handle for these would have to abbreviate "communications" to fit the token width,
-- and an abbreviation committed to the schema is the thing the no-shorthand rule exists to stop. The
-- role_id values are the five seeded roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission__jezbuSezbvcdAzF3KxX8', 'role_Gw-zKO8hOHQuNv2bWokMp', 'communications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_cwwkVJsJQLAghji-KbNBc', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'communications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_disT2jR7b7z7ay3_yr2ci', 'role_917LCQyRKP50Z9bW89vXl', 'communications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_c1aJtqIS1S-lhx1caacyQ', 'role_hwwC1D98d8Lazc_asL6vO', 'communications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Baf69lifyA8h7-FWkxAGJ', 'role_Gw-zKO8hOHQuNv2bWokMp', 'communications:log');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_hPGsNdfV2c9_zzN8BGIcd', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'communications:log');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_vm32cyr82L5w2OAXdHPsP', 'role_917LCQyRKP50Z9bW89vXl', 'communications:log');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_6qoTM6IrSQGs3ydWyKRkM', 'role_Gw-zKO8hOHQuNv2bWokMp', 'communications:reviewUnrouted');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fyelnaJGiDxgGaJNTaqCr', 'role_917LCQyRKP50Z9bW89vXl', 'communications:reviewUnrouted');
