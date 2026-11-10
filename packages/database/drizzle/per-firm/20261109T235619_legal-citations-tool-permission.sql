-- THE LEGAL CITATIONS TOOL IS OPEN TO EVERY DEFAULT ROLE.
--
-- Formatting a citation reads and writes nothing of the firm's, so every role that can open the
-- other record tools can open this one: the same five roles that hold tools:whois. The seed shape is
-- the house one, plain INSERTs, so tooling/lint-ungranted-permissions reads it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_legalCitationsAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:legalCitations');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_legalCitationsAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:legalCitations');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_legalCitationsParalegl', 'role_917LCQyRKP50Z9bW89vXl', 'tools:legalCitations');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_legalCitationsBilling0', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:legalCitations');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_legalCitationsReadOnly', 'role_WojF9F7kksBEftsmZGNhb', 'tools:legalCitations');
