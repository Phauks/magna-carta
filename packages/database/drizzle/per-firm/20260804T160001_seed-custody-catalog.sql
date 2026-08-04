-- Seeds the two Custodian permissions onto the default roles and the starting item-type catalog.
--
-- custody:read is broad: "do we hold the deed for this client" is a question a billing clerk, a
-- paralegal, and a read-only reviewer all legitimately ask, so it is seeded onto every default role
-- (like conflicts:read). custody:manage is narrower — it moves physical originals, places holds, and
-- records the ledger — so it reaches only the roles that handle the safe: Owner/Admin, Attorney, and
-- Paralegal. Billing and Read-only get the register without the ability to move anything in it.
-- The rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'custody:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'custody:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'custody:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'custody:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadReadOnly00', 'role_WojF9F7kksBEftsmZGNhb', 'custody:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyManageOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'custody:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyManageAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'custody:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyManageParalegl', 'role_917LCQyRKP50Z9bW89vXl', 'custody:manage');--> statement-breakpoint
-- The starting item-type catalog. A firm adds to it and deactivates what it does not use; nothing
-- here is a closed vocabulary. intrinsic_value_default marks the types whose originals are
-- ordinarily irreplaceable — it only seeds the flag on a new item, and a human always overrides it
-- on the specific object, because that flag is what the destruction path reads.
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_originalWill000000000', 'Original will', 'WILL', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_codicil00000000000000', 'Codicil', 'CODICIL', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_deed00000000000000000', 'Deed', 'DEED', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_powerOfAttorney000000', 'Power of attorney', 'POA', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_trustInstrument000000', 'Trust instrument', 'TRUST', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_shareCertificate00000', 'Share or stock certificate', 'SHARE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_bearerSecurity0000000', 'Bearer security', 'BEARER', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_titleDocument00000000', 'Title document', 'TITLE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_promissoryNote0000000', 'Promissory note', 'NOTE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_vitalRecord0000000000', 'Birth or marriage certificate', 'VITAL', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_passport0000000000000', 'Passport', 'PASSPORT', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_jewelryOrValuable0000', 'Jewelry or valuable', 'VALUABLE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_sealedInstructions000', 'Sealed instructions', 'SEALED', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_keys00000000000000000', 'Keys', 'KEYS', 0, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_storageMedia000000000', 'Storage media', 'MEDIA', 0, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_other0000000000000000', 'Other', 'OTHER', 0, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
