-- HOW A CLIENT FOUND THE FIRM.
--
-- directory_referral_source is the firm's own list of sources (Past Client, Another Attorney,
-- Website), seeded with a starting list the firm may rename, reorder, retire or add to.
-- directory_entity_referral records, per client, a source, the person or organization who referred
-- them, or both. Purely additive: two new tables and seed rows.
CREATE TABLE `directory_referral_source` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "directory_referral_source_name_nonempty_check" CHECK(length("directory_referral_source"."name") > 0),
	CONSTRAINT "directory_referral_source_archived_check" CHECK("directory_referral_source"."archived" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `directory_entity_referral` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`referrer_entity_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `directory_referral_source`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "directory_entity_referral_states_something_check" CHECK("directory_entity_referral"."source_id" IS NOT NULL OR "directory_entity_referral"."referrer_entity_id" IS NOT NULL),
	CONSTRAINT "directory_entity_referral_not_self_check" CHECK("directory_entity_referral"."referrer_entity_id" IS NULL OR "directory_entity_referral"."referrer_entity_id" <> "directory_entity_referral"."entity_id")
);
--> statement-breakpoint
CREATE INDEX `directory_entity_referral_source_id_index` ON `directory_entity_referral` (`source_id`);
--> statement-breakpoint
CREATE INDEX `directory_entity_referral_referrer_entity_id_index` ON `directory_entity_referral` (`referrer_entity_id`);
--> statement-breakpoint
INSERT INTO `directory_referral_source` (`id`, `name`, `position`, `archived`, `created_at`, `updated_at`) VALUES ('directoryReferralSource_pastClient00000000000', 'Past Client', 0, 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `directory_referral_source` (`id`, `name`, `position`, `archived`, `created_at`, `updated_at`) VALUES ('directoryReferralSource_anotherAttorney000000', 'Another Attorney', 1, 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `directory_referral_source` (`id`, `name`, `position`, `archived`, `created_at`, `updated_at`) VALUES ('directoryReferralSource_friendOrFamily0000000', 'Friend or Family', 2, 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `directory_referral_source` (`id`, `name`, `position`, `archived`, `created_at`, `updated_at`) VALUES ('directoryReferralSource_website00000000000000', 'Website', 3, 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `directory_referral_source` (`id`, `name`, `position`, `archived`, `created_at`, `updated_at`) VALUES ('directoryReferralSource_searchEngine000000000', 'Search Engine', 4, 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `directory_referral_source` (`id`, `name`, `position`, `archived`, `created_at`, `updated_at`) VALUES ('directoryReferralSource_advertisement00000000', 'Advertisement', 5, 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `directory_referral_source` (`id`, `name`, `position`, `archived`, `created_at`, `updated_at`) VALUES ('directoryReferralSource_other0000000000000000', 'Other', 6, 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
