CREATE TABLE `connection_sync_issue` (
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
	CONSTRAINT "connection_sync_issue_local_kind_check" CHECK("connection_sync_issue"."local_kind" IN ('matter_event', 'firm_event', 'deadline')),
	CONSTRAINT "connection_sync_issue_kind_check" CHECK("connection_sync_issue"."kind" IN ('changed', 'removed')),
	CONSTRAINT "connection_sync_issue_state_check" CHECK("connection_sync_issue"."state" IN ('open', 'left')),
	CONSTRAINT "connection_sync_issue_found_shape_check" CHECK(("connection_sync_issue"."kind" = 'removed') = ("connection_sync_issue"."found_json" IS NULL))
);
