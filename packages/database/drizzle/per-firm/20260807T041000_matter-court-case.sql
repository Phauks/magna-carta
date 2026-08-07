-- The matter's court-and-case identity: the court (a Directory organisation), the judge (a
-- Directory person), the case number, and the two designation words a caption prints in its own
-- jurisdiction's vocabulary. The entity references are plain ids with no cross-domain foreign key,
-- exactly as matter_party holds its entity_id. One live record per matter, made structural by the
-- partial unique index — drizzle-kit cannot express a partial index, hence the hand-written file.
CREATE TABLE `matter_court_case` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`court_entity_id` text,
	`judge_entity_id` text,
	`case_number` text,
	`division` text,
	`department` text,
	`filed_on` text,
	`client_designation` text,
	`opposing_designation` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_court_case_matter_id_unique_index` ON `matter_court_case` (`matter_id`) WHERE "matter_court_case"."deleted_at" IS NULL;
