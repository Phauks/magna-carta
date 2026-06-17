CREATE TABLE `firm_secret` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firm_secret_name_unique` ON `firm_secret` (`name`);--> statement-breakpoint
-- contract: description_ciphertext is added now; the plaintext `description` column is dropped in a
-- later slice after a verification window (expand-contract).
ALTER TABLE `incident` ADD `description_ciphertext` text;--> statement-breakpoint
-- Default-role grants for the protected-module permissions — both to Owner/Admin only (others none;
-- adjustable data). Permission values are registry keys from @magna-carta/access-control; the
-- seed-vs-registry fitness test cross-checks each. rolePermission_ ids are committed literals.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_mS1kQ3mN8vX2pL5wR9tB7', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageSecrets');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_iV2dC4hT6yU8wE1rA3sD5', 'role_Gw-zKO8hOHQuNv2bWokMp', 'incidents:viewDescription');