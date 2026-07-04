-- Seed tools:aiTextDetection onto every default role, matching the other tools:* utilities. Unlike
-- those, this tool only egresses text once the firm opts in via the aiDetection.externalDetectionEnabled
-- setting (default off) — the consent setting is the egress gate, not the permission. The
-- rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_n9yTH1WrSRVXLLqaJgWAz', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_uUiq-zdWUgv35Iyv8XNog', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_PThnEqwA0vW_Aeez42Wk1', 'role_917LCQyRKP50Z9bW89vXl', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_mNj8beGjMi0PFysLZ_9b7', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_YoruyyMsSKpYokuqR7H0Q', 'role_WojF9F7kksBEftsmZGNhb', 'tools:aiTextDetection');
