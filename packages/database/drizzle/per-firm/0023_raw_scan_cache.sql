-- Reshapes scan_cache to store the full serialized RawScanResult (raw_result JSON text) in place
-- of the pre-decided verdict + signature pair. The (content_sha256, engine_version) composite key
-- is unchanged; only the value column changes shape. The verdict CHECK constraint is dropped along
-- with the old columns — the stored value is now opaque JSON, not a constrained enum.
-- Pre-production: no rows exist, so DROP TABLE + CREATE TABLE is a safe forward migration.
DROP TABLE `scan_cache`;
--> statement-breakpoint
CREATE TABLE `scan_cache` (
	`content_sha256` text NOT NULL,
	`engine_version` text NOT NULL,
	`raw_result` text NOT NULL,
	`scanned_at` text NOT NULL,
	PRIMARY KEY(`content_sha256`, `engine_version`)
);
