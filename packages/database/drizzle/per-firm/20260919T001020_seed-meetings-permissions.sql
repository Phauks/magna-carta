-- MEETINGS GET THEIR TWO SEATS.
--
-- `meetings:join` follows `communications:read` and `meetings:host` follows `communications:log`,
-- which is not a convenience: a meeting is a conversation the firm had, exactly as a call is, and a
-- firm that has already decided who may read its conversations and who may cause one has decided
-- this too. Splitting them differently would mean two answers to one question the first time
-- somebody asked why the bookkeeper can see a call but not a video call about the same bill.
--
-- So join reaches Owner/Admin, Attorney, Paralegal and Billing — being in the room is ordinary work,
-- and a bookkeeper joining the call about an unpaid invoice is the case that makes it so. Host
-- reaches the first three and not Billing: convening a meeting on a matter is the practitioner's
-- act, and it is also the act that ends one for everybody else in the room.
--
-- Read-only carries neither, which is the same line it sits on for communications: a seat that may
-- not record what the firm said is not a seat that joins the saying of it.
--
-- The house seed shape, plain and unqualified: a migration applies once per lineage, tracked by the
-- journal, so there is nothing for an OR IGNORE to guard against — and the fitness scan in
-- tooling/lint-ungranted-permissions reads exactly this form to prove the permission is reachable by
-- somebody. The rolePermission_ handles are minted once and committed as literals; the role_ids are
-- the five roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsJoinOwner0000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'meetings:join');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsJoinAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'meetings:join');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsJoinParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'meetings:join');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsJoinBilling00', 'role_hwwC1D98d8Lazc_asL6vO', 'meetings:join');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsHostOwner0000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'meetings:host');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsHostAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'meetings:host');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsHostParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'meetings:host');
