-- Seed firm:scanFile onto every default role so any member may run the one-off, matter-less
-- malware-scan diagnostic (POST /api/v1/scan/diagnose). Mirrors firm:reportIncident (also a benign
-- firm-level utility seeded to all roles); the diagnostic stores nothing and returns only a verdict.
-- Role ids are the deterministic defaults seeded in 0002_member-rbac.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:scanFile');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:scanFile');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'firm:scanFile');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'firm:scanFile');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileReadonly00', 'role_WojF9F7kksBEftsmZGNhb', 'firm:scanFile');
