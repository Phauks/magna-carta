CREATE TABLE `scan_cache` (
	`content_sha256` text NOT NULL,
	`engine_version` text NOT NULL,
	`verdict` text NOT NULL,
	`signature` text,
	`scanned_at` text NOT NULL,
	PRIMARY KEY(`content_sha256`, `engine_version`),
	CONSTRAINT "scan_cache_verdict_check" CHECK("scan_cache"."verdict" IN ('clean', 'infected'))
);
