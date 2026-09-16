import { describe, expect, it } from "vitest";
import { gridCellText, sortGridRows } from "@magna-carta/design-system/data-table";
import {
  checklistText,
  matterText,
  peopleText,
  taskColumns,
  taskNarrowingSummary,
  tasksAreNarrowed,
} from "$lib/matters/task-columns.ts";
import type { MatterTask } from "$lib/matters/tasks-api.ts";

// The tasks table's column model: what a cell reads, what a filter offers, and what the opening
// sort does with a task nobody has scheduled.

const NAMES: Record<string, string> = {
  user_aaaaaaaaaaaaaaaaaaaaa: "Dana Whitfield",
  user_bbbbbbbbbbbbbbbbbbbbb: "Trevor Goldsmith",
};
const lookups = {
  nameOf: (userId: string | null) => (userId === null ? "Unassigned" : (NAMES[userId] ?? "")),
  memberNames: ["Dana Whitfield", "Trevor Goldsmith"],
};

function task(over: Partial<MatterTask> = {}): MatterTask {
  return {
    id: "matterTask_aaaaaaaaaaaaaaaaaaaaa",
    matterId: "matter_aaaaaaaaaaaaaaaaaaaaa",
    matterTitle: "Kowalski v. Reno Transit",
    matterNumber: "2026-00042",
    title: "Draft the responses",
    body: null,
    participants: [],
    checklist: [],
    createdBy: "user_bbbbbbbbbbbbbbbbbbbbb",
    priority: "normal",
    dueOn: null,
    dueAtTime: null,
    timeZone: null,
    rung: "to_do",
    completedAt: null,
    completedBy: null,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    blockedByTaskId: null,
    triggerEventId: null,
    deadlineId: null,
    documents: [],
    timeLogged: { billableMinutes: 0, nonBillableMinutes: 0, entryCount: 0, scope: "firm" },
    externalLinks: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: null,
    ...over,
  };
}

function participant(userId: string, role: MatterTask["participants"][number]["role"]) {
  return { id: `matterTaskParticipant_${userId}`, userId, role, addedBy: null, addedAt: "" };
}

describe("the task columns", () => {
  it("leads with the title, anchored, and hides the matter on a matter's own section", () => {
    const onMatter = taskColumns(lookups, { showMatter: false });
    expect(onMatter[0]?.id).toBe("title");
    expect(onMatter[0]?.anchored).toBe(true);
    expect(onMatter.find((column) => column.id === "matter")?.hidden).toBe(true);
    const firmWide = taskColumns(lookups, { showMatter: true });
    expect(firmWide.find((column) => column.id === "matter")?.hidden).toBe(false);
  });

  it("offers every rung and every priority to the filter, whether or not a row carries one", () => {
    const columns = taskColumns(lookups, { showMatter: true });
    expect(columns.find((column) => column.id === "rung")?.filterValues).toEqual([
      "To Do",
      "In Progress",
      "On Hold",
      "Done",
    ]);
    expect(columns.find((column) => column.id === "priority")?.filterValues).toEqual([
      "Urgent",
      "High",
      "Normal",
      "Low",
    ]);
    expect(columns.find((column) => column.id === "assigned")?.filterValues).toEqual(
      lookups.memberNames,
    );
  });

  it("names everybody in a role in one cell, and sorts on the first of them", () => {
    const row = task({
      participants: [
        participant("user_bbbbbbbbbbbbbbbbbbbbb", "assigned"),
        participant("user_aaaaaaaaaaaaaaaaaaaaa", "assigned"),
        participant("user_aaaaaaaaaaaaaaaaaaaaa", "watcher"),
      ],
    });
    expect(peopleText(row, "assigned", lookups.nameOf)).toBe("Trevor Goldsmith, Dana Whitfield");
    const assigned = taskColumns(lookups, { showMatter: true }).find(
      (column) => column.id === "assigned",
    );
    expect(assigned?.value(row)).toBe("Trevor Goldsmith");
    // Nobody in the role is an empty cell, never the word "Unassigned" sorted as a name.
    expect(assigned?.value(task())).toBeNull();
  });

  it("reads the checklist as progress and the matter by its number, or by its title, or as firm work", () => {
    expect(checklistText(task())).toBe("");
    expect(
      checklistText(
        task({
          checklist: [
            {
              id: "a",
              title: "One",
              position: 0,
              doneAt: "x",
              doneBy: "u",
              createdBy: "u",
              createdAt: "",
            },
            {
              id: "b",
              title: "Two",
              position: 1,
              doneAt: null,
              doneBy: null,
              createdBy: "u",
              createdAt: "",
            },
          ],
        }),
      ),
    ).toBe("1 of 2");
    expect(matterText(task())).toBe("2026-00042");
    expect(matterText(task({ matterNumber: null }))).toBe("Kowalski v. Reno Transit");
    expect(matterText(task({ matterId: null, matterTitle: null, matterNumber: null }))).toBe(
      "The firm's own work",
    );
  });

  it("sorts by due date with the undated last, the same order the server keeps", () => {
    const columns = taskColumns(lookups, { showMatter: true });
    const dueOn = columns.find((column) => column.id === "dueOn");
    if (dueOn === undefined) throw new Error("no due column");
    const rows = [
      task({ id: "undated", title: "Undated" }),
      task({ id: "later", title: "Later", dueOn: "2026-12-01", timeZone: "UTC" }),
      task({ id: "sooner", title: "Sooner", dueOn: "2026-09-15", timeZone: "UTC" }),
    ];
    expect(sortGridRows(rows, dueOn, "ascending", (row) => row.id).map((row) => row.title)).toEqual(
      ["Sooner", "Later", "Undated"],
    );
    expect(
      sortGridRows(rows, dueOn, "descending", (row) => row.id).map((row) => row.title),
    ).toEqual(["Later", "Sooner", "Undated"]);
    expect(gridCellText(dueOn, rows[0] as MatterTask)).toBe("");
  });

  it("says what narrows the list, and never counts showing more as narrowing", () => {
    expect(tasksAreNarrowed({ search: "", columnFilterCount: 0 })).toBe(false);
    expect(taskNarrowingSummary({ search: "", columnFilterCount: 0 })).toBe("Every task");
    expect(taskNarrowingSummary({ search: "Herrera", columnFilterCount: 2 })).toBe(
      'searching "Herrera" · 2 columns filtered',
    );
  });
});
