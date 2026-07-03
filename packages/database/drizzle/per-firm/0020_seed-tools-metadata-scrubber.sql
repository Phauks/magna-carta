-- Seed tools:metadataScrubber onto every default role. The metadata inspector/scrubber is an
-- everyday safety utility (strip privileged metadata before sending a file) any firm member may need
-- without a separate grant — the same broad reach as the other tools:* utilities.
-- The rolePermission_ handles below were minted once and committed as literals (the 0002_member-rbac
-- seeding convention); the role_id values are the default roles from that same migration.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ms3Yw8nK1qBp5tGxJcH0R', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Nf4Zv9oL2rCq6uHyKdI1S', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Og5Aw0pM3sDr7vIzLeJ2T', 'role_917LCQyRKP50Z9bW89vXl', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ph6Bx1qN4tEs8wJaMfK3U', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Qi7Cy2rO5uFt9xKbNgL4V', 'role_WojF9F7kksBEftsmZGNhb', 'tools:metadataScrubber');
