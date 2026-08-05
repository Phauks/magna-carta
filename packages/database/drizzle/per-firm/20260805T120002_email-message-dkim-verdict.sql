-- The DKIM adjudication of a captured message. `dkim_verdict` already existed with its three-value
-- CHECK and an `unverified` default; what was missing is why it holds the value it holds, and whose
-- signature carried a pass. Hand-written rather than drizzle-kit-generated: two ADD COLUMNs, and the
-- column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- The verdict enum is deliberately NOT widened. Every inconclusive outcome — unsigned mail, a .msg
-- export with no RFC 5322 octets to canonicalize, a selector whose key has rotated away, a resolver
-- outage — stays `unverified` and is told apart by the reason, so the coarse verdict keeps meaning
-- exactly one thing to a reader and no table rebuild is needed to add a reason later.
--
-- No index on either column: both are read as part of a message already resolved by id, and there is
-- no "which mail did this domain sign" read to serve. An index arrives with its reader.
ALTER TABLE `email_message` ADD COLUMN `dkim_verdict_reason` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD COLUMN `dkim_verified_domain` text;
