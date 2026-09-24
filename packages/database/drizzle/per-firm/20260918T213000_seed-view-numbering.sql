-- Seed matters:viewNumbering onto EVERY default role, Read-only included.
--
-- The owner's ruling of 2026-09-18: a member without matters:manageNumbering sees the numbering
-- inventory read-only rather than a refusal. How the firm's numbers are shaped is a fact every
-- member reads off every record they open, so seeing the register is not a privilege; changing it
-- is, and that stays matters:manageNumbering (Owner/Admin). Mirrors notifications:read, the other
-- key seeded to all five roles for the same reason.
--
-- The rolePermission_ handles are minted once and committed as literals; the role ids are the five
-- default roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_viewNumberingOwnAdmn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:viewNumbering');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_viewNumberingAttorny', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:viewNumbering');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_viewNumberingParalgl', 'role_917LCQyRKP50Z9bW89vXl', 'matters:viewNumbering');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_viewNumberingBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'matters:viewNumbering');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_viewNumberingReadOnl', 'role_WojF9F7kksBEftsmZGNhb', 'matters:viewNumbering');
