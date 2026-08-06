-- The matter asset register's first slice: what a client or an estate owns, recorded against one
-- matter. Eight tables — the asset row, the per-firm type catalog under the platform class, the two
-- structured attribute tables this slice ships (real property and financial accounts), the
-- append-only valuation history, interests held by Directory entities, the document link, and the
-- sealed identifier row — plus the starting type catalog, the interest-label catalog, and the two
-- permissions seeded onto the default roles.
--
-- Hand-written rather than left as drizzle-kit emitted it, for three reasons drizzle-kit cannot
-- express: the three RAISE(ABORT) triggers at the foot that make the valuation history append-only
-- at the DATABASE rather than by convention, the seed INSERTs, and the parent-first ordering the
-- foreign keys need. Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
CREATE TABLE `matter_asset_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`class` text NOT NULL,
	`code` text,
	`active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "matter_asset_type_name_check" CHECK(length("matter_asset_type"."name") > 0),
	CONSTRAINT "matter_asset_type_class_check" CHECK("matter_asset_type"."class" IN ('realProperty', 'financialAccount', 'vehicle', 'firearm', 'businessInterest', 'insurancePolicy', 'receivable', 'digitalAsset', 'personalProperty', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_asset_type_name_unique_index` ON `matter_asset_type` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_asset_type_code_unique_index` ON `matter_asset_type` (`code`);--> statement-breakpoint
CREATE INDEX `matter_asset_type_class_position_index` ON `matter_asset_type` (`class`,`position`);--> statement-breakpoint
CREATE TABLE `matter_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`class` text NOT NULL,
	`asset_type_id` text,
	`description` text NOT NULL,
	`acquired_on` text,
	`estate_treatment` text DEFAULT 'undetermined' NOT NULL,
	`disposition` text DEFAULT 'retained' NOT NULL,
	`disposition_on` text,
	`custody_item_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_type_id`) REFERENCES `matter_asset_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`custody_item_id`) REFERENCES `custody_item`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_description_check" CHECK(length("matter_asset"."description") > 0),
	CONSTRAINT "matter_asset_class_check" CHECK("matter_asset"."class" IN ('realProperty', 'financialAccount', 'vehicle', 'firearm', 'businessInterest', 'insurancePolicy', 'receivable', 'digitalAsset', 'personalProperty', 'other')),
	CONSTRAINT "matter_asset_estate_treatment_check" CHECK("matter_asset"."estate_treatment" IN ('probateEstate', 'nonProbateTransfer', 'undetermined')),
	CONSTRAINT "matter_asset_disposition_check" CHECK("matter_asset"."disposition" IN ('retained', 'sold', 'transferred', 'distributed', 'abandoned', 'lost'))
);
--> statement-breakpoint
CREATE INDEX `matter_asset_matter_class_created_id_index` ON `matter_asset` (`matter_id`,`class`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_asset_type_index` ON `matter_asset` (`asset_type_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_real_property` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`street` text,
	`city` text,
	`region` text,
	`postal` text,
	`county` text,
	`parcel_number` text,
	`legal_description` text,
	`recording_reference` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- The parcel number is plaintext and indexed because it sits on the assessor's public roll and
-- searching by it is the point — the same reason a vehicle identification number and a firearm
-- serial will be. A full account number is not: it goes to matter_asset_identifier as ciphertext.
CREATE INDEX `matter_asset_real_property_parcel_index` ON `matter_asset_real_property` (`parcel_number`);--> statement-breakpoint
CREATE INDEX `matter_asset_real_property_region_city_index` ON `matter_asset_real_property` (`region`,`city`);--> statement-breakpoint
CREATE TABLE `matter_asset_financial_account` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`institution_name` text,
	`institution_organization_id` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matter_asset_financial_account_institution_index` ON `matter_asset_financial_account` (`institution_organization_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_valuation` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`encumbrance_id` text,
	`as_of_date` text NOT NULL,
	`amount_minor` integer,
	`currency` text,
	`basis` text NOT NULL,
	`source_note` text,
	`supporting_file_id` text,
	`corrects_valuation_id` text,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supporting_file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_valuation_as_of_shape_check" CHECK("matter_asset_valuation"."as_of_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_asset_valuation_amount_shape_check" CHECK(("matter_asset_valuation"."amount_minor" IS NULL) = ("matter_asset_valuation"."currency" IS NULL)),
	CONSTRAINT "matter_asset_valuation_basis_check" CHECK("matter_asset_valuation"."basis" IN ('appraisal', 'statement', 'taxAssessment', 'marketQuote', 'guideBook', 'broker', 'sale', 'purchasePrice', 'courtDetermined', 'clientEstimate', 'automatedEstimate'))
);
--> statement-breakpoint
CREATE INDEX `matter_asset_valuation_asset_as_of_index` ON `matter_asset_valuation` (`asset_id`,`as_of_date`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `matter_asset_valuation_corrects_index` ON `matter_asset_valuation` (`corrects_valuation_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_interest` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`interest_role` text,
	`share_numerator` integer,
	`share_denominator` integer,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_interest_share_shape_check" CHECK(("matter_asset_interest"."share_numerator" IS NULL) = ("matter_asset_interest"."share_denominator" IS NULL)),
	CONSTRAINT "matter_asset_interest_share_denominator_check" CHECK("matter_asset_interest"."share_denominator" IS NULL OR "matter_asset_interest"."share_denominator" > 0)
);
--> statement-breakpoint
CREATE INDEX `matter_asset_interest_asset_index` ON `matter_asset_interest` (`asset_id`);--> statement-breakpoint
CREATE INDEX `matter_asset_interest_entity_index` ON `matter_asset_interest` (`entity_id`,`effective_to`);--> statement-breakpoint
CREATE TABLE `matter_asset_document` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`linked_at` text NOT NULL,
	`linked_by` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_document_kind_check" CHECK("matter_asset_document"."kind" IN ('deed', 'title', 'statement', 'appraisal', 'policy', 'registration', 'billOfSale', 'photograph', 'correspondence', 'other'))
);
--> statement-breakpoint
CREATE INDEX `matter_asset_document_asset_index` ON `matter_asset_document` (`asset_id`);--> statement-breakpoint
-- Deliberately NOT unique on file_id, diverging from custody_scan: one brokerage statement lists four
-- accounts and one appraisal covers a house and its contents, so requiring a file to belong to one
-- asset would force a firm to upload the same statement four times.
CREATE INDEX `matter_asset_document_file_index` ON `matter_asset_document` (`file_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_identifier` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`display_suffix` text,
	`value_ciphertext` text,
	`created_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_identifier_kind_check" CHECK("matter_asset_identifier"."kind" IN ('accountNumber', 'policyNumber', 'certificateNumber', 'taxIdentifier', 'other')),
	CONSTRAINT "matter_asset_identifier_suffix_length_check" CHECK("matter_asset_identifier"."display_suffix" IS NULL OR length("matter_asset_identifier"."display_suffix") <= 4),
	CONSTRAINT "matter_asset_identifier_presence_check" CHECK("matter_asset_identifier"."display_suffix" IS NOT NULL OR "matter_asset_identifier"."value_ciphertext" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `matter_asset_identifier_asset_index` ON `matter_asset_identifier` (`asset_id`);--> statement-breakpoint
-- The append-only valuation history, enforced at the database rather than by discipline. An estate
-- needs the date-of-death value and today's value and, in a long administration, several in between;
-- a schedule filed in March and a register read in September must not be able to disagree with
-- nobody able to say when they diverged. A correction is a new row carrying corrects_valuation_id,
-- never an edit. The shape is the custody movement ledger's, copied deliberately rather than
-- reinvented.
CREATE TRIGGER `matter_asset_valuation_no_update` BEFORE UPDATE ON `matter_asset_valuation` BEGIN
  SELECT RAISE(ABORT, 'matter_asset_valuation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_asset_valuation_no_delete` BEFORE DELETE ON `matter_asset_valuation` BEGIN
  SELECT RAISE(ABORT, 'matter_asset_valuation is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently overwrite a valuation that a plain UPDATE cannot touch. A BEFORE INSERT guard that
-- aborts when the id already exists DOES fire on the insert half of a REPLACE — closing the one
-- remaining path that could mutate an appended row in place. Normal inserts carry fresh random ids,
-- so the guard's primary-key existence check never matches on the happy path.
CREATE TRIGGER `matter_asset_valuation_no_replace` BEFORE INSERT ON `matter_asset_valuation` WHEN EXISTS (SELECT 1 FROM `matter_asset_valuation` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'matter_asset_valuation is append-only');
END;
--> statement-breakpoint
-- The starting type catalog for the two classes this slice ships. A firm extends it, reorders it, and
-- deactivates what it does not use; nothing is ever deleted, because every asset already classified
-- under a type keeps its meaning. This list is a starting vocabulary and NOT a claim about any
-- jurisdiction's property law, which is exactly why it is data rather than an enum.
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_singleFamilyResidence', 'Single-family residence', 'realProperty', 'RESIDENCE', 1, 1, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_condominium0000000000', 'Condominium', 'realProperty', 'CONDOMINIUM', 1, 2, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_vacantLand00000000000', 'Vacant land', 'realProperty', 'VACANT_LAND', 1, 3, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_timeshare000000000000', 'Timeshare', 'realProperty', 'TIMESHARE', 1, 4, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_mineralInterest0000000', 'Mineral interest', 'realProperty', 'MINERAL_INTEREST', 1, 5, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_leasehold000000000000', 'Leasehold', 'realProperty', 'LEASEHOLD', 1, 6, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_checkingAccount000000', 'Checking account', 'financialAccount', 'CHECKING', 1, 1, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_savingsAccount0000000', 'Savings account', 'financialAccount', 'SAVINGS', 1, 2, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_brokerageAccount00000', 'Brokerage account', 'financialAccount', 'BROKERAGE', 1, 3, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_certificateOfDeposit0', 'Certificate of deposit', 'financialAccount', 'CERTIFICATE_OF_DEPOSIT', 1, 4, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_individualRetirement0', 'Individual retirement account', 'financialAccount', 'INDIVIDUAL_RETIREMENT', 1, 5, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_employerRetirement000', 'Employer retirement plan', 'financialAccount', 'EMPLOYER_RETIREMENT', 1, 6, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_educationSavings00000', 'Education savings account', 'financialAccount', 'EDUCATION_SAVINGS', 1, 7, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
-- The firm's starting list of interest labels, a per-firm catalog and never a platform enum for the
-- reason the custody ownership-role catalog is not one: the forms an interest can be held under are
-- jurisdiction-specific and unevenly named, and no engine here consumes them. A firm edits the list;
-- clearing it constrains nothing, and while it has entries a label outside it is a typo the firm has
-- told us how to catch.
INSERT INTO `setting` (`key`, `value`, `updated_at`) VALUES ('matterAssets.interestRoleCatalog', '["Owner","Joint owner","Co-owner","Titleholder","Life tenant","Remainderman","Trustee","Beneficiary","Payable-on-death beneficiary","Secured party","Lessee"]', '2026-08-06T02:00:00.000Z');--> statement-breakpoint
-- The two asset permissions, seeded onto the default roles.
--
-- Narrower than custody:read and calendar:read deliberately: the register concentrates a matter's
-- financially sensitive facts — what the estate owns, what it is worth, account suffixes, home
-- addresses — in one surface, so it reaches the seats that actually administer an estate
-- (Owner/Admin, Attorney, Paralegal) and neither Billing nor Read-only by default. A firm that wants
-- its bookkeeper on the register grants it; the platform does not decide that for them. The
-- rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matterAssets:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matterAssets:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'matterAssets:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetManageOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matterAssets:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetManageAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matterAssets:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetManageParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'matterAssets:manage');
