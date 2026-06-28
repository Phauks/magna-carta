-- Seed firm:manageScanPolicy onto the Owner/Admin default role so firm administrators can read and
-- update the firm's malware scan-policy settings. Managing firm-wide scan policy is an administrative
-- function, so only the Owner/Admin role receives it — matching firm:manageMembers (Owner/Admin only).
-- The role id is the deterministic default seeded in 0002_member-rbac (role_Gw-… = "Owner/Admin").
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_manageScanPolicyOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageScanPolicy');
