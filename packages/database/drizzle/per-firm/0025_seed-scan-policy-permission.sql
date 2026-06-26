-- Seed firm:manageScanPolicy onto Owner and Admin default roles so firm administrators can
-- read and update the firm's malware scan-policy settings.
-- Role ids are the deterministic defaults seeded in 0002_member-rbac.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_manageScanPolicOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageScanPolicy');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_manageScanPolicAdmin', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:manageScanPolicy');
