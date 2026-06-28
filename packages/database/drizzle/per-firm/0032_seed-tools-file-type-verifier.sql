-- Seed tools:fileTypeVerifier onto every default role. Identifying a file's true type and flagging an
-- extension that lies about its content is an everyday safety utility any firm member may need without a
-- separate grant — the same broad reach as the other tools:* utilities. The rolePermission_ handles are
-- minted once and committed as literals; the role_id values are the default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_K9H6U6-h6p6K_CLHI4KSJ', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_l8i1LDOqTksYZlUevdSmz', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_TpM9gHOSKQj54cXly1HdZ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_V8qn58SYu8l45K4WJKkNN', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_0VDhggjspFyXGAlClnLIz', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileTypeVerifier');
