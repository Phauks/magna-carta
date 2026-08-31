-- Reaching the contact tables, and giving them the columns the entry surface needs.
--
-- `directory_email`, `directory_phone` and `directory_address` have existed since the baseline
-- migration and nothing could write to them: email had a write path reachable only from inbound mail
-- capture, and phone and address had no domain module at all. A firm could not record a client's
-- telephone number. These columns land WITH the domain modules and routes that reach the tables, so
-- the entry surface is built against the shape it will keep rather than against a shape it outgrows
-- in the next migration.
--
-- Hand-written rather than generated: drizzle-kit chooses its own order for column adds and index
-- creates, and the indexes here have to land after the columns they name on tables the fleet has
-- already provisioned. Every statement is additive — no column is dropped, none is repurposed, and
-- no existing index moves. `label` on phone and address is retained and becomes read-only; it is
-- dropped only after a window in which nothing is found carrying meaning the typed columns cannot.
--
-- The catalog columns (contact_system, contact_use, address_use, address_type, verification_status)
-- carry NO closed CHECK on purpose. A committed migration is immutable, so a closed IN (...) turns
-- every catalog addition into a migration against every firm, and a firm mid-upgrade would reject a
-- value the code already emits. The route's enum is the gate; the catalog lives in
-- packages/directory/src/types.ts. The 0/1 flags do get a CHECK, matching is_primary beside them.

-- ── directory_email ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE `directory_email` ADD COLUMN `contact_use` text;--> statement-breakpoint
ALTER TABLE `directory_email` ADD COLUMN `contact_permitted` integer DEFAULT 1 NOT NULL CONSTRAINT `directory_email_contact_permitted_check` CHECK (`contact_permitted` IN (0, 1));--> statement-breakpoint
ALTER TABLE `directory_email` ADD COLUMN `contact_preferred` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_email_contact_preferred_check` CHECK (`contact_preferred` IN (0, 1));--> statement-breakpoint
ALTER TABLE `directory_email` ADD COLUMN `contact_note` text;--> statement-breakpoint
ALTER TABLE `directory_email` ADD COLUMN `verification_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_email` ADD COLUMN `verified_at` text;--> statement-breakpoint
ALTER TABLE `directory_email` ADD COLUMN `verified_by` text;--> statement-breakpoint
ALTER TABLE `directory_email` ADD COLUMN `verification_detail` text;--> statement-breakpoint

-- ── directory_phone ──────────────────────────────────────────────────────────────────────────────
-- `number` keeps its meaning as the number AS ENTERED and is never rewritten. The structured columns
-- sit beside it and go null when the input cannot be split, so an unparseable number is recorded
-- honestly rather than guessed at or refused.
ALTER TABLE `directory_phone` ADD COLUMN `contact_system` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `contact_use` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `country_calling_code` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `national_number` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `extension` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `country_region_code` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `contact_permitted` integer DEFAULT 1 NOT NULL CONSTRAINT `directory_phone_contact_permitted_check` CHECK (`contact_permitted` IN (0, 1));--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `contact_preferred` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_phone_contact_preferred_check` CHECK (`contact_preferred` IN (0, 1));--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `contact_note` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `verification_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `verified_at` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `verified_by` text;--> statement-breakpoint
ALTER TABLE `directory_phone` ADD COLUMN `verification_detail` text;--> statement-breakpoint
CREATE INDEX `directory_phone_national_number_index` ON `directory_phone` (`country_calling_code`,`national_number`);--> statement-breakpoint

-- ── directory_address ────────────────────────────────────────────────────────────────────────────
-- The field set is the international one. Which fields a country uses, what they are called and what
-- order they read in all vary, so the columns are named for their POSITION in a postal address
-- rather than for what one country calls them: recipient, organization, address lines, dependent
-- locality, locality, administrative area, postal code, sorting code, country. `street`/`city`/
-- `region`/`postal` keep their existing storage and take the line, locality, administrative area and
-- postal code respectively.
ALTER TABLE `directory_address` ADD COLUMN `recipient` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `organization_name` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `street_two` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `dependent_locality` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `sorting_code` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `address_use` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `address_type` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `normalized_key` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `contact_permitted` integer DEFAULT 1 NOT NULL CONSTRAINT `directory_address_contact_permitted_check` CHECK (`contact_permitted` IN (0, 1));--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `contact_preferred` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_address_contact_preferred_check` CHECK (`contact_preferred` IN (0, 1));--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `contact_note` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `verification_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `verified_at` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `verified_by` text;--> statement-breakpoint
ALTER TABLE `directory_address` ADD COLUMN `verification_detail` text;--> statement-breakpoint
CREATE INDEX `directory_address_normalized_key_index` ON `directory_address` (`normalized_key`);--> statement-breakpoint

-- ── directory_person ─────────────────────────────────────────────────────────────────────────────
-- Date of birth was filed as an encrypted directory_identifier row, which matches only by exact
-- blind index; a date of birth is too low-entropy to index safely, so the code deliberately refused
-- to index it, and every question a firm asks of a date of birth is a range. The result was a
-- platform that could not usefully record one. It becomes an ordinary attribute of the person, in
-- the clear, on the same reasoning the pronoun columns beside it already stand on, and registered in
-- the erasure registry so subject erasure reaches it. The `dob` identifier type is not dropped —
-- values already sealed under it stay readable and it is closed to new writes.
--
-- Date of death has a consumer already waiting: decedent_entity_id names a decedent and there was
-- nowhere to record when they died. `deceased` is separate from the date because "known dead, date
-- unknown" is a state probate work meets constantly; the write path holds the implication that a
-- recorded date implies the flag, since a cross-column CHECK cannot be added to a populated table
-- without rebuilding it.
ALTER TABLE `directory_person` ADD COLUMN `date_of_birth` text;--> statement-breakpoint
ALTER TABLE `directory_person` ADD COLUMN `date_of_death` text;--> statement-breakpoint
ALTER TABLE `directory_person` ADD COLUMN `deceased` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_person_deceased_check` CHECK (`deceased` IN (0, 1));
