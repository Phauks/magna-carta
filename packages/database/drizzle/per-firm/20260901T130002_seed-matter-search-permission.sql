-- Seed search:matter onto every default role.
--
-- Consolidated matter search answers one query from every section of one matter at once. The key
-- gates the SURFACE and nothing else: every source behind it carries its own read capability, checked
-- per source before a statement is built, so a Read-only seat that may not read notes gets no note
-- back from this route however broadly this key is granted. Withholding it from a role would not
-- protect a single record — it would only make that member walk the fourteen tabs by hand to find
-- something they are already entitled to see.
--
-- Granting it broadly is therefore the same judgement notifications:read and tools:fileWorkbench were
-- given: the capability is the way in, not the thing being protected.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'search:matter');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'search:matter');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchParaleg0', 'role_917LCQyRKP50Z9bW89vXl', 'search:matter');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchBilling0', 'role_hwwC1D98d8Lazc_asL6vO', 'search:matter');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchReadOnly', 'role_WojF9F7kksBEftsmZGNhb', 'search:matter');
