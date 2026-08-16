CREATE TABLE `notification_in_app_suppression` (
	`recipient_user_id` text NOT NULL,
	`category` text NOT NULL,
	`civil_date` text NOT NULL,
	`suppressed_count` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`last_suppressed_at` text NOT NULL,
	PRIMARY KEY(`recipient_user_id`, `category`, `civil_date`, `reason`),
	CONSTRAINT "notification_in_app_suppression_count_nonnegative_check" CHECK("notification_in_app_suppression"."suppressed_count" >= 0),
	CONSTRAINT "notification_in_app_suppression_category_check" CHECK("notification_in_app_suppression"."category" IN ('deadlines', 'calendar', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')),
	CONSTRAINT "notification_in_app_suppression_reason_check" CHECK("notification_in_app_suppression"."reason" IN ('member-preference', 'firm-policy'))
);
