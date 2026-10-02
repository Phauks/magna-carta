CREATE TABLE `integration_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_ref` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_credential_credential_ref_unique` ON `integration_credential` (`credential_ref`);
--> statement-breakpoint
-- The gate on a connected integration's credential. Seeded to the same role that holds every
-- integration's manage key today (Owner/Admin, which also holds shipping:manage), because this key is
-- the floor under those rather than an alternative to them: holding it decrypts nothing on its own,
-- since a credential is only ever reached through a route that has already enforced its integration's
-- own permission. A firm granting an integration to another role grants this beside it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_integUseConnectionOwn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'integrations:useConnection');
