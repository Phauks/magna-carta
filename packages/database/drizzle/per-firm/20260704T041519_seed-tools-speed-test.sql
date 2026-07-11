-- Seed tools:speedTest onto every default role. Measuring the connection you are working on is a
-- benign diagnostic any firm member may need without a separate grant — the same broad reach as the
-- other tools:* utilities, and safe even for Read-only, since it reads nothing and writes nothing.
-- This grant was omitted when the permission was registered; every sibling tools:* permission has it.
-- The rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Nq7Bx2fT9mLd4kRvZa1cP', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:speedTest');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Hs5Yw8jK3nQz6bXeM0vGt', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:speedTest');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Dc9Rf4pW7uJi2lNoS5hAe', 'role_917LCQyRKP50Z9bW89vXl', 'tools:speedTest');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Kt3Gm6zV1yCb8xUqE7nPd', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:speedTest');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Bw2Ln5aX0oFj9sTgR4iMc', 'role_WojF9F7kksBEftsmZGNhb', 'tools:speedTest');
