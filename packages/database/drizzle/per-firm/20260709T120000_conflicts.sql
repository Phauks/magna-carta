CREATE TABLE `conflicts_check` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`subject_matter_id` text,
	`subject_parties_json` text NOT NULL,
	`scope_json` text NOT NULL,
	`strictness` text NOT NULL,
	`depth` integer NOT NULL,
	`inputs_json` text NOT NULL,
	`floor_raised` integer DEFAULT 0 NOT NULL,
	`actor_user_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT `conflicts_check_trigger_check` CHECK (length(`trigger`) > 0),
	CONSTRAINT `conflicts_check_strictness_check` CHECK (`strictness` IN ('balanced', 'over_inclusive')),
	CONSTRAINT `conflicts_check_depth_check` CHECK (`depth` >= 0)
);
--> statement-breakpoint
CREATE TABLE `conflicts_hit` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`source_class` text NOT NULL,
	`evidence_tier` integer NOT NULL,
	`matched_fields_json` text NOT NULL,
	`graph_path_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `conflicts_check`(`id`),
	CONSTRAINT `conflicts_hit_tier_check` CHECK (`evidence_tier` BETWEEN 1 AND 4),
	CONSTRAINT `conflicts_hit_source_class_check` CHECK (`source_class` IN ('party', 'graph', 'imputation', 'content'))
);
--> statement-breakpoint
CREATE INDEX `conflicts_hit_check_id_index` ON `conflicts_hit` (`check_id`);
--> statement-breakpoint
CREATE TABLE `conflicts_disposition` (
	`id` text PRIMARY KEY NOT NULL,
	`hit_id` text NOT NULL,
	`kind` text NOT NULL,
	`rationale` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`hit_id`) REFERENCES `conflicts_hit`(`id`),
	CONSTRAINT `conflicts_disposition_kind_check` CHECK (`kind` IN ('cleared', 'waiver_obtained', 'wall_erected', 'representation_declined'))
);
--> statement-breakpoint
CREATE INDEX `conflicts_disposition_hit_id_created_at_index` ON `conflicts_disposition` (`hit_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `conflicts_check_no_update` BEFORE UPDATE ON `conflicts_check` BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_check_no_delete` BEFORE DELETE ON `conflicts_check` BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_update` BEFORE UPDATE ON `conflicts_hit` BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_delete` BEFORE DELETE ON `conflicts_hit` BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_update` BEFORE UPDATE ON `conflicts_disposition` BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_delete` BEFORE DELETE ON `conflicts_disposition` BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it would
-- silently overwrite an audit row that a plain UPDATE cannot touch. A BEFORE INSERT guard that aborts
-- when the id already exists DOES fire on the insert half of a REPLACE — closing the one remaining path
-- that could mutate an append-only row in place. Normal inserts carry fresh random ids, so the guard's
-- primary-key existence check never matches on the happy path.
CREATE TRIGGER `conflicts_check_no_replace` BEFORE INSERT ON `conflicts_check` WHEN EXISTS (SELECT 1 FROM `conflicts_check` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_replace` BEFORE INSERT ON `conflicts_hit` WHEN EXISTS (SELECT 1 FROM `conflicts_hit` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_replace` BEFORE INSERT ON `conflicts_disposition` WHEN EXISTS (SELECT 1 FROM `conflicts_disposition` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
