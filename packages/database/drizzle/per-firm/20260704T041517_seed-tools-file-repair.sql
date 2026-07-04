-- Seed tools:fileRepair onto every default role. Recovering readable content from a structurally
-- corrupted, truncated, or damaged file is an everyday safety utility any firm member may need without a
-- separate grant — the same broad reach as the other tools:* utilities. The rolePermission_ handles are
-- minted once and committed as literals; the role_id values are the default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Zo8dSaE34nkuzd8b92ts6', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileRepair');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ug4h4xKKBpHWrJHIeM7er', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileRepair');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_ePUvHOdoXlvJ2BnfL4AGZ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileRepair');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Vr6SpPSZdcmeohmxma06U', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileRepair');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_CViT3l-7azrB_XOJRZjPL', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileRepair');
