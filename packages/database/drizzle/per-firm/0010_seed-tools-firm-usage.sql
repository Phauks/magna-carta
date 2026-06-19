-- Seed tools:firmUsage onto the Owner/Admin role so firm administrators can read the firm usage
-- snapshot (GET /api/v1/firm-usage). The other default roles start without it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ku9Tn3aWx7Lp0qRsVbE2c', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:firmUsage');
