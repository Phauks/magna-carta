-- Seed the esign:seal permission onto the default roles. Applying the platform seal is a
-- consequential, on-the-record act — it produces a tamper-evident sealed document attributed to the
-- firm — so it is seeded only to the attorney/admin-tier roles (Owner/Admin, Attorney), never to
-- Paralegal, Billing, or Read-only, mirroring conflicts:dispose's owner/attorney-only seed. The
-- rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSealOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'esign:seal');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSealAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'esign:seal');
