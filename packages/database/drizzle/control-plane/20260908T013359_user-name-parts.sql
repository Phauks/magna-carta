-- contract: `user` gains the parts a person's name is actually made of, beside the single `name` it
-- has always carried; `registration` carries the two the joining screen already asks for.
--
-- WHY THE PARTS AND NOT ONE STRING. A member's own name is what letterhead, a pleading's signature
-- block and every generated document print, and what a colleague is sorted by in a roster. One
-- string cannot be sorted by surname, cannot address a letter, and cannot be split back into parts
-- afterwards without guessing -- "Mary Anne van der Berg III" has no rule that recovers it. The
-- platform already models a person this way everywhere else it names one (directory_person carries
-- the same five columns), and a second, poorer answer for the firm's own people is what this closes.
--
-- `name` IS NOT REPLACED AND DOES NOT BECOME DERIVED-ONLY. Better Auth writes and reads it, so it
-- stays a real column and stays required; what changes is that where the parts are present it is
-- RENDERED from them rather than typed, and both are written in one statement so they cannot drift.
--
-- ALL SEVEN NULLABLE, and that is the whole safety argument: every existing row keeps exactly the
-- name it had, nothing is split on a guess, and a person's parts are written the first time they
-- say what they are. A reader falls back to `name` while they are null, which is what every row
-- holds today.
--
-- The prefix and suffix columns hold a LINE rather than a single word -- "III, Esq." is one
-- person's suffix -- because several honorifics is the ordinary case, and the line as written is
-- what goes after the name.
--
-- The two registration columns exist so an account created from today has real parts from its
-- first moment: the joining screen collects a first and last name and then joins them with a space,
-- and the parts were thrown away at that join.
ALTER TABLE `registration` ADD `name_given` text;--> statement-breakpoint
ALTER TABLE `registration` ADD `name_family` text;--> statement-breakpoint
ALTER TABLE `user` ADD `name_prefix` text;--> statement-breakpoint
ALTER TABLE `user` ADD `name_given` text;--> statement-breakpoint
ALTER TABLE `user` ADD `name_middle` text;--> statement-breakpoint
ALTER TABLE `user` ADD `name_family` text;--> statement-breakpoint
ALTER TABLE `user` ADD `name_suffix` text;