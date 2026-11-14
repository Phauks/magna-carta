-- A MEETING POLL HAS A KIND, AND A RANKING'S ANSWERS CARRY THEIR PLACE.
--
-- `kind` says what the poll asks: `one` (pick one), `multiple` (pick up to `max_choices`), `ranking`
-- (put every option in order) or `score` (a rating, its options the points of the scale). Existing
-- polls are mapped from `max_choices`, which until now was the only thing that told the two apart.
--
-- `rank` is the place a participant gave an option on a ranking, 1 first; null on every other kind.
--
-- contract: nothing is dropped and nothing is rebuilt. Both are ADDED columns carrying their own
-- CHECK, because `meeting_poll` is a parent (`meeting_poll_option`, `meeting_poll_respondent` and
-- `meeting_poll_answer` reference it) and a rebuild of a parent cannot commit in a durable object.
ALTER TABLE `meeting_poll` ADD `kind` text DEFAULT 'one' NOT NULL CHECK (`kind` IN ('one', 'multiple', 'ranking', 'score'));--> statement-breakpoint
UPDATE `meeting_poll` SET `kind` = 'multiple' WHERE `max_choices` > 1;--> statement-breakpoint
ALTER TABLE `meeting_poll_answer` ADD `rank` integer CHECK (`rank` IS NULL OR `rank` BETWEEN 1 AND 10);
