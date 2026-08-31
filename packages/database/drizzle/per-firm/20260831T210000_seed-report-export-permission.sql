-- reports:export — render a tabular export into a document file (Word, or PDF through the one
-- docx-to-pdf conversion edge). The route is a printer over a document the caller already holds,
-- so the grant guards compute and the conversion engine, not data. Seeded to Owner/Admin alone,
-- matching tools:firmUsage — today's one consumer is the Firm Usage screen those seats already
-- hold, and a wider seat lands with the surface that gives it something more to print.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsExport00000001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:export');
