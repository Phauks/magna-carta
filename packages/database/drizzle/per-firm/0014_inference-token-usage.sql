CREATE TABLE `token_usage_meter` (
	`day` text NOT NULL,
	`slot` text NOT NULL,
	`model_id` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`request_count` integer NOT NULL,
	PRIMARY KEY(`day`, `slot`, `model_id`)
);
