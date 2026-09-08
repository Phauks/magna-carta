-- Seed firm:editOwnProfile onto EVERY default role, Read-only included.
--
-- The key exists because the chokepoint refuses an authenticated mutation that names no permission
-- -- privilege escalation by omission -- and the platform has no self-scoped mutation concept. That
-- gap is why a member could not so much as correct the spelling of their own name: the only door
-- onto their record was the administrative one, behind firm:manageMembers.
--
-- So this is the platform's answer to "the actor IS the subject", and it is seeded to every role for
-- the reason notifications:read is: writing one's own name is not a privilege. Every statement it
-- gates is scoped to the session's own user id, so holding it reaches nothing about anybody else,
-- and a firm that withholds it is a firm that has decided its people's names are set centrally --
-- which is a real posture, and the reason this is a key rather than a hole in the chokepoint.
--
-- The rolePermission_ handles are minted once and committed as literals; the role_ids are the five
-- roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_editOwnProfileOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:editOwnProfile');
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_editOwnProfileAttrny', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:editOwnProfile');
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_editOwnProfilePara00', 'role_917LCQyRKP50Z9bW89vXl', 'firm:editOwnProfile');
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_editOwnProfileBill00', 'role_hwwC1D98d8Lazc_asL6vO', 'firm:editOwnProfile');
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_editOwnProfileRead00', 'role_WojF9F7kksBEftsmZGNhb', 'firm:editOwnProfile');
