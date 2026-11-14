/*
 * THE TASK LIST'S COLUMNS, ITS BANDS AND ITS TREE.
 *
 * A row is a task plus where it sits in its tree: how deep, whose sub-task, and how many sub-tasks
 * it carries. The tree is kept by `orderTaskRows`, which sorts siblings among themselves and puts
 * every sub-task straight under its parent, so the reader's sort still means what it says on every
 * level without a sub-task drifting away from the task it belongs to. A band is chosen by the ROOT
 * task, for the same reason: a sub-task always sits in its parent's band.
 */
import type { GridColumn, GridGrouping } from "@magna-carta/design-system/data-table";
import { formatDate } from "@magna-carta/design-system/data-table";
import { addCalendarDays, type CivilDate } from "@magna-carta/civil-time/civil-date";
import {
  PRIORITY_LABELS,
  TASK_PRIORITIES,
  describeTimeLogged,
  type AssigneeInput,
  type MatterTask,
  type TaskListStatus,
  type TaskListSummary,
} from "./tasks-api.ts";

export interface TaskRow {
  task: MatterTask;
  /** 0 for a task on nobody's sub-task list; one more for each parent above it. */
  depth: number;
  /** The top of this row's tree, which decides its band. Its own id on a top-level task. */
  rootId: string;
  /** How many sub-tasks sit directly under it among the rows read. */
  childCount: number;
}

/** What the columns need to turn identifiers into words. */
export interface TaskColumnContext {
  showMatter: boolean;
  nameOf: (userId: string | null) => string;
  teamName: (teamId: string) => string;
  matterTitle: (matterId: string | null) => string;
  listOf: (listId: string | null) => TaskListSummary | undefined;
}

export function statusOf(
  task: MatterTask,
  list: TaskListSummary | undefined,
): TaskListStatus | undefined {
  return list?.statuses.find((status) => status.id === task.statusId);
}

/**
 * The statuses a task standing on `statusId` may move to under its list's flow. A task on no status
 * may go to any of them, because there is no step for the flow to start from.
 */
export function statusesReachableFrom(
  list: TaskListSummary | undefined,
  statusId: string | null,
): readonly string[] {
  if (list === undefined) return [];
  if (statusId === null) return list.statuses.map((status) => status.id);
  return list.statuses.find((status) => status.id === statusId)?.nextStatusIds ?? [];
}

/** Everyone the task is assigned to, as words, in the order they were named. */
export function assigneeNames(task: MatterTask, context: TaskColumnContext): string[] {
  return task.assignees.map((assignee) =>
    assignee.teamId === null ? context.nameOf(assignee.userId) : context.teamName(assignee.teamId),
  );
}

export function taskColumns(context: TaskColumnContext): GridColumn<TaskRow>[] {
  return [
    {
      id: "status",
      label: "Status",
      anchored: true,
      value: (row) => statusOf(row.task, context.listOf(row.task.listId))?.name ?? "",
    },
    {
      id: "title",
      label: "Task",
      anchored: true,
      filter: "text",
      value: (row) => row.task.title,
    },
    ...(context.showMatter
      ? [
          {
            id: "matter",
            label: "Matter",
            value: (row: TaskRow) => context.matterTitle(row.task.matterId),
          } satisfies GridColumn<TaskRow>,
        ]
      : []),
    {
      id: "assignees",
      label: "Assigned To",
      value: (row) => assigneeNames(row.task, context).join(", "),
    },
    {
      id: "startsOn",
      label: "Start",
      type: "date",
      value: (row) => row.task.startsOn,
      text: (row) => (row.task.startsOn === null ? "" : formatDate(row.task.startsOn)),
    },
    {
      id: "dueOn",
      label: "Due",
      type: "date",
      value: (row) => row.task.dueOn,
      text: (row) => (row.task.dueOn === null ? "" : formatDate(row.task.dueOn)),
    },
    {
      id: "priority",
      label: "Priority",
      type: "number",
      align: "start",
      filter: "none",
      // Ranked so that sorting puts Urgent first, not alphabetically.
      value: (row) => TASK_PRIORITIES.indexOf(row.task.priority),
      text: (row) => PRIORITY_LABELS[row.task.priority],
    },
    {
      id: "list",
      label: "List",
      hidden: true,
      value: (row) => context.listOf(row.task.listId)?.name ?? "",
    },
    {
      id: "timeLogged",
      label: "Time Logged",
      hidden: true,
      filter: "none",
      type: "number",
      align: "start",
      value: (row) => row.task.timeLogged.billableMinutes + row.task.timeLogged.nonBillableMinutes,
      text: (row) => describeTimeLogged(row.task.timeLogged) ?? "",
    },
  ];
}

/** The columns a reader may hide from the View menu: everything but the two that anchor a row. */
export function hideableColumns(columns: readonly GridColumn<TaskRow>[]): GridColumn<TaskRow>[] {
  return columns.filter((column) => column.anchored !== true);
}

/*
 * THE TREE. Rows arrive as top-level tasks and, separately, every sub-task under them. Each row is
 * given its depth and root, and a folded task's sub-tasks are left out.
 */
export function taskRows(tasks: readonly MatterTask[], folded: ReadonlySet<string>): TaskRow[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const childCounts = new Map<string, number>();
  for (const task of tasks) {
    if (task.parentTaskId !== null && byId.has(task.parentTaskId)) {
      childCounts.set(task.parentTaskId, (childCounts.get(task.parentTaskId) ?? 0) + 1);
    }
  }
  const rows: TaskRow[] = [];
  for (const task of tasks) {
    let depth = 0;
    let rootId = task.id;
    let hidden = false;
    let parentId = task.parentTaskId;
    // Bounded by the loaded rows, so a malformed chain cannot loop forever.
    for (let step = 0; parentId !== null && step < tasks.length; step += 1) {
      const parent = byId.get(parentId);
      if (parent === undefined) break;
      if (folded.has(parent.id)) hidden = true;
      depth += 1;
      rootId = parent.id;
      parentId = parent.parentTaskId;
    }
    if (hidden) continue;
    rows.push({ task, depth, rootId, childCount: childCounts.get(task.id) ?? 0 });
  }
  return rows;
}

/** Siblings sorted among themselves, and every sub-task straight under its parent. */
export function orderTaskRows(
  rows: readonly TaskRow[],
  compare: (left: TaskRow, right: TaskRow) => number,
): TaskRow[] {
  const present = new Set(rows.map((row) => row.task.id));
  const children = new Map<string | null, TaskRow[]>();
  for (const row of rows) {
    const parent =
      row.task.parentTaskId !== null && present.has(row.task.parentTaskId)
        ? row.task.parentTaskId
        : null;
    const siblings = children.get(parent);
    if (siblings === undefined) children.set(parent, [row]);
    else siblings.push(row);
  }
  const ordered: TaskRow[] = [];
  const visit = (parent: string | null): void => {
    const siblings = (children.get(parent) ?? []).toSorted(compare);
    for (const row of siblings) {
      ordered.push(row);
      visit(row.task.id);
    }
  };
  visit(null);
  return ordered;
}

export const GROUP_BY_OPTIONS = [
  { value: "list", label: "List" },
  { value: "status", label: "Status" },
  { value: "due", label: "Due" },
  { value: "assignee", label: "Assigned To" },
  { value: "matter", label: "Matter" },
  { value: "none", label: "Nothing" },
] as const;
export type TaskGroupBy = (typeof GROUP_BY_OPTIONS)[number]["value"];

const DUE_BANDS = ["earlier", "today", "week", "later", "none"] as const;
const DUE_BAND_LABELS: Record<(typeof DUE_BANDS)[number], string> = {
  earlier: "Before Today",
  today: "Today",
  week: "Next Seven Days",
  later: "Later",
  none: "No Due Date",
};

function dueBand(task: MatterTask, today: CivilDate): (typeof DUE_BANDS)[number] {
  if (task.dueOn === null) return "none";
  if (task.dueOn < today) return "earlier";
  if (task.dueOn === today) return "today";
  if (task.dueOn <= addCalendarDays(today, 7)) return "week";
  return "later";
}

/**
 * How the rows band, by the root task of each row. Every grouping keys by the root so a sub-task
 * never leaves its parent's band.
 */
export function taskGrouping(
  groupBy: TaskGroupBy,
  rows: readonly TaskRow[],
  context: TaskColumnContext,
  lists: readonly TaskListSummary[],
  today: CivilDate,
): GridGrouping<TaskRow> | null {
  if (groupBy === "none") return null;
  const byId = new Map(rows.map((row) => [row.task.id, row.task]));
  const rootOf = (row: TaskRow): MatterTask => byId.get(row.rootId) ?? row.task;
  switch (groupBy) {
    case "list":
      return {
        keyOf: (row) => rootOf(row).listId ?? "",
        labelOf: (key) => lists.find((list) => list.id === key)?.name ?? "No List",
        order: () => lists.map((list) => list.id),
      };
    case "status":
      return {
        keyOf: (row) => {
          const root = rootOf(row);
          return statusOf(root, context.listOf(root.listId))?.name ?? "No Status";
        },
      };
    case "due":
      return {
        keyOf: (row) => dueBand(rootOf(row), today),
        labelOf: (key) => DUE_BAND_LABELS[key as (typeof DUE_BANDS)[number]] ?? key,
        order: () => DUE_BANDS,
      };
    case "assignee":
      return {
        keyOf: (row) => assigneeNames(rootOf(row), context)[0] ?? "Nobody Yet",
      };
    case "matter":
      return {
        keyOf: (row) => context.matterTitle(rootOf(row).matterId),
      };
  }
}

/** What a task added at the foot of a band starts with, so that it lands in that band. */
export interface BandPresets {
  listId?: string;
  statusId?: string;
  dueOn?: string | null;
  assignees?: AssigneeInput[];
  matterId?: string | null;
}

/** The names the band keys were made from, turned back into the records they name. */
export interface BandLookup {
  lists: readonly TaskListSummary[];
  members: readonly { userId: string; displayName: string }[];
  teams: readonly { id: string; name: string }[];
  /** The matter a Matter band's title names: an id, null for the firm's own work, undefined unknown. */
  matterIdOf: (title: string) => string | null | undefined;
  today: CivilDate;
}

/**
 * THE INVERSE OF `taskGrouping`: what a new task needs so that it is drawn in the band it was
 * added in. A band whose key cannot be turned back into a record — a status name the default list
 * does not have, a name two members share, a past due date — presets nothing for that question,
 * and the task takes the window's defaults there rather than a guess.
 */
export function presetsForBand(
  groupBy: TaskGroupBy,
  key: string | null,
  lookup: BandLookup,
): BandPresets {
  if (key === null || groupBy === "none") return {};
  switch (groupBy) {
    case "list":
      return lookup.lists.some((list) => list.id === key) ? { listId: key } : {};
    case "status": {
      const list = lookup.lists.find((candidate) => candidate.isDefault) ?? lookup.lists[0];
      const status = list?.statuses.find((candidate) => candidate.name === key);
      return list === undefined || status === undefined
        ? {}
        : { listId: list.id, statusId: status.id };
    }
    case "due":
      if (key === "today") return { dueOn: lookup.today };
      if (key === "none") return { dueOn: null };
      return {};
    case "assignee": {
      if (key === "Nobody Yet") return { assignees: [] };
      const members = lookup.members.filter((member) => member.displayName === key);
      const teams = lookup.teams.filter((team) => team.name === key);
      if (members.length + teams.length !== 1) return {};
      const member = members[0];
      const team = teams[0];
      if (member !== undefined) return { assignees: [{ userId: member.userId }] };
      return team === undefined ? {} : { assignees: [{ teamId: team.id }] };
    }
    case "matter": {
      const matterId = lookup.matterIdOf(key);
      return matterId === undefined ? {} : { matterId };
    }
  }
}

/** The people and teams a task is assigned to, in a form the API takes back. */
export function assigneeInputs(task: MatterTask): ({ userId: string } | { teamId: string })[] {
  return task.assignees.map((assignee) =>
    assignee.teamId === null ? { userId: assignee.userId ?? "" } : { teamId: assignee.teamId },
  );
}
