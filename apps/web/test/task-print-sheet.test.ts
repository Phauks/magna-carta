import { describe, expect, it } from "vitest";
import { dueLine, taskSheet } from "$lib/matters/task-print-sheet.ts";
import type { MatterTask } from "$lib/matters/tasks-api.ts";

// The task's printed sheet, which is pure and carries two rules worth pinning. A due date printed
// without its zone is a different moment to every reader who picks the sheet up. And done and
// cancelled are not one "closed" state: a sheet that flattened them would lose the reason the firm
// gave for not doing the work, which is the only thing worth printing about a cancellation.

function task(over: Partial<MatterTask> = {}): MatterTask {
  return {
    id: "task_aaaaaaaaaaaaaaaaaaaaa",
    matterId: "matter_aaaaaaaaaaaaaaaaaaaaa",
    title: "Draft the responses to the first set of interrogatories",
    body: null,
    assigneeUserId: null,
    createdBy: "user_aaaaaaaaaaaaaaaaaaaaa",
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
    listId: null,
    statusId: null,
    parentTaskId: null,
    startsOn: null,
    location: null,
    assignees: [],
    watcherUserIds: [],
    checklist: [],
    links: [],
    timeLogged: { billableMinutes: 0, nonBillableMinutes: 0, entryCount: 0, scope: "firm" },
    externalLinks: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: null,
    ...over,
  };
}

const CONTEXT = {
  matterTitle: "Kowalski v. Reno Transit",
  assigneeName: "Dana Whitfield",
  authorName: "Trevor Goldsmith",
  completedByName: null,
  archivedByName: null,
  instant: (at: string) => `instant:${at}`,
  // The two date questions a sheet asks, kept apart: a civil day the firm wrote down, and the day a
  // recorded moment fell on. Fixed here rather than taken from printSheetDates(), so the assertions
  // do not move with the machine's locale or zone.
  date: (civilDate: string) => `date:${civilDate}`,
  instantDate: (at: string) => `instantDate:${at}`,
  attachedNames: [],
  printedAt: "instant:printed",
};

/** The labels of the sheet's standing fields, in the order they reach the paper. */
function standingLabels(sheet: ReturnType<typeof taskSheet>): string[] {
  const section = sheet.sections.find((candidate) => candidate.id === "standing");
  return section?.kind === "fields" ? section.fields.map((field) => field.label) : [];
}

function valueOf(sheet: ReturnType<typeof taskSheet>, label: string): string | undefined {
  const section = sheet.sections.find((candidate) => candidate.id === "standing");
  if (section?.kind !== "fields") return undefined;
  return section.fields.find((field) => field.label === label)?.value;
}

describe("dueLine", () => {
  it("is null where nobody has scheduled the task", () => {
    expect(dueLine(task(), (isoDate) => isoDate)).toBeNull();
  });

  it("is the date alone where there is no time on it", () => {
    expect(dueLine(task({ dueOn: "2026-09-18" }), (isoDate) => `date:${isoDate}`)).toBe(
      "date:2026-09-18",
    );
  });

  it("carries the zone with a wall-clock time, because the two are one fact", () => {
    const line = dueLine(
      task({ dueOn: "2026-09-18", dueAtTime: "14:30", timeZone: "America/Los_Angeles" }),
      (isoDate) => `date:${isoDate}`,
    );
    expect(line).toBe("date:2026-09-18, 14:30 (America/Los_Angeles)");
  });
});

describe("taskSheet", () => {
  it("states that an unscheduled task is not scheduled rather than leaving the field out", () => {
    expect(valueOf(taskSheet(task(), CONTEXT), "Due")).toBe("Not scheduled");
  });

  it("says who finished a done task and when", () => {
    const sheet = taskSheet(task({ rung: "done", completedAt: "2026-09-02T17:00:00.000Z" }), {
      ...CONTEXT,
      completedByName: "Dana Whitfield",
    });
    expect(valueOf(sheet, "Completed By")).toBe("Dana Whitfield");
    expect(valueOf(sheet, "Completed")).toBe("instant:2026-09-02T17:00:00.000Z");
    expect(standingLabels(sheet)).not.toContain("Archived By");
  });

  it("prints the reason an archived task carries, where it carries one", () => {
    const sheet = taskSheet(
      task({
        archivedAt: "2026-09-02T17:00:00.000Z",
        archiveReason: "The client settled the claim this covered.",
      }),
      { ...CONTEXT, archivedByName: "Dana Whitfield" },
    );
    expect(valueOf(sheet, "Archived By")).toBe("Dana Whitfield");
    expect(valueOf(sheet, "Archived Because")).toBe("The client settled the claim this covered.");
    expect(standingLabels(sheet)).not.toContain("Completed By");
  });

  it("says nothing about why on an archiving that gave no reason", () => {
    const sheet = taskSheet(task({ archivedAt: "2026-09-02T17:00:00.000Z" }), {
      ...CONTEXT,
      archivedByName: "Dana Whitfield",
    });
    expect(standingLabels(sheet)).toContain("Archived");
    expect(standingLabels(sheet)).not.toContain("Archived Because");
  });

  it("carries BOTH lines for a done task that was then put away", () => {
    // Archiving is orthogonal to the rung: a task is archived FROM wherever it stood, so a sheet
    // that printed one outcome would have to pick, and picking loses the other.
    const sheet = taskSheet(
      task({
        rung: "done",
        completedAt: "2026-09-01T17:00:00.000Z",
        archivedAt: "2026-09-02T17:00:00.000Z",
      }),
      { ...CONTEXT, completedByName: "Dana Whitfield", archivedByName: "Trevor Goldsmith" },
    );
    expect(valueOf(sheet, "Completed By")).toBe("Dana Whitfield");
    expect(valueOf(sheet, "Archived By")).toBe("Trevor Goldsmith");
  });

  it("leaves the time logged out entirely where nobody recorded any", () => {
    expect(standingLabels(taskSheet(task(), CONTEXT))).not.toContain("Time Logged");
    const withTime = taskSheet(
      task({
        timeLogged: { billableMinutes: 90, nonBillableMinutes: 0, entryCount: 2, scope: "firm" },
      }),
      CONTEXT,
    );
    expect(valueOf(withTime, "Time Logged")).toBe("1h 30m");
  });

  it("carries no detail section for a task with no detail on it", () => {
    expect(taskSheet(task(), CONTEXT).sections.map((section) => section.id)).toEqual([
      "standing",
      "documents",
    ]);
    expect(
      taskSheet(task({ body: "Cover both sets." }), CONTEXT).sections.map((section) => section.id),
    ).toEqual(["standing", "detail", "documents"]);
  });

  it("says None rather than an empty list where the task points at nothing", () => {
    const documents = taskSheet(task(), CONTEXT).sections.find(
      (section) => section.id === "documents",
    );
    expect(documents?.kind === "fields" ? documents.fields : []).toEqual([
      { label: "Attached", value: "None" },
    ]);
  });
});
