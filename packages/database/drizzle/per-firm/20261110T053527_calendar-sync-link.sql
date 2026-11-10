CREATE TABLE `calendar_sync_link` (
	`connection_id` text NOT NULL,
	`local_kind` text NOT NULL,
	`local_id` text NOT NULL,
	`calendar_remote_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`remote_event_id` text,
	`remote_version_tag` text,
	`agreed_hash` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `local_kind`, `local_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connection`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calendar_sync_link_local_kind_check" CHECK("calendar_sync_link"."local_kind" IN ('matter_event', 'firm_event', 'deadline')),
	CONSTRAINT "calendar_sync_link_state_check" CHECK("calendar_sync_link"."state" IN ('pending', 'synced', 'failed')),
	CONSTRAINT "calendar_sync_link_synced_shape_check" CHECK("calendar_sync_link"."state" <> 'synced' OR "calendar_sync_link"."remote_event_id" IS NOT NULL)
);
