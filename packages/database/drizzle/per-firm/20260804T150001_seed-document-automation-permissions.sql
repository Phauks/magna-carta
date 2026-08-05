-- Seed the two document-automation permissions onto the default roles. templates:manage is
-- administrative — registering and versioning a template decides what every member of the firm will
-- file under the firm's letterhead — so it reaches Owner/Admin only, mirroring firm:manageScanPolicy's
-- own admin-only seed. documents:assemble is an everyday working capability and goes to the practising
-- roles (Owner/Admin, Attorney, Paralegal — the files:upload precedent), not to Billing or Read-only,
-- neither of which produces matter documents. Listing the catalogue rides documents:assemble rather
-- than a third read key: a member who can assemble must be able to see what they can assemble.
-- The rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_templatesManageOwnAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'templates:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsAssembleOwnr', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:assemble');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsAssembleAtty', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:assemble');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsAssemblePara', 'role_917LCQyRKP50Z9bW89vXl', 'documents:assemble');
