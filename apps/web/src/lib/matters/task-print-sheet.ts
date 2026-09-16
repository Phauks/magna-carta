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
import {
  PRIORITY_LABELS,
  ROLE_LABELS,
  RUNG_LABELS,
  TASK_PARTICIPANT_ROLES,
  describeTimeLogged,
  participantsInRole,
  type MatterTask,
} from "./tasks-api.ts";

/** Everything the sheet needs that is not the task itself. */
export interface TaskSheetContext extends PrintSheetDates {
  /** The matter the task belongs to, or what to call the firm's own work where it has none. */
  readonly matterTitle: string;
  /** How an account identifier reads as a person. Never printed as a handle. */
  readonly nameOf: (userId: string | null) => string;
  /** Who wrote it, as a name. */
  readonly authorName: string;
  /** Who finished it, where anybody has. */
  readonly completedByName: string | null;
  /** Who put it away, where anybody has. */
  readonly archivedByName: string | null;
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
 * The people on the task, one field per role that anybody holds. Assigned is always stated, because
 * an empty seat there is the fact "nobody has picked this up"; the other three appear only where
 * somebody holds them, so a sheet does not print three lines of "None".
 */
function peopleFields(task: MatterTask, context: TaskSheetContext) {
  return TASK_PARTICIPANT_ROLES.flatMap((role) => {
    const names = participantsInRole(task, role).map(context.nameOf);
    if (names.length === 0 && role !== "assigned") return [];
    return [
      {
        label: role === "assigned" ? "Assigned To" : ROLE_LABELS[role],
        value: names.length === 0 ? "Nobody yet" : names.join(", "),
      },
    ];
  });
}

/**
 * What became of the task, as the sheet states it.
 *
 * Finished and put away are separate facts and both can be true: a task is archived FROM wherever it
 * stood, so a done task that was then filed away carries both lines. A sheet that flattened them
 * into one "closed" would lose which of the two happened, and the reason the firm gave for the
 * second.
 */
function outcomeFields(task: MatterTask, context: TaskSheetContext) {
  return [
    ...(task.rung === "done" && task.completedAt !== null
      ? [
          { label: "Done By", value: context.completedByName ?? "Not recorded" },
          { label: "Done", value: context.instant(task.completedAt) },
        ]
      : []),
    ...(task.archivedAt === null
      ? []
      : [
          { label: "Archived By", value: context.archivedByName ?? "Not recorded" },
          { label: "Archived", value: context.instant(task.archivedAt) },
          // Only where there is one. Most archivings say nothing, and a line reading "Not recorded"
          // would put a gap on the paper where there is no gap.
          ...(task.archiveReason === null
            ? []
            : [{ label: "Archived Because", value: task.archiveReason }]),
        ]),
  ];
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
          { label: "State", value: RUNG_LABELS[task.rung] },
          ...peopleFields(task, context),
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
        : ([{ id: "description", kind: "text", title: "Description", text: task.body }] as const)),
      // The checklist, ticked lines marked as such: what has been done of the work is as much a
      // fact about the task as whether the task is done.
      ...(task.checklist.length === 0
        ? []
        : [
            {
              id: "checklist",
              kind: "fields" as const,
              title: "Checklist",
              fields: task.checklist.map((item, position) => ({
                label: `${String(position + 1)}. ${item.doneAt === null ? "Open" : "Done"}`,
                value: item.title,
              })),
            },
          ]),
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
