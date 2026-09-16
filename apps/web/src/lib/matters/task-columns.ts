/*
 * The tasks table's declarative column model — what the one table (DataTable.Grid) is told about a
 * list of tasks. Pure: it takes the lookups the rows need and returns columns. The list owns
 * fetching and rendering; this module owns what a column IS, so the answer is unit-testable and
 * there is one place to change it.
 *
 * A LIST OFFERS MORE COLUMNS THAN IT SHOWS. Every fact a task row can answer is a column here, and
 * the few a reader most often wants start visible: the title, where it stands, when it is due,
 * who it is with, and the matter where the list spans several. Everything else — who created it,
 * when, the checklist's progress, the time logged, the reviewers and watchers, what became of it —
 * starts hidden and is turned on from the header menu's Columns submenu, so "why is this not a
 * column" has one answer: it is, right-click a heading.
 *
 * EVERY VOCABULARY COLUMN OFFERS THE WHOLE VOCABULARY. The rung and the priority are the
 * platform's closed words, and the people columns are the firm's roster, so each hands the grid
 * that declaration and every value is offered whether or not a row on screen carries it. A filter
 * that dropped "On Hold" on a day nothing was on hold would tell the reader the firm cannot hold
 * such a thing.
 *
 * THE DESCRIPTION IS NOT A COLUMN. It is the row's second line, through the grid's own `rowDetail`,
 * on the standing ruling that prose is never a column: as one it is either cut to a few words or
 * wide enough to push the facts off the screen.
 */
import type { GridColumn, GridSortDirection } from "@magna-carta/design-system/data-table";
import {
  PRIORITY_LABELS,
  ROLE_LABELS,
  RUNG_LABELS,
  TASK_PRIORITIES,
  TASK_RUNGS,
  checklistProgress,
  describeTimeLogged,
  participantsInRole,
  type MatterTask,
  type TaskParticipantRole,
} from "./tasks-api.ts";

/** How an account identifier reads as a person, and which names the roster offers whole. */
export interface TaskColumnLookups {
  readonly nameOf: (userId: string | null) => string;
  /** Every member's display name, in reading order — what the people columns' set filters offer. */
  readonly memberNames: readonly string[];
}

/** What is different between the two screens the one list serves. */
export interface TaskColumnOptions {
  /** The firm-wide list names each task's matter; a matter's own section has no need to. */
  readonly showMatter: boolean;
}

/** The names of everybody on a task in one role, as one cell reads them. */
export function peopleText(
  task: MatterTask,
  role: TaskParticipantRole,
  nameOf: (userId: string | null) => string,
): string {
  return participantsInRole(task, role).map(nameOf).join(", ");
}

/** "2 of 5" — the checklist's progress as a cell reads it, or "" where there is no checklist. */
export function checklistText(task: MatterTask): string {
  const progress = checklistProgress(task);
  return progress === null ? "" : `${String(progress.done)} of ${String(progress.total)}`;
}

/** The label a task's matter reads by: its number where it has one, else its title. */
export function matterText(task: MatterTask): string {
  if (task.matterId === null) return "The firm's own work";
  return task.matterNumber ?? task.matterTitle ?? "";
}

/**
 * The sort the list opens on: due date ascending. The grid puts an empty value LAST in either
 * direction, so the undated tasks sit under the dated ones exactly as the server orders them — a
 * task does not move between the two screens, and it does not move when the table takes over the
 * ordering either.
 */
export const TASK_INITIAL_SORT: { columnId: string; direction: GridSortDirection } = {
  columnId: "dueOn",
  direction: "ascending",
};

function peopleColumn(
  role: TaskParticipantRole,
  lookups: TaskColumnLookups,
  hidden: boolean,
): GridColumn<MatterTask> {
  return {
    id: role,
    label: ROLE_LABELS[role],
    filter: "set",
    hidden,
    // The FIRST person in the role is the sort key and the cell text names them all. A set
    // filter over a multi-valued cell would need the grid to split it, which it does not; sorting
    // and filtering on the first name is what a reader scanning "whose is this" actually wants.
    value: (task) => {
      const first = participantsInRole(task, role)[0];
      return first === undefined ? null : lookups.nameOf(first) || null;
    },
    text: (task) => peopleText(task, role, lookups.nameOf),
    filterValues: lookups.memberNames,
  };
}

export function taskColumns(
  lookups: TaskColumnLookups,
  options: TaskColumnOptions,
): GridColumn<MatterTask>[] {
  return [
    // The title anchors the row: it is what a task IS, it always leads, and it is never hidden.
    { id: "title", label: "Title", anchored: true, value: (task) => task.title },
    {
      id: "matter",
      label: "Matter",
      filter: "set",
      hidden: !options.showMatter,
      value: matterText,
    },
    {
      id: "rung",
      label: "Status",
      filter: "set",
      value: (task) => RUNG_LABELS[task.rung],
      // Every rung, in the order a task moves along them, whether or not one is on screen.
      filterValues: TASK_RUNGS.map((rung) => RUNG_LABELS[rung]),
    },
    {
      id: "dueOn",
      label: "Due",
      type: "date",
      value: (task) => task.dueOn,
    },
    {
      id: "priority",
      label: "Priority",
      filter: "set",
      value: (task) => PRIORITY_LABELS[task.priority],
      filterValues: TASK_PRIORITIES.map((priority) => PRIORITY_LABELS[priority]),
    },
    peopleColumn("responsible", lookups, false),
    peopleColumn("assigned", lookups, false),
    peopleColumn("reviewer", lookups, true),
    peopleColumn("watcher", lookups, true),
    {
      id: "checklist",
      label: "Checklist",
      hidden: true,
      filter: "none",
      // Sorted by how much is left, so a reader can find the nearly-finished ones.
      value: (task) => {
        const progress = checklistProgress(task);
        return progress === null ? null : progress.total - progress.done;
      },
      text: checklistText,
      align: "start",
    },
    {
      id: "documents",
      label: "Attachments",
      type: "number",
      hidden: true,
      value: (task) => (task.documents.length === 0 ? null : task.documents.length),
    },
    {
      id: "timeLogged",
      label: "Time Logged",
      hidden: true,
      filter: "none",
      value: (task) => {
        const minutes = task.timeLogged.billableMinutes + task.timeLogged.nonBillableMinutes;
        return minutes === 0 ? null : minutes;
      },
      text: (task) => describeTimeLogged(task.timeLogged) ?? "",
      align: "start",
    },
    {
      id: "createdBy",
      label: "Created By",
      filter: "set",
      hidden: true,
      value: (task) => lookups.nameOf(task.createdBy),
      filterValues: lookups.memberNames,
    },
    {
      id: "createdAt",
      label: "Created",
      type: "date",
      hidden: true,
      value: (task) => task.createdAt,
    },
    {
      id: "completedAt",
      label: "Done On",
      type: "date",
      hidden: true,
      value: (task) => task.completedAt,
    },
    {
      id: "archivedAt",
      label: "Archived On",
      type: "date",
      hidden: true,
      value: (task) => task.archivedAt,
    },
  ];
}

/** What is holding tasks back from the view, and what to call it. */
export interface TaskNarrowing {
  /** The settled search text, not what is mid-keystroke. */
  readonly search: string;
  /** How many of the table's own columns are filtered. */
  readonly columnFilterCount: number;
}

export function tasksAreNarrowed(narrowing: TaskNarrowing): boolean {
  return narrowing.search.trim() !== "" || narrowing.columnFilterCount > 0;
}

/**
 * What the clear control says about itself. It states what is in play rather than how to undo it:
 * the control is the way to undo it. Showing done or archived work is deliberately NOT here — that
 * WIDENS the list and is undone by its own switch, and a clear control that appeared because more
 * was on screen would answer the wrong question.
 */
export function taskNarrowingSummary(narrowing: TaskNarrowing): string {
  const parts: string[] = [];
  if (narrowing.search.trim() !== "") parts.push(`searching "${narrowing.search.trim()}"`);
  if (narrowing.columnFilterCount > 0) {
    parts.push(
      narrowing.columnFilterCount === 1
        ? "1 column filtered"
        : `${String(narrowing.columnFilterCount)} columns filtered`,
    );
  }
  return parts.length === 0 ? "Every task" : parts.join(" · ");
}
