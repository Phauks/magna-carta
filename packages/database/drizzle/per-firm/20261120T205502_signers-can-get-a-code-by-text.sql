ALTER TABLE `signing_signer` ADD `code_channel` text;--> statement-breakpoint
ALTER TABLE `signing_signer` ADD `mobile_number` text;--> statement-breakpoint
-- THE FIRM'S SIGNING SETTINGS GET AN OWNER.
--
-- `esign:manageSettings` decides which ways an outside signer may prove who they are: a code by
-- email, a code by text message, an outside identity check. Owner/Admin alone: what every signer
-- the firm sends to is asked to prove is the firm's decision, not one sender's. The house seed shape,
-- a plain INSERT, so tooling/lint-ungranted-permissions reads it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSettingsOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'esign:manageSettings');
