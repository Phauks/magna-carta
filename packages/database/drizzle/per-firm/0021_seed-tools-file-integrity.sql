-- Seed tools:fileIntegrity onto every default role. Computing a file's digests and verifying a stored
-- file against its ingest baseline is an everyday file utility any firm member may need without a
-- separate grant — the same broad reach as tools:whois / tools:safeBrowse / tools:fileConverter. The
-- rolePermission_ handles below were minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Fh7Kp2qRnLtVc3xWbE4dJ', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Rj8Dz4sQwHv1nPeKgF5mY', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Sk9Ea5tRxJw2oPfLhG6nZ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Tm0Fb6uSyKx3pQgMiH7aA', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Un1Gc7vTzLy4qRhNjI8bB', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileIntegrity');
