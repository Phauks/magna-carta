-- Seed the emails:* namespace onto the default roles. Filing email to a matter and managing a
-- matter's links are write actions for the working staff (Owner/Admin, Attorney, Paralegal — the
-- files:upload precedent); reading a matter's filed correspondence is broadly useful and goes to
-- every default role (matter access already gates which matters a reader can see); minting/rotating
-- capture addresses and managing the firm catch-all is an admin action (Owner/Admin only). The
-- rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsFileOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:file');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsFileAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:file');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsFileParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'emails:file');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'emails:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'emails:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadReadOnly000', 'role_WojF9F7kksBEftsmZGNhb', 'emails:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsLinksOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:manageLinks');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsLinksAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:manageLinks');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsLinksParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'emails:manageLinks');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsAddrOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:manageCaptureAddresses');
