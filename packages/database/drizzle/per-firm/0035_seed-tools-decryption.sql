-- Seed tools:decryption onto every default role. The file decryption and recovery tool is an
-- everyday file utility any firm member may need without a separate grant — the same broad reach as
-- tools:metadataScrubber / tools:fileIntegrity / tools:fileConverter. The rolePermission_ handles
-- below were minted once and committed as literals; the role_id values are the default roles from
-- the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Bp4Mn7qKsLv2wXdYeC8gH', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:decryption');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Cq5No8rLtMw3xYeZfD9hI', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:decryption');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Dr6Op9sMuNx4yZfAgE0iJ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:decryption');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Es7Pq0tNvOy5zAgBhF1jK', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:decryption');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ft8Qr1uOwPz6aBhCiG2kL', 'role_WojF9F7kksBEftsmZGNhb', 'tools:decryption');
