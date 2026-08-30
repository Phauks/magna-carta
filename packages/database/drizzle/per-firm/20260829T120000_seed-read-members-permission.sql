-- Seed firm:readMembers onto EVERY default role, Read-only included — the same universal shape
-- notifications:read was given in 20260807T020000_notifications-delivery, and the deliberate
-- opposite of firm:manageMembers, which stays Owner/Admin only.
--
-- The two acts are not the same privilege. Inviting a person into the firm creates an account, sends
-- mail in the firm's name, and changes who can reach the firm's record; knowing who is ALREADY in
-- the firm is what every screen that prints a colleague's name needs. Withholding the roster does
-- not protect anything — a member sees their colleagues' names on matters, in assignments, on time
-- entries and in the hallway — it only forces each screen to either show a raw user handle or to say
-- nothing at all, which is the state the matters list shipped in.
--
-- What the read carries is what bounds the grant: display name, member status, the roles held, and
-- whether a professional profile has been written. No email, no contact details, no permission set,
-- no credential state. A Read-only seat learning that Ms Okafor is an Attorney learns nothing it
-- could not read off the matter it is already allowed to open.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:readMembers');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:readMembers');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'firm:readMembers');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'firm:readMembers');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersReadOnly00', 'role_WojF9F7kksBEftsmZGNhb', 'firm:readMembers');
