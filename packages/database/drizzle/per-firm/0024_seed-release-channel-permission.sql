-- Seed firm:manageReleaseChannel onto the Owner/Admin role only — choosing the firm's release
-- channel between {stable, beta} is an administrative action, like firm:manageMembers. The platform
-- (alpha) door is secret-guarded and needs no role grant. Role id is the deterministic Owner/Admin
-- default seeded in 0002_member-rbac.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_releaseChanAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageReleaseChannel');
