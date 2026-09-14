/*
 * One task, on paper.
 *
 * A task sheet answers a different question from a note's. A note records what happened; a task
 * records what the firm OWES and what became of it, so the sheet states the outcome as plainly as
 * the instruction: done by whom and when, or not done and the reason the firm gave. A sheet that
 * printed only the words and the due date would be a to-do list item rather than a record of a
 * decision, and the decision is the part somebody reaches for a year later.
 *
 * The sheet is data, never markup: what reaches the paper is the closed set of strings below.
 */
import type { PrintSheetDates } from "$lib/print-sheet";
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import { PRIORITY_LABELS, STATE_LABELS, describeTimeLogged, type MatterTask } from "./tasks-api.ts";

/** Everything the sheet needs that is not the task itself. */
export interface TaskSheetContext extends PrintSheetDates {
  /** The matter the task belongs to, or what to call the firm's own work where it has none. */
  readonly matterTitle: string;
  /** Who it is with, as a name. Never an account identifier. */
  readonly assigneeName: string;
  /** Who wrote it, as a name. */
  readonly authorName: string;
  /** Who closed it, where anybody has — completed or cancelled, whichever happened. */
  readonly closedByName: string | null;
  /** A stored instant as a reader sees it. */
  readonly instant: (at: string) => string;
  /** The documents the task points at, by name. */
  readonly attachedNames: readonly string[];
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
}

/**
 * When the task is due, as one stated line. Null where nobody has scheduled it.
 *
 * The zone rides along with a wall-clock time because the two are one fact: "14:30" on paper with
 * no zone is a different moment to every reader who picks the sheet up.
 */
export function dueLine(task: MatterTask, date: (isoDate: string) => string): string | null {
  if (task.dueOn === null) return null;
  if (task.dueAtTime === null) return date(task.dueOn);
  return `${date(task.dueOn)}, ${task.dueAtTime}${task.timeZone === null ? "" : ` (${task.timeZone})`}`;
}

/**
 * What became of the task, as the sheet states it.
 *
 * Cancelled and done are kept apart here for the same reason they are kept apart everywhere else:
 * one says the firm did the work, the other says the firm decided not to, and a sheet that
 * flattened them into "closed" would lose the only fact worth printing about a cancellation.
 */
function outcomeFields(task: MatterTask, context: TaskSheetContext) {
  if (task.state === "done") {
    return [
      { label: "Done By", value: context.closedByName ?? "Not recorded" },
      ...(task.completedAt === null
        ? []
        : [{ label: "Done", value: context.instant(task.completedAt) }]),
    ];
  }
  if (task.state === "cancelled") {
    return [
      { label: "Cancelled By", value: context.closedByName ?? "Not recorded" },
      ...(task.cancelledAt === null
        ? []
        : [{ label: "Cancelled", value: context.instant(task.cancelledAt) }]),
      { label: "Not Doing It Because", value: task.cancellationReason ?? "Not recorded" },
    ];
  }
  return [];
}

/** What one task's sheet says. */
export function taskSheet(task: MatterTask, context: TaskSheetContext): PrintSheetDocument {
  const due = dueLine(task, context.date);
  const timeLogged = describeTimeLogged(task.timeLogged);
  return {
    heading: "Task",
    subtitle: context.matterTitle,
    sections: [
      {
        id: "standing",
        kind: "fields",
        fields: [
          { label: "State", value: STATE_LABELS[task.state] },
          { label: "Assigned To", value: context.assigneeName },
          { label: "Due", value: due ?? "Not scheduled" },
          { label: "Priority", value: PRIORITY_LABELS[task.priority] },
          { label: "Created By", value: context.authorName },
          { label: "Created", value: context.instant(task.createdAt) },
          ...(timeLogged === null ? [] : [{ label: "Time Logged", value: timeLogged }]),
          ...outcomeFields(task, context),
        ],
      },
      ...(task.body === null
        ? []
        : ([{ id: "detail", kind: "text", title: "Detail", text: task.body }] as const)),
      {
        id: "documents",
        kind: "fields",
        title: "Documents",
        fields:
          context.attachedNames.length === 0
            ? [{ label: "Attached", value: "None" }]
            : context.attachedNames.map((name, position) => ({
                label: `Attached ${String(position + 1)}`,
                value: name,
              })),
      },
    ],
    footer: `${context.matterTitle} · printed ${context.printedAt}`,
  };
}
