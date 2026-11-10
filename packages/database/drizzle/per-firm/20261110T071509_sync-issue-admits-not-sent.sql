PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_connection_sync_issue` (
	`connection_id` text NOT NULL,
	`local_kind` text NOT NULL,
	`local_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`remote_version_tag` text,
	`sent_json` text NOT NULL,
	`found_json` text,
	`detected_at` text NOT NULL,
	`settled_at` text,
	PRIMARY KEY(`connection_id`, `local_kind`, `local_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connection`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "connection_sync_issue_local_kind_check" CHECK("__new_connection_sync_issue"."local_kind" IN ('matter_event', 'firm_event', 'deadline')),
	CONSTRAINT "connection_sync_issue_kind_check" CHECK("__new_connection_sync_issue"."kind" IN ('changed', 'removed', 'not_sent')),
	CONSTRAINT "connection_sync_issue_state_check" CHECK("__new_connection_sync_issue"."state" IN ('open', 'left')),
	CONSTRAINT "connection_sync_issue_found_shape_check" CHECK(("__new_connection_sync_issue"."kind" = 'changed') = ("__new_connection_sync_issue"."found_json" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_connection_sync_issue`("connection_id", "local_kind", "local_id", "kind", "state", "remote_version_tag", "sent_json", "found_json", "detected_at", "settled_at") SELECT "connection_id", "local_kind", "local_id", "kind", "state", "remote_version_tag", "sent_json", "found_json", "detected_at", "settled_at" FROM `connection_sync_issue`;--> statement-breakpoint
DROP TABLE `connection_sync_issue`;--> statement-breakpoint
ALTER TABLE `__new_connection_sync_issue` RENAME TO `connection_sync_issue`;--> statement-breakpoint
PRAGMA foreign_keys=ON;