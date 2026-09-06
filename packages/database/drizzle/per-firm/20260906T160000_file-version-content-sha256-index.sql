-- Finding a committed version by the hash of its bytes.
--
-- The upload dialog now hashes a file before sending it and asks the firm whether it already holds
-- those bytes; a match on the same matter is reported instead of uploaded, and a match elsewhere in
-- the firm is copied server-side. That question is a lookup by content_sha256, which no index served,
-- so every file offered for upload would have walked the firm's whole version table. Additive: an
-- index only. The column comment lives beside the Drizzle definition in
-- packages/database/src/per-firm-schema.ts.
CREATE INDEX `file_version_content_sha256_index` ON `file_version` (`content_sha256`);--> statement-breakpoint
