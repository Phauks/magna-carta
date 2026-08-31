-- Seed tools:fileWorkbench onto every default role.
--
-- The workbench is where a member takes a file that belongs to no matter to find out what it is: the
-- attachment that arrived unexpectedly, the production copy whose fingerprint has to be checked
-- against the one opposing counsel quoted, the document nobody is sure opens. That is an everyday
-- safety utility with the same broad reach as the other tools:* entries, and withholding it does not
-- protect anything — a member who cannot reach the workbench opens the file on their desktop instead,
-- which is strictly worse.
--
-- The grant opens the SURFACE and nothing more. Each capability inside it carries its own permission
-- (tools:fileTypeVerifier, tools:fileIntegrity, tools:decryption, firm:scanFile and the rest), so a
-- seat that may not decrypt sees no Unlock tab even holding this. Narrowing who may inspect an unfiled
-- file is done by taking away the capability, never the bench.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileWorkbench');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileWorkbench');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileWorkbench');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileWorkbench');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchReadOnly000', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileWorkbench');
