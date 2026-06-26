-- Seed support-access permissions onto the seeded default roles. support:request goes to every
-- default role — any member may ask for help. support:cosign + support:manage go to Owner/Admin
-- only. support:mintSession and diagnostics:overview are intentionally NOT seeded here:
-- mintSession is platform-level and never belongs to a firm member; diagnostics:overview is granted
-- only during an active diagnostic support session, not as a standing role permission.
-- rolePermission_ handles are committed literals so every firm's defaults match byte-for-byte.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:request');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'support:request');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'support:request');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'support:request');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestReadonly000', 'role_WojF9F7kksBEftsmZGNhb', 'support:request');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supCosignOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:cosign');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supManageOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:manage');
