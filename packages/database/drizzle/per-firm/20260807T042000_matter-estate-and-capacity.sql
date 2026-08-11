-- The estate a probate matter administers, and the capacity a party acts in. The estate's styles
-- are STORED, never composed — a legal designation a court has fixed is not a string a template may
-- invent — and the decedent and the estate's own record are Directory references, so name formats
-- and the estate's encrypted tax identifier ride the Directory's existing machinery. The capacity
-- column is a fact about the matter_party LINK (the same person is an administrator on one matter
-- and a beneficiary on the next), added by a non-destructive ALTER per the expand-contract rule.
CREATE TABLE `matter_estate` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`decedent_entity_id` text,
	`estate_entity_id` text,
	`date_of_death` text,
	`estate_style` text,
	`short_style` text,
	`proceeding_type` text,
	`letters_issued_on` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "matter_estate_proceeding_type_check" CHECK("matter_estate"."proceeding_type" IS NULL OR "matter_estate"."proceeding_type" IN ('testate', 'intestate', 'small_estate', 'ancillary')),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_estate_matter_id_unique_index` ON `matter_estate` (`matter_id`) WHERE "matter_estate"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE `matter_party` ADD `capacity` text;
