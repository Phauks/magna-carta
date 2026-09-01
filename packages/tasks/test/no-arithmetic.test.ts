import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { endOfCivilDayInstant, instantForCivilDateTime } from "@magna-carta/calendar/time-zone";
import { TASK_NOTIFICATION_EMISSION_POINTS, TASK_OUTBOX_TOPICS } from "../src/notifications.ts";
import { normalizeTaskDue } from "../src/validation.ts";
import { migratedDatabase } from "./support.ts";

// The position, held by a source scan rather than by a review comment: nothing in this package
// derives a due date from another date. This is the calendar's own scan, applied to the package most
// likely to want the machinery — a task template with a "+14 days" offset is the docketing engine
// this platform has spent a subsystem refusing to build, wearing a different hat.
const SOURCE_DIRECTORY = join(import.meta.dirname, "..", "src");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");
}

describe("no code path computes a due date", () => {
  it("carries no business-day, holiday, or service-offset machinery anywhere", () => {
    for (const file of sourceFiles(SOURCE_DIRECTORY)) {
      const code = withoutComments(readFileSync(file, "utf8"));
      for (const forbidden of [
        "businessDay",
        "businessDays",
        "workingDay",
        "holiday",
        "addDays",
        "addBusinessDays",
        "serviceOffset",
        "mailingDays",
        "recompute",
        "cascade",
      ]) {
        expect(code, `${file} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("resolves an instant through the calendar's module and reimplements none of it", () => {
    // Intl date projection is how a recorded wall-clock time becomes an instant, and it lives in
    // packages/calendar/src/time-zone.ts. Anywhere here it would be the beginning of a second,
    // disagreeing definition of when a thing is due — and the deadline surface and the task surface
    // disagreeing about "Friday" is exactly the failure the one-module rule prevents.
    const offenders = sourceFiles(SOURCE_DIRECTORY).filter((file) =>
      withoutComments(readFileSync(file, "utf8")).includes("Intl.DateTimeFormat"),
    );
    // validation.ts uses the constructor to ASK whether a zone resolves, which is a validity check
    // and not a projection. It is the one file allowed to name it.
    expect(offenders.map((file) => file.split("/").at(-1))).toEqual(["validation.ts"]);
  });
});

describe("overdue is nowhere in the schema", () => {
  it("has no overdue column on any task table", () => {
    const { raw } = migratedDatabase();
    for (const table of ["matter_task", "matter_task_document"]) {
      const columns = raw.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
        name: string;
      }[];
      const names = columns.map((column) => column.name);
      expect(names.length, `${table} has no columns`).toBeGreaterThan(0);
      for (const name of names) {
        // A stored flag would need a nightly per-firm sweep over the most numerous table in the
        // product, to maintain a fact that is a subtraction and that is stale in exactly the window
        // where it matters.
        expect(name.toLowerCase(), `${table}.${name}`).not.toContain("overdue");
        expect(name.toLowerCase(), `${table}.${name}`).not.toContain("is_late");
      }
    }
  });
});

describe("a due date is a civil date read in a zone, never an instant", () => {
  it("refuses a date with no zone, in both directions", () => {
    // A task due "Friday" falls at two different moments in Reno and Boston.
    expect(() => normalizeTaskDue({ dueOn: "2026-11-01" })).toThrow(/zone/);
    expect(() => normalizeTaskDue({ timeZone: "America/Los_Angeles" })).toThrow(/says nothing/);
  });

  it("refuses an hour with no day", () => {
    expect(() => normalizeTaskDue({ dueAtTime: "09:00" })).toThrow(/moment anybody can place/);
  });

  it("refuses a date that is not on the calendar", () => {
    expect(() =>
      normalizeTaskDue({ dueOn: "2026-02-30", timeZone: "America/Los_Angeles" }),
    ).toThrow(/not a date on the calendar/);
  });

  it("refuses a zone no runtime can resolve", () => {
    expect(() => normalizeTaskDue({ dueOn: "2026-11-01", timeZone: "Mars/Olympus" })).toThrow(
      /is not a time zone this platform can resolve/,
    );
  });

  it("does not move a task due on the day the clocks change", () => {
    // 2026-11-01 is the US daylight-saving fall-back. A task due that day, with no time, is due at
    // the END of that civil day in its own zone — which is the whole reason the column is a civil
    // date rather than midnight-local-stored-as-UTC.
    const due = normalizeTaskDue({ dueOn: "2026-11-01", timeZone: "America/Los_Angeles" });
    const endOfDay = endOfCivilDayInstant(due.dueOn ?? "", due.timeZone ?? "");
    // Still the 1st in its own zone, not the 2nd — and after the whole working day, so a dateless
    // task is not reported as already missed at one minute past midnight.
    const reading = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(endOfDay));
    expect(reading).toBe("2026-11-01");
  });

  it("resolves a task with a time through the same function a deadline uses", () => {
    const due = normalizeTaskDue({
      dueOn: "2026-11-01",
      dueAtTime: "09:00",
      timeZone: "America/Los_Angeles",
    });
    const instant = instantForCivilDateTime(
      due.dueOn ?? "",
      due.dueAtTime ?? "",
      due.timeZone ?? "",
    );
    // 09:00 Pacific on the day the clocks go back is 17:00 UTC (standard time is UTC-8). The
    // resolver answers an epoch instant rather than a string, which is what keeps a comparison a
    // subtraction rather than a text compare.
    expect(instant).toBe(Date.parse("2026-11-01T17:00:00.000Z"));
  });
});

describe("the notification emission points", () => {
  it("declares the two comparison-shaped points and wires neither", () => {
    expect(Object.isFrozen(TASK_NOTIFICATION_EMISSION_POINTS)).toBe(true);
    expect([...TASK_NOTIFICATION_EMISSION_POINTS]).toEqual([
      "tasks.task.assigned",
      "tasks.task.reassigned",
      "tasks.firmTask.assigned",
      "tasks.firmTask.reassigned",
      // Declared, and wired to nothing. No write makes a task become due, so there is no batch to
      // ride; the comparison sub-slice that sweeps deadlines will sweep tasks through the same
      // mechanism against the same definition of overdue.
      "tasks.task.dueSoon",
      "tasks.task.overdue",
    ]);
    expect([...TASK_OUTBOX_TOPICS]).not.toContain("tasks.task.overdue");
    expect([...TASK_OUTBOX_TOPICS]).not.toContain("tasks.task.dueSoon");
  });

  it("has no scheduler, queue, or delivery anywhere in the package", () => {
    for (const file of sourceFiles(SOURCE_DIRECTORY)) {
      const code = withoutComments(readFileSync(file, "utf8"));
      for (const forbidden of ["setTimeout", "setInterval", "cron", "queue.send", "fetch("]) {
        expect(code, `${file} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
