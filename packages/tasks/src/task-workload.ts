import { isOverdue } from "@magna-carta/calendar/overdue";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { MATTER_TASK_TABLE } from "./task-statements.ts";

// WHAT IS OUTSTANDING, PER PERSON: every open task counted under the member it is assigned to, how
// many of those are past due, and how many carry no due date. Counts only — never a title, never a
// body. A task's words are work product on a matter, and a report about people's workload has no
// business carrying them.
//
// OPEN means what the matter-close notice means by it (countOpenMatterTasks in task-statements.ts):
// `state = 'open'` and not archived. OVERDUE is the calendar's comparison (`isOverdue` in
// packages/calendar/src/overdue.ts) against the instant the caller passes, in the task's own zone —
// never a stored flag, because there is none. A task with no due date, or no zone to read it in,
// is never overdue.
//
// The task counts under its assignee column. A task several members share is still one task with
// one name on the column, so the counts add up to the number of open tasks rather than more.
//
// The rows are grouped in SQL by everything the comparison needs, so the read returns one row per
// distinct (assignee, office, due date, time, zone) rather than one per task.
export const MAXIMUM_TASK_WORKLOAD_ROWS = 10000;

export interface TaskWorkloadRow {
  readonly assigneeUserId: string | null;
  readonly assigneeName: string | null;
  readonly openCount: number;
  readonly overdueCount: number;
  readonly undatedCount: number;
}

export interface TaskWorkload {
  readonly truncated: boolean;
  // Assigned members by name, then the open tasks with nobody on them (assigneeUserId null).
  readonly rows: readonly TaskWorkloadRow[];
}

export async function readTaskWorkload(
  database: SqlDatabase,
  input: { readonly now: string; readonly locationId: string | null },
): Promise<TaskWorkload> {
  // A task on no matter has no office, so narrowing to an office leaves the firm's own tasks out.
  const office =
    input.locationId === null ? "" : "AND t.matter_id IS NOT NULL AND m.location_id = ?1 ";
  const statement = database.prepare(
    `SELECT t.assignee_user_id, mem.display_name AS assignee_name,
            t.due_on, t.due_at_time, t.time_zone, COUNT(*) AS task_count
       FROM ${MATTER_TASK_TABLE} t
       LEFT JOIN matter m ON m.id = t.matter_id
       LEFT JOIN member mem ON mem.user_id = t.assignee_user_id
      WHERE t.state = 'open' AND t.archived_at IS NULL ${office}
      GROUP BY t.assignee_user_id, t.due_on, t.due_at_time, t.time_zone
      LIMIT ${String(MAXIMUM_TASK_WORKLOAD_ROWS + 1)}`,
  );
  const { results } = await (
    input.locationId === null ? statement : statement.bind(input.locationId)
  ).all<{
    assignee_user_id: string | null;
    assignee_name: string | null;
    due_on: string | null;
    due_at_time: string | null;
    time_zone: string | null;
    task_count: number;
  }>();

  const people = new Map<
    string,
    { name: string | null; open: number; overdue: number; undated: number }
  >();
  for (const row of results.slice(0, MAXIMUM_TASK_WORKLOAD_ROWS)) {
    const key = row.assignee_user_id ?? "";
    const person = people.get(key) ?? { name: row.assignee_name, open: 0, overdue: 0, undated: 0 };
    person.open += row.task_count;
    if (row.due_on === null) person.undated += row.task_count;
    else if (
      row.time_zone !== null &&
      isOverdue(
        { dueOn: row.due_on, dueAtTime: row.due_at_time, timeZone: row.time_zone, state: "open" },
        input.now,
      )
    ) {
      person.overdue += row.task_count;
    }
    people.set(key, person);
  }

  const rows = [...people.entries()].map(([key, person]) => ({
    assigneeUserId: key === "" ? null : key,
    assigneeName: person.name,
    openCount: person.open,
    overdueCount: person.overdue,
    undatedCount: person.undated,
  }));
  rows.sort((left, right) => {
    if (left.assigneeUserId === null) return 1;
    if (right.assigneeUserId === null) return -1;
    return (left.assigneeName ?? "").localeCompare(right.assigneeName ?? "");
  });
  return { truncated: results.length > MAXIMUM_TASK_WORKLOAD_ROWS, rows };
}
