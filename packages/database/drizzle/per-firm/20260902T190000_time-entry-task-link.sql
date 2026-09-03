-- WHERE A TASK MEETS TIME: one nullable task_id on time_entry.
--
-- The column buys "how long did this actually take", per task and eventually per plan step, which is
-- the number that tells a firm whether its own plan estimates are honest. It is nullable and will be
-- null on nearly every row: time is captured against a MATTER, and naming a task is an extra the
-- timekeeper chooses.
--
-- ONE task, never a set. A time entry split across two tasks needs an allocation of its minutes
-- between them, and an allocation is a second ledger with its own rounding and its own disputes. The
-- honest encoding of "this block of time served two tasks" is two entries, which the capture surface
-- already supports and the narrative already wants. Should the firm ever need many-to-many, a join
-- table is an additive migration over this column's data; the reverse is not.
--
-- The task must be on the entry's OWN matter. A task on another matter would let a matter's time
-- point at work it is not paying for, and a task on NO matter is the firm's own work (renewing the
-- policy, interviewing a candidate) which by construction has no matter to bill. Neither is
-- expressible in SQLite as a constraint without a trigger, so the refusal lives in the service and
-- is tested; this comment says what the schema alone cannot.
--
-- Nothing here reaches back: the column does not exist on any row captured before now, and no
-- backfill guesses one. The billing freeze governs it like any other business column — a billed or
-- void entry refuses the edit.

ALTER TABLE `time_entry` ADD `task_id` text REFERENCES matter_task(id);--> statement-breakpoint
CREATE INDEX `time_entry_task_index` ON `time_entry` (`task_id`) WHERE "time_entry"."task_id" IS NOT NULL;