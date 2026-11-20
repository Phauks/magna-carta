CREATE TABLE `shared_problem_report` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`route` text,
	`error_id_count` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shared_problem_report_sent_at_index` ON `shared_problem_report` (`sent_at`);--> statement-breakpoint
CREATE INDEX `shared_problem_report_firm_index` ON `shared_problem_report` (`firm_id`);--> statement-breakpoint
ALTER TABLE `firm` ADD `shares_problem_reports` integer DEFAULT true NOT NULL;