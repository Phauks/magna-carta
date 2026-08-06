-- The matter asset register's remaining structured classes, plus encumbrances. Seven tables — the six
-- one-to-one attribute tables that make vehicles, firearms, business interests, insurance policies,
-- receivables, and digital assets recordable with structure, and the encumbrance row whose BALANCE is
-- an ordinary valuation naming it. `personalProperty` and `other` get no table at all and are not an
-- omission: a description, a value history, documents, and the firm's own fields are the whole of
-- them.
--
-- Hand-registered rather than left as drizzle-kit emitted it, for the seed INSERTs at the foot: the
-- starting type catalog for the six classes this migration opens. Table and column comments live
-- beside the Drizzle definitions in packages/database/src/per-firm-schema.ts, including why a vehicle
-- identification number, a plate, and a firearm serial are plaintext and indexed while an account
-- number is sealed, and why the digital-asset table has no column a credential could ride on.
CREATE TABLE `matter_asset_business_interest` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`entity_name` text,
	`entity_organization_id` text,
	`jurisdiction_of_organization` text,
	`entity_form` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matter_asset_business_interest_organization_index` ON `matter_asset_business_interest` (`entity_organization_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_digital_asset` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`platform_name` text,
	`account_handle` text,
	`custody_model` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_digital_asset_custody_model_check" CHECK("matter_asset_digital_asset"."custody_model" IS NULL OR "matter_asset_digital_asset"."custody_model" IN ('custodial', 'selfCustodied', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_encumbrance` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`holder_entity_id` text,
	`holder_name` text,
	`recorded_reference` text,
	`released_on` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_encumbrance_kind_check" CHECK("matter_asset_encumbrance"."kind" IN ('mortgage', 'deedOfTrust', 'lien', 'judgment', 'securityInterest', 'taxLien', 'pledge', 'other'))
);
--> statement-breakpoint
CREATE INDEX `matter_asset_encumbrance_asset_released_index` ON `matter_asset_encumbrance` (`asset_id`,`released_on`);--> statement-breakpoint
CREATE INDEX `matter_asset_encumbrance_holder_index` ON `matter_asset_encumbrance` (`holder_entity_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_firearm` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`make` text,
	`model` text,
	`caliber_or_gauge` text,
	`serial_number` text,
	`regulated_category` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matter_asset_firearm_serial_index` ON `matter_asset_firearm` (`serial_number`);--> statement-breakpoint
CREATE TABLE `matter_asset_insurance_policy` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`carrier_name` text,
	`carrier_organization_id` text,
	`face_amount_minor` integer,
	`face_currency` text,
	`insured_entity_id` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_insurance_policy_face_amount_check" CHECK(("matter_asset_insurance_policy"."face_amount_minor" IS NULL) = ("matter_asset_insurance_policy"."face_currency" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_asset_insurance_policy_carrier_index` ON `matter_asset_insurance_policy` (`carrier_organization_id`);--> statement-breakpoint
CREATE INDEX `matter_asset_insurance_policy_insured_index` ON `matter_asset_insurance_policy` (`insured_entity_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_receivable` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`debtor_entity_id` text,
	`principal_amount_minor` integer,
	`principal_currency` text,
	`rate_e4` integer,
	`maturity_on` text,
	`secured` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_receivable_principal_check" CHECK(("matter_asset_receivable"."principal_amount_minor" IS NULL) = ("matter_asset_receivable"."principal_currency" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_asset_receivable_debtor_index` ON `matter_asset_receivable` (`debtor_entity_id`);--> statement-breakpoint
CREATE TABLE `matter_asset_vehicle` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`make` text,
	`model` text,
	`model_year` integer,
	`vehicle_identification_number` text,
	`plate_number` text,
	`plate_region` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_vehicle_model_year_check" CHECK("matter_asset_vehicle"."model_year" IS NULL OR ("matter_asset_vehicle"."model_year" >= 1885 AND "matter_asset_vehicle"."model_year" <= 2200))
);
--> statement-breakpoint
CREATE INDEX `matter_asset_vehicle_identification_number_index` ON `matter_asset_vehicle` (`vehicle_identification_number`);--> statement-breakpoint
CREATE INDEX `matter_asset_vehicle_plate_index` ON `matter_asset_vehicle` (`plate_number`);--> statement-breakpoint
-- The as-of resolution for an ENCUMBRANCE's balance — the one query net equity is. The valuation
-- table's existing composite leads with `asset_id`, which cannot serve a lookup by `encumbrance_id`,
-- and this is the table the subsystem expects to grow without bound while the asset table does not.
-- Additive index on an existing table: no rewrite, no data touched.
CREATE INDEX `matter_asset_valuation_encumbrance_as_of_index` ON `matter_asset_valuation` (`encumbrance_id`,`as_of_date`,`recorded_at`);--> statement-breakpoint
-- The starting type catalog for the six classes this migration opens, continuing the list the
-- register's first migration seeded for real property and financial accounts. A firm extends it,
-- reorders it, and deactivates what it does not use; nothing is ever deleted, because every asset
-- already classified under a type keeps its meaning. This list is a starting vocabulary and NOT a
-- claim about any jurisdiction's property law — which is exactly why it is data rather than an enum,
-- and why the firearm entries name shapes of object rather than regulatory categories.
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_passengerVehicle00000', 'Passenger vehicle', 'vehicle', 'PASSENGER_VEHICLE', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_truckOrVan00000000000', 'Truck or van', 'vehicle', 'TRUCK_OR_VAN', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_motorcycle00000000000', 'Motorcycle', 'vehicle', 'MOTORCYCLE', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_recreationalVehicle00', 'Recreational vehicle', 'vehicle', 'RECREATIONAL_VEHICLE', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_boatOrVessel000000000', 'Boat or vessel', 'vehicle', 'BOAT_OR_VESSEL', 1, 5, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_trailer00000000000000', 'Trailer', 'vehicle', 'TRAILER', 1, 6, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_handgun00000000000000', 'Handgun', 'firearm', 'HANDGUN', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_rifle0000000000000000', 'Rifle', 'firearm', 'RIFLE', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_shotgun00000000000000', 'Shotgun', 'firearm', 'SHOTGUN', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_antiqueFirearm0000000', 'Antique or collectible firearm', 'firearm', 'ANTIQUE_FIREARM', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_limitedLiability00000', 'Limited liability company interest', 'businessInterest', 'LIMITED_LIABILITY_COMPANY', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_corporateShares000000', 'Corporate shares', 'businessInterest', 'CORPORATE_SHARES', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_partnershipInterest00', 'Partnership interest', 'businessInterest', 'PARTNERSHIP_INTEREST', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_soleProprietorship000', 'Sole proprietorship', 'businessInterest', 'SOLE_PROPRIETORSHIP', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_termLife0000000000000', 'Term life policy', 'insurancePolicy', 'TERM_LIFE', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_wholeLife000000000000', 'Whole life policy', 'insurancePolicy', 'WHOLE_LIFE', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_universalLife00000000', 'Universal life policy', 'insurancePolicy', 'UNIVERSAL_LIFE', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_annuity00000000000000', 'Annuity', 'insurancePolicy', 'ANNUITY', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_promissoryNote0000000', 'Promissory note', 'receivable', 'PROMISSORY_NOTE', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_loanToFamilyMember000', 'Loan to a family member', 'receivable', 'FAMILY_LOAN', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_judgmentOwed000000000', 'Judgment owed to the estate', 'receivable', 'JUDGMENT_OWED', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_refundDue000000000000', 'Refund due', 'receivable', 'REFUND_DUE', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_cryptocurrency0000000', 'Cryptocurrency', 'digitalAsset', 'CRYPTOCURRENCY', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_onlineAccount00000000', 'Online account', 'digitalAsset', 'ONLINE_ACCOUNT', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_domainName00000000000', 'Domain name', 'digitalAsset', 'DOMAIN_NAME', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_digitalMediaLibrary00', 'Digital media library', 'digitalAsset', 'DIGITAL_MEDIA_LIBRARY', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');