import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readTaskWorkload, type TaskWorkloadRow } from "@magna-carta/tasks/task-workload";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";

// TASKS BY PERSON — what each member has outstanding: open tasks, how many are past due, and how
// many have no due date. Counts only, never a task's words.
//
// The counts are the tasks package's own (`readTaskWorkload`), where "open" and "overdue" are
// defined; this module adds the people up into the firm's totals and nothing else.
// test/productivity-task-workload.test.ts proves the people add up to every open task.
//
// LIVE ONLY: a task is edited in place and "overdue" is a comparison against the moment the report
// is produced, so it takes no date and says when it was computed.

export interface TaskWorkloadFigures {
  readonly openCount: number;
  readonly overdueCount: number;
  readonly undatedCount: number;
}

export interface TaskWorkloadReport {
  readonly computedAt: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly completeness: ReportCompleteness;
  readonly totals: TaskWorkloadFigures;
  readonly people: readonly TaskWorkloadRow[];
}

export function taskWorkloadStatement(computedAt: string): string {
  return (
    `This report counts open tasks as they stood when it was produced, at ${computedAt}, and a ` +
    `task is overdue if its due time had passed by then. Tasks are done, reassigned and moved ` +
    `all the time, so it is a live report: running it again later will reflect any change made in ` +
    `the meantime, and it is not claimed to reproduce.`
  );
}

export async function assembleTaskWorkload(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
  options: { readonly computedAt: string },
): Promise<TaskWorkloadReport> {
  const workload = await readTaskWorkload(database, {
    now: options.computedAt,
    locationId: input.locationId,
  });
  if (workload.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "the firm has more open tasks than one report can count; choose an office to narrow it",
    );
  }
  const totals = { openCount: 0, overdueCount: 0, undatedCount: 0 };
  for (const person of workload.rows) {
    totals.openCount += person.openCount;
    totals.overdueCount += person.overdueCount;
    totals.undatedCount += person.undatedCount;
  }
  return {
    computedAt: options.computedAt,
    reproducible: false,
    statement: taskWorkloadStatement(options.computedAt),
    locationId: input.locationId,
    completeness: completeScope(),
    totals,
    people: workload.rows,
  };
}
