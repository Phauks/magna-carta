-- A TASK MOVES ALONG RUNGS, AND IS PUT AWAY RATHER THAN CANCELLED.
--
-- The reader's vocabulary becomes four rungs — To Do, In Progress, On Hold, Done — plus two ways a
-- task leaves a list: deleted, which takes the data, and archived, which keeps it. Cancellation is
-- retired: it said the same thing archiving says, and it demanded a reason before it would say it,
-- which is why no firm used it.
--
-- WHY THIS IS FOUR ADDED COLUMNS AND NOT A WIDER `state`. Widening a CHECK in SQLite costs a table
-- rebuild; a rebuild drops the table it replaces; and `matter_task` is a PARENT — `time_entry`,
-- `matter_task_document` and `matter_task_external_link` reference it, and so does its own
-- `blocked_by_task_id`. A durable object enforces foreign keys at the statement AND at the commit,
-- so that drop cannot complete against any firm that holds data. Six mechanisms were probed against
-- real durable-object storage and every one of them fails: the pragma in one context, the pragma
-- with a yield, `defer_foreign_keys`, rename-aside under `legacy_alter_table`, the two combined, and
-- editing `sqlite_schema` under `writable_schema` (refused outright — SQLITE_AUTH). The probes are
-- apps/api-worker/test/durable-object-pragma-context.test.ts, and the same file proves what this
-- migration relies on instead: an ADDED column may carry its own CHECK, including one naming a
-- second column, and it lands on a parent with children because it drops nothing.
--
-- So `state` keeps its three values and its meaning narrows to the one thing it is paired with by
-- CHECK: whether the work is finished. `cancelled` stays legal and is never written again.
--
-- contract: nothing is dropped and nothing is rebuilt. Four columns are added, the existing rows are
-- mapped onto them, and the only rows UPDATEd are the cancelled ones — which move to `open` on the
-- rung they would have been on, carrying their actor, instant and reason into the archive columns.
-- Their three cancellation columns are emptied in the SAME statement, because
-- `matter_task_cancellation_shape_check` pairs them with the state and would reject either half
-- alone. A firm with no cancelled task runs the UPDATE and changes nothing.
--
-- The rungs are NOT inferred from anything. There is no column that ever said whether an open task
-- was started, so every open task lands on `to_do`, which is what it was.
ALTER TABLE `matter_task` ADD `progress` text DEFAULT 'to_do' NOT NULL CHECK (`progress` IN ('to_do', 'in_progress', 'on_hold'));--> statement-breakpoint
ALTER TABLE `matter_task` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `matter_task` ADD `archived_by` text CHECK ((`archived_at` IS NULL) = (`archived_by` IS NULL));--> statement-breakpoint
ALTER TABLE `matter_task` ADD `archive_reason` text CHECK (`archived_at` IS NOT NULL OR `archive_reason` IS NULL);--> statement-breakpoint
UPDATE `matter_task`
SET `state` = 'open',
    `archived_at` = `cancelled_at`,
    `archived_by` = `cancelled_by`,
    `archive_reason` = `cancellation_reason`,
    `cancelled_at` = NULL,
    `cancelled_by` = NULL,
    `cancellation_reason` = NULL
WHERE `state` = 'cancelled';
