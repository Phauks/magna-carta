-- downloads:shelf — a member's own shelf of what the platform produced for them.
--
-- Seeded to EVERY default role, Read-only included, on exactly the shape notifications:read and
-- firm:readMembers already carry: reading your own is not a privilege. Every read behind this key is
-- scoped to the session's own member id, and the artifact behind a row is one that member already
-- asked the platform to build — so holding the key grants sight of nothing they could not already
-- reach, and withholding it would mean a member could ask for a file and then be refused a way back
-- to it.
--
-- The deliberate contrast is with the producing keys, which stay where they are: `reports:export`
-- (Owner/Admin) decides who may MAKE a document, `files:*` decides who may bundle a matter's files,
-- and `tools:fileConverter` decides who may convert one. This key only decides who may see and
-- re-fetch what they themselves made, so a narrow producing seat is not widened by it — a Read-only
-- seat that can create nothing has an empty shelf, which is the correct and honest outcome rather
-- than a refusal screen.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfOwnerAd', 'role_Gw-zKO8hOHQuNv2bWokMp', 'downloads:shelf');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfAttorn', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'downloads:shelf');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfParale', 'role_917LCQyRKP50Z9bW89vXl', 'downloads:shelf');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfBillin', 'role_hwwC1D98d8Lazc_asL6vO', 'downloads:shelf');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfReadOn', 'role_WojF9F7kksBEftsmZGNhb', 'downloads:shelf');
