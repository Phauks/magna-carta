-- Seed tools:whois and tools:safeBrowse onto every default role. Both are everyday
-- safety utilities (domain-registration lookup and Safe Browsing reputation check) that
-- any firm member may need without a separate grant — the same broad reach as firm:reportIncident.
-- The rolePermission_ handles below were minted once and committed as literals (the 0002_member-rbac
-- seeding convention); the role_id values are the default roles from that same migration.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Xm4Pq9rN2kLsDf7vWtB5E', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:whois');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Hn6Cs8uA3mGpEj1xYkV0R', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:whois');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Zt7Dw5bQ4nHrFk2yXgU9M', 'role_917LCQyRKP50Z9bW89vXl', 'tools:whois');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Lf3Ey6cR8oJsGn4zWiT1P', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:whois');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Qv2Fa7dS5pKtHm6aZjN8C', 'role_WojF9F7kksBEftsmZGNhb', 'tools:whois');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Rg8Gb1eT6qLuIn7bAkO3D', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:safeBrowse');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Sh9Hc2fU7rMvJo8cBlP4E', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:safeBrowse');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ti0Id3gV8sNwKp9dCmQ5F', 'role_917LCQyRKP50Z9bW89vXl', 'tools:safeBrowse');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Uj1Je4hW9tOxLq0eDnR6G', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:safeBrowse');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Vk2Kf5iX0uPyMr1fEoS7H', 'role_WojF9F7kksBEftsmZGNhb', 'tools:safeBrowse');
