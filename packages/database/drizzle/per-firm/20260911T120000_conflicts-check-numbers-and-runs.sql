CREATE TABLE `conflicts_numbered_check` (
	`id` text PRIMARY KEY NOT NULL,
	`check_sequence` integer NOT NULL,
	`check_number` text NOT NULL,
	`subject_matter_id` text,
	`latest_run_id` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "conflicts_numbered_check_sequence_check" CHECK("conflicts_numbered_check"."check_sequence" > 0),
	CONSTRAINT "conflicts_numbered_check_number_check" CHECK(length("conflicts_numbered_check"."check_number") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflicts_numbered_check_sequence_unique_index` ON `conflicts_numbered_check` (`check_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `conflicts_numbered_check_number_unique_index` ON `conflicts_numbered_check` (`check_number`);--> statement-breakpoint
CREATE INDEX `conflicts_numbered_check_matter_created_index` ON `conflicts_numbered_check` (`subject_matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `conflicts_numbered_check_created_id_index` ON `conflicts_numbered_check` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `conflicts_check_run` (
	`id` text PRIMARY KEY NOT NULL,
	`numbered_check_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`progress_json` text,
	`request_json` text NOT NULL,
	`trigger` text NOT NULL,
	`trigger_source` text,
	`requested_by_user_id` text,
	`started_at` text,
	`heartbeat_at` text,
	`finished_at` text,
	`failure` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`numbered_check_id`) REFERENCES `conflicts_numbered_check`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "conflicts_check_run_status_check" CHECK("conflicts_check_run"."status" IN ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "conflicts_check_run_ordinal_check" CHECK("conflicts_check_run"."ordinal" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflicts_check_run_check_ordinal_unique_index` ON `conflicts_check_run` (`numbered_check_id`,`ordinal`);--> statement-breakpoint
INSERT INTO `conflicts_numbered_check` (`id`, `check_sequence`, `check_number`, `subject_matter_id`, `latest_run_id`, `created_by_user_id`, `created_at`, `updated_at`)
SELECT
	ordered.id,
	ordered.ordinal,
	'CC-' || printf('%04d', ordered.ordinal),
	ordered.subject_matter_id,
	ordered.id,
	ordered.actor_user_id,
	ordered.created_at,
	ordered.created_at
FROM (
	SELECT
		id,
		subject_matter_id,
		actor_user_id,
		created_at,
		ROW_NUMBER() OVER (ORDER BY created_at, rowid) AS ordinal
	FROM `conflicts_check`
) AS ordered;--> statement-breakpoint
INSERT INTO `conflicts_check_run` (`id`, `numbered_check_id`, `ordinal`, `status`, `stage`, `progress_json`, `request_json`, `trigger`, `trigger_source`, `requested_by_user_id`, `started_at`, `heartbeat_at`, `finished_at`, `failure`, `created_at`)
SELECT
	id,
	id,
	1,
	'completed',
	NULL,
	NULL,
	json_object(
		'trigger', trigger,
		'matterId', subject_matter_id,
		'subjectEntityIds', json(subject_parties_json),
		'scope', json_object(
			'sources', (SELECT json_group_array(key) FROM json_each(`conflicts_check`.scope_json) WHERE key IN ('party', 'graph', 'imputation', 'content')),
			'strictness', strictness
		)
	),
	trigger,
	trigger_source,
	actor_user_id,
	created_at,
	created_at,
	created_at,
	NULL,
	created_at
FROM `conflicts_check`;
