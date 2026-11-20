CREATE TABLE `connection_sync_day_issue` (
	`connection_id` text NOT NULL,
	`local_kind` text NOT NULL,
	`local_id` text NOT NULL,
	`occurrence_on` text NOT NULL,
	`state` text NOT NULL,
	`day_remote_id` text,
	`sent_json` text NOT NULL,
	`detected_at` text NOT NULL,
	`settled_at` text,
	PRIMARY KEY(`connection_id`, `local_kind`, `local_id`, `occurrence_on`),
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connection`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "connection_sync_day_issue_local_kind_check" CHECK("connection_sync_day_issue"."local_kind" IN ('matter_event', 'firm_event')),
	CONSTRAINT "connection_sync_day_issue_state_check" CHECK("connection_sync_day_issue"."state" IN ('open', 'left', 'restoring')),
	CONSTRAINT "connection_sync_day_issue_occurrence_on_shape_check" CHECK("connection_sync_day_issue"."occurrence_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
