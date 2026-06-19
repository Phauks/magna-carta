CREATE TABLE `integration_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`adapter_id` text NOT NULL,
	`scope` text NOT NULL,
	`principal_ref` text NOT NULL,
	`credential_ref` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`capability_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connection_principal_category_unique_index` ON `integration_connection` (`category`,`principal_ref`);--> statement-breakpoint
CREATE TABLE `shipment` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_ref` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`parcel` text NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`remote_shipment_id` text,
	`carrier` text,
	`service` text,
	`tracking_code` text,
	`label_ref` text,
	`postage_cost_minor` integer,
	`service_fee_minor` integer,
	`currency` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_ref`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shipment_matter_ref_index` ON `shipment` (`matter_ref`);--> statement-breakpoint
CREATE INDEX `shipment_tracking_code_index` ON `shipment` (`tracking_code`);--> statement-breakpoint
CREATE TABLE `shipment_label` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_ref` text NOT NULL,
	`format` text NOT NULL,
	`r2_key` text NOT NULL,
	`tracking_code` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`voided` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_ref`) REFERENCES `shipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracking_event` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_ref` text NOT NULL,
	`remote_id` text NOT NULL,
	`status` text NOT NULL,
	`occurred_at` text,
	`location` text,
	`message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_ref`) REFERENCES `shipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_event_shipment_remote_unique_index` ON `tracking_event` (`shipment_ref`,`remote_id`);--> statement-breakpoint
-- Default-role grant for shipping: Owner/Admin gets shipping:manage (the same role that holds
-- locations:manage from 0004). Other seeded roles get no shipping permission this slice.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_q7J6yK5CfA9O1vgyLizLh', 'role_Gw-zKO8hOHQuNv2bWokMp', 'shipping:manage');