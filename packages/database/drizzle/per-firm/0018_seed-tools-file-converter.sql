-- Seed tools:fileConverter onto the Owner/Admin role so firm administrators can use the general
-- matter-free File Converter (POST /api/v1/conversions/upload, /api/v1/conversions, GET /api/v1/conversions/{jobId}).
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_MXlkyBFqE6dla3oeldq3Z', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileConverter');
