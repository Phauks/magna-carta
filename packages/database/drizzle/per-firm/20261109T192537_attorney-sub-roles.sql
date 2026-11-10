-- PARTNER AND ASSOCIATE, AS SUB-ROLES OF ATTORNEY; AND OWNER/ADMIN BECOMES ADMIN.
--
-- A sub-role names its parent in `parent_role_id`. A member who holds one also holds the parent as a
-- row of its own, so every read that joins member_role to role_permission keeps working unchanged and
-- a Partner counts as an Attorney everywhere the product asks who the attorneys are. The sub-role's
-- own grants below are only what it ADDS to Attorney; nothing a member already holds changes here.
--
-- Partner adds the firm-wide views and approvals that sit between Attorney and Admin: the financial
-- and productivity reports, every timekeeper's time, approving time and costs, and reopening a closed
-- matter. Trust operating funds and rate management stay with Admin. Associate adds nothing yet; it
-- still files Associates together and carries an Associate default rate on a rate card.
--
-- The seed shape is the house one, plain INSERTs, so tooling/lint-ungranted-permissions reads it.
ALTER TABLE `role` ADD `parent_role_id` text REFERENCES role(id);
--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `parent_role_id`, `created_at`) VALUES ('role_attorneyPartner000000', 'Partner', 'role_gEyJ_YqL1_RI_yDqSa28Y', '2026-11-09T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `parent_role_id`, `created_at`) VALUES ('role_attorneyAssociate0000', 'Associate', 'role_gEyJ_YqL1_RI_yDqSa28Y', '2026-11-09T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_partnerReportsFinance', 'role_attorneyPartner000000', 'reports:financial');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_partnerReportsProduct', 'role_attorneyPartner000000', 'reports:productivity');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_partnerTimeViewFirm00', 'role_attorneyPartner000000', 'time:viewFirm');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_partnerTimeApprove000', 'role_attorneyPartner000000', 'time:approve');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_partnerCostsApprove00', 'role_attorneyPartner000000', 'costs:approve');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_partnerMattersReopen0', 'role_attorneyPartner000000', 'matters:reopen');
--> statement-breakpoint
-- The administering role is called Admin. It was never tied to owning the firm: anybody can hold it
-- beside any other role. The handle is unchanged, so every grant and assignment keeps pointing at it.
UPDATE `role` SET `name` = 'Admin' WHERE `id` = 'role_Gw-zKO8hOHQuNv2bWokMp';
