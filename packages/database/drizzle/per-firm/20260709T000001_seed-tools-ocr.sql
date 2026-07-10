-- Seed tools:ocr onto every default role. Reading the text out of a scanned document is an everyday
-- utility any firm member may need without a separate grant -- the same broad reach as the other
-- tools:* utilities. The rolePermission_ handles are minted once and committed as literals; the
-- role_id values are the default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_QXbw0CF8FQl-rsSIH-bjg', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_xIsqtOvYCONGnys3ezGHr', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_AdFGF4-Rph9Evh8sEMzl7', 'role_917LCQyRKP50Z9bW89vXl', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_964-YIg_2rsTe2iNiSwuI', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_H7Yx3BvP6Dg1sPGmA9VKa', 'role_WojF9F7kksBEftsmZGNhb', 'tools:ocr');
