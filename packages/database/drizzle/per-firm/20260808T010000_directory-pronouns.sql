-- A directory person's pronouns, recorded as the person states them and never derived from a name, a
-- courtesy title, or any other column. The whole declension is stored rather than a label, because a
-- two-form label does not determine the possessive, the possessive pronoun, or the reflexive for a set
-- the platform has never seen — and the verb number is stored because nothing in the forms themselves
-- says whether the set agrees like "she is" or like "they are". Purely additive, so the table is not
-- rebuilt. Column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- The last ADD carries the completeness CHECK for the whole set: SQLite evaluates a column CHECK over
-- the entire row, and there is no ALTER TABLE ADD CONSTRAINT, so the constraint that makes a
-- half-recorded set unrepresentable rides the final column. It is written to accept every row that
-- exists today (all six columns are NULL on every pre-existing person) and to refuse any partial set
-- written after this migration.
ALTER TABLE `directory_person` ADD COLUMN `pronoun_subject` text;--> statement-breakpoint
ALTER TABLE `directory_person` ADD COLUMN `pronoun_object` text;--> statement-breakpoint
ALTER TABLE `directory_person` ADD COLUMN `pronoun_possessive_determiner` text;--> statement-breakpoint
ALTER TABLE `directory_person` ADD COLUMN `pronoun_possessive_pronoun` text;--> statement-breakpoint
ALTER TABLE `directory_person` ADD COLUMN `pronoun_reflexive` text;--> statement-breakpoint
ALTER TABLE `directory_person` ADD COLUMN `pronoun_verb_number` text CONSTRAINT `directory_person_pronoun_check` CHECK (
  (`pronoun_verb_number` IS NULL OR `pronoun_verb_number` IN ('singular', 'plural'))
  AND (`pronoun_object` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_possessive_determiner` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_possessive_pronoun` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_reflexive` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_verb_number` IS NULL) = (`pronoun_subject` IS NULL)
);
