import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CALENDAR_NOTIFICATION_EMISSION_POINTS } from "../src/notifications.ts";
import { MAX_CALENDAR_WINDOW_DAYS, MAX_DEADLINE_HORIZON_DAYS } from "../src/types.ts";
import {
  CalendarValidationError,
  assertCalendarWindow,
  assertDeadlineHorizon,
  inclusiveDayCount,
} from "../src/validation.ts";

describe("the firm-calendar window is capped as a refusal, never a silent clamp", () => {
  it("accepts a window exactly at the cap", () => {
    // 2026-08-06 through 2027-08-06 inclusive is 366 days.
    expect(inclusiveDayCount("2026-08-06", "2027-08-06")).toBe(MAX_CALENDAR_WINDOW_DAYS);
    expect(() => assertCalendarWindow("2026-08-06", "2027-08-06")).not.toThrow();
  });

  it("refuses the day past it, naming the figure and what to do instead", () => {
    let caught: unknown;
    try {
      assertCalendarWindow("2026-08-06", "2027-08-07");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CalendarValidationError);
    expect((caught as CalendarValidationError).code).toBe("calendar-window-too-wide");
    expect((caught as Error).message).toContain("367");
    // A refusal rather than a clamp: a caller that asked for three years and silently received one
    // cannot tell that from a firm with nothing recorded in years two and three.
    expect((caught as Error).message).toContain("narrower window");
  });

  it("caps the deadline horizon the same way", () => {
    expect(() => assertDeadlineHorizon("2026-08-06", "2027-08-06")).not.toThrow();
    expect(() => assertDeadlineHorizon("2026-08-06", "2028-08-06")).toThrow(/narrower horizon/);
    expect(MAX_DEADLINE_HORIZON_DAYS).toBe(366);
  });

  it("refuses a window whose end falls before its start", () => {
    expect(() => assertCalendarWindow("2026-09-01", "2026-08-01")).toThrow(
      /end falls before its start/,
    );
  });
});

// The position, held by a source scan rather than by a review comment: nothing in this package
// derives a due date. A verified, jurisdiction-keyed rule catalog is what would, and none exists —
// so the only date arithmetic here is resolving a recorded civil date and time into an instant, in
// the one module that exists to do it.
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

describe("no code path computes a deadline date", () => {
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

  it("keeps every zone and calendar computation in the one module that exists for it", () => {
    // Intl date projection is how a recorded wall-clock time becomes an instant. It lives in
    // @magna-carta/civil-time/time-zone, which this package imports; anywhere here it would be the
    // beginning of a second, disagreeing definition of when something is due.
    //
    // There is no exemption list any more. There were two — the module itself and validation.ts —
    // and both went when the arithmetic moved to the leaf package every subsystem can reach. The
    // exemptions were the reason three other packages wrote their own weaker copy of it.
    const offenders = sourceFiles(SOURCE_DIRECTORY).filter((file) =>
      withoutComments(readFileSync(file, "utf8")).includes("Intl.DateTimeFormat"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the notification emission points are declared and nothing is wired", () => {
  it("exports a frozen constant naming the eleven points", () => {
    expect(Object.isFrozen(CALENDAR_NOTIFICATION_EMISSION_POINTS)).toBe(true);
    expect([...CALENDAR_NOTIFICATION_EMISSION_POINTS]).toEqual([
      "calendar.deadline.horizon",
      "calendar.deadline.due",
      "calendar.deadline.overdue",
      "calendar.event.scheduled",
      // A continuance raises THIS point — the vacate-and-reset is the reschedule it was named for;
      // no new constant exists for it.
      "calendar.event.rescheduled",
      "calendar.event.cancelled",
      // Raised by the route that records an event with a medium on it, not by a service here: the
      // row it announces is a meeting, and this package does not know meetings exist.
      "calendar.event.meetingScheduled",
      "calendar.firmEvent.scheduled",
      "calendar.firmEvent.rescheduled",
      "calendar.firmEvent.cancelled",
      "calendar.booking.conflict",
    ]);
  });

  it("has no scheduler, queue, or delivery anywhere in the package", () => {
    for (const file of sourceFiles(SOURCE_DIRECTORY)) {
      const code = withoutComments(readFileSync(file, "utf8"));
      for (const forbidden of [
        "setInterval",
        "setTimeout",
        "scheduled(",
        "cron",
        "sendNotification",
      ]) {
        expect(code, `${file} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
