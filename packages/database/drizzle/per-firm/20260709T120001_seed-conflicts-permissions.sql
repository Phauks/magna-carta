-- Seed the three conflicts permissions onto the default roles. conflicts:run and conflicts:read are
-- broad, everyday capabilities (any member may screen a prospective matter or read back a completed
-- check) — seeded onto every default role, like tools:whois and tools:safeBrowse. conflicts:dispose
-- is narrower: adjudicating a hit can mean accepting or declining a representation, so it is seeded
-- only to the attorney/admin-tier roles (Owner/Admin, Attorney) — never to Paralegal, Billing, or
-- Read-only, mirroring directory:edit's own owner/attorney-only seed. The rolePermission_ handles are
-- minted once and committed as literals; the role_id values are the default roles from the
-- member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunOwnerAdm0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'conflicts:run');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'conflicts:run');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunParalegl0', 'role_917LCQyRKP50Z9bW89vXl', 'conflicts:run');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunBilling00', 'role_hwwC1D98d8Lazc_asL6vO', 'conflicts:run');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunReadonly0', 'role_WojF9F7kksBEftsmZGNhb', 'conflicts:run');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadOwnerAd0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'conflicts:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadAttorny0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'conflicts:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadParalgl0', 'role_917LCQyRKP50Z9bW89vXl', 'conflicts:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadBilling0', 'role_hwwC1D98d8Lazc_asL6vO', 'conflicts:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadReadony0', 'role_WojF9F7kksBEftsmZGNhb', 'conflicts:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsDisposeOwnr0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'conflicts:dispose');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsDisposeAtty0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'conflicts:dispose');
