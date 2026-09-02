import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { TIME_ENTRY_TABLE } from "./time-entry-statements.ts";

// HOW LONG DID THIS ACTUALLY TAKE. The grouped read behind the time a task shows, over the
// work-in-progress store and never the ledger — the same standing rule my-day.ts reads under.
//
// MINUTES, NEVER MONEY. The question the task_id column exists to answer is one of duration: how
// long a piece of work took, which is what tells a firm whether its own plan estimates are honest.
// Amounts are a different question with a different audience and a different permission, and a
// summary that carried both would have to be gated by the stricter of the two everywhere it is
// read. What money was billed for a task is a billing surface's question, asked there.
//
// VOID IS EXCLUDED and every other status counts. A discarded capture never colours the total; a
// billed hour is still an hour the work took.

// One read per chunk, never one per task: the task list is paged, and a per-row lookup would put a
// round-trip on every row of every page. The cap is D1's bound-parameter limit, spelled here as
// email-auto-file-statements.ts spells its own rather than reaching into another domain package for
// a number.
const MAX_BOUND_PARAMETERS = 100;

export interface TaskTimeQuery {
  readonly taskIds: readonly string[];
  // Null reads every timekeeper's entries; a user id narrows the read to that member's own. This is
  // the caller's `time:viewFirm` answer arriving as data: a member without it sees the time THEY
  // logged against a task and never a colleague's, which is the same line My Day draws.
  readonly onlyTimekeeperUserId: UserId | null;
}

export interface TaskTimeSummary {
  readonly billableMinutes: number;
  readonly nonBillableMinutes: number;
  readonly entryCount: number;
}

export const NO_TIME_LOGGED: TaskTimeSummary = {
  billableMinutes: 0,
  nonBillableMinutes: 0,
  entryCount: 0,
};

interface TaskTotalsRow {
  readonly task_id: string;
  readonly billable_minutes: number | null;
  readonly non_billable_minutes: number | null;
  readonly entry_count: number;
}

// Returns a summary for every task asked about, including the ones with no time against them: a
// caller rendering a list needs "nothing logged" to be a value it can print, not a missing key it
// has to remember to default. A task nobody has logged time to comes back as NO_TIME_LOGGED.
export async function readTaskTimeSummaries(
  database: SqlDatabase,
  query: TaskTimeQuery,
): Promise<Map<string, TaskTimeSummary>> {
  const summaries = new Map<string, TaskTimeSummary>(
    query.taskIds.map((taskId) => [taskId, NO_TIME_LOGGED]),
  );
  if (query.taskIds.length === 0) return summaries;

  // One bind is spent on the timekeeper when the reader is narrowed, so a chunk carries one fewer
  // task than the cap allows in that case.
  const timekeeperUserId = query.onlyTimekeeperUserId;
  const chunkSize = timekeeperUserId === null ? MAX_BOUND_PARAMETERS : MAX_BOUND_PARAMETERS - 1;
  for (let start = 0; start < query.taskIds.length; start += chunkSize) {
    const chunk = query.taskIds.slice(start, start + chunkSize);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const timekeeperClause =
      timekeeperUserId === null ? "" : ` AND timekeeper_user_id = ?${chunk.length + 1}`;
    const bindings = timekeeperUserId === null ? [...chunk] : [...chunk, timekeeperUserId];
    const { results } = await database
      .prepare(
        `SELECT
           task_id,
           COALESCE(SUM(CASE WHEN billable = 1 THEN duration_minutes ELSE 0 END), 0) AS billable_minutes,
           COALESCE(SUM(CASE WHEN billable = 0 THEN duration_minutes ELSE 0 END), 0) AS non_billable_minutes,
           COUNT(*) AS entry_count
         FROM ${TIME_ENTRY_TABLE}
         WHERE task_id IN (${placeholders}) AND status != 'void'${timekeeperClause}
         GROUP BY task_id`,
      )
      .bind(...bindings)
      .all<TaskTotalsRow>();
    for (const row of results) {
      summaries.set(row.task_id, {
        billableMinutes: row.billable_minutes ?? 0,
        nonBillableMinutes: row.non_billable_minutes ?? 0,
        entryCount: row.entry_count,
      });
    }
  }
  return summaries;
}

// The one-task spelling, for a detail surface. Goes through the same grouped read so there is one
// definition of what counts.
export async function readTaskTimeSummary(
  database: SqlDatabase,
  taskId: string,
  onlyTimekeeperUserId: UserId | null,
): Promise<TaskTimeSummary> {
  const summaries = await readTaskTimeSummaries(database, {
    taskIds: [taskId],
    onlyTimekeeperUserId,
  });
  return summaries.get(taskId) ?? NO_TIME_LOGGED;
}
