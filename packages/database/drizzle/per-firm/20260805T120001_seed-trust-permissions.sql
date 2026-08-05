-- Trust accounting permissions, seeded onto the default roles.
--
-- Two keys, because reading a client's trust balance and moving client money are genuinely
-- different capabilities. trust:read reaches the roles that answer "how much of this client's money
-- do we hold" in the course of their work — Owner/Admin, Attorney, Paralegal, Billing. trust:manage
-- opens trust accounts, builds the client/matter sub-ledger, and composes the movements that take
-- money out; it reaches Owner/Admin, Attorney, and Billing, and deliberately NOT Paralegal.
--
-- Read-only is the one default role that receives neither. Every other broad read key (custody:read,
-- conflicts:read, emails:read) is seeded to it, and this is the deliberate exception: a trust ledger
-- is the record of money the firm holds for other people, and a seat whose whole purpose is broad
-- visibility is the widest surface in the firm. A firm that wants it there can direct-grant it —
-- which is the correction that leaves an audit trail, unlike the one that would have been needed if
-- the default were wrong in the other direction.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'trust:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'trust:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'trust:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadBilling00000', 'role_hwwC1D98d8Lazc_asL6vO', 'trust:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustManageOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'trust:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustManageAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'trust:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustManageBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'trust:manage');
