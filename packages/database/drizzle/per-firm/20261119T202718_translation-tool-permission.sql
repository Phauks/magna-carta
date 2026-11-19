-- THE TRANSLATE TOOL IS OPEN TO EVERY DEFAULT ROLE.
--
-- Translating a pasted letter sends its text to Google, so the tool is gated twice: this key says who
-- may use it, and the firm switch translation.enabled (off until the firm turns it on) says whether
-- anyone may. Every role that can read a matter's letters may need one translated, so the key goes to
-- the same five roles that hold tools:legalCitations. The seed shape is the house one, plain INSERTs,
-- so tooling/lint-ungranted-permissions reads it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_translationAdmin00000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:translation');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_translationAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:translation');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_translationParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'tools:translation');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_translationBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:translation');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_translationReadOnly000', 'role_WojF9F7kksBEftsmZGNhb', 'tools:translation');
