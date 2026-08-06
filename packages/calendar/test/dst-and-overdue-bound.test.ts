import { describe, expect, it } from "vitest";
import { selectMatterDeadlinesStatement } from "../src/deadline-statements.ts";
import { isOverdue, overdueCutoffFor } from "../src/overdue.ts";
import { endOfCivilDayInstant, instantForCivilDateTime, zonedReading } from "../src/time-zone.ts";
import { visibleMatterPredicate } from "../src/visibility.ts";
import { migratedDatabase } from "./support.ts";

// The two daylight-saving cases, and the SQL bound built on top of them. Both deserve their own named
// tests: the arithmetic used to resolve an unambiguous 02:14 PST to 01:14 PST — an hour before a time
// that exists perfectly well — and a wall clock in the spring gap to an hour BEFORE the time somebody
// wrote down, which is the opposite of what its own comment promised.

const LOS_ANGELES = "America/Los_Angeles";
// 2026: clocks spring forward at 02:00 PST on 8 March (10:00Z) and fall back at 02:00 PDT on
// 1 November (09:00Z).
const SPRING_FORWARD_INSTANT = Date.parse("2026-03-08T10:00:00.000Z");
const FALL_BACK_INSTANT = Date.parse("2026-11-01T09:00:00.000Z");

describe("a wall clock resolves to the instant it actually names", () => {
  it("resolves an ordinary time with no ambiguity to say anything about", () => {
    expect(instantForCivilDateTime("2026-06-15", "09:30", LOS_ANGELES)).toBe(
      Date.parse("2026-06-15T16:30:00.000Z"),
    );
  });

  it("resolves a repeated autumn hour to its FIRST occurrence", () => {
    // 01:30 happens twice on 1 November: at 08:30Z in PDT and again at 09:30Z in PST. The earlier is
    // the reading a deadline has to take — resolving to the second would quietly extend it an hour.
    const instant = instantForCivilDateTime("2026-11-01", "01:30", LOS_ANGELES);
    expect(instant).toBe(Date.parse("2026-11-01T08:30:00.000Z"));
    expect(instant).toBeLessThan(FALL_BACK_INSTANT);
    expect(zonedReading(instant, LOS_ANGELES).wallClockTime).toBe("01:30");
  });

  it("resolves an unambiguous time in the hour AFTER a fall-back to that hour", () => {
    // The regression this pair exists for. 02:14 on 1 November is not ambiguous — it happens once,
    // in PST — but both offsets are still in play near the transition, and taking the earlier
    // candidate landed it at 01:14 PST, an hour before the time on the docket.
    const instant = instantForCivilDateTime("2026-11-01", "02:14", LOS_ANGELES);
    expect(instant).toBe(Date.parse("2026-11-01T10:14:00.000Z"));
    expect(zonedReading(instant, LOS_ANGELES)).toEqual({
      civilDate: "2026-11-01",
      wallClockTime: "02:14",
    });
  });

  it("resolves a skipped spring wall clock FORWARD, never backward", () => {
    // 02:30 on 8 March never happens. It resolves to the later instant, so a docket entry typed into
    // the gap is never moved to before the time somebody wrote down.
    const instant = instantForCivilDateTime("2026-03-08", "02:30", LOS_ANGELES);
    expect(instant).toBeGreaterThan(SPRING_FORWARD_INSTANT);
    expect(instant).toBe(Date.parse("2026-03-08T10:30:00.000Z"));
    expect(zonedReading(instant, LOS_ANGELES).wallClockTime).toBe("03:30");
  });

  // A zone whose transition happens AT midnight is where the end-of-day arithmetic shows its work:
  // the next day begins at 01:00 local, so this day ends at 23:59:59.999 local rather than an hour
  // short of it.
  it("ends a civil day correctly in a zone that springs forward at midnight", () => {
    const santiago = "America/Santiago";
    const endOfTheFifth = endOfCivilDayInstant("2026-09-05", santiago);
    const startOfTheSixth = instantForCivilDateTime("2026-09-06", "00:00", santiago);
    expect(endOfTheFifth).toBe(startOfTheSixth - 1);
    const reading = zonedReading(endOfTheFifth, santiago);
    expect(reading.civilDate).toBe("2026-09-05");
    expect(reading.wallClockTime).toBe("23:59");
  });
});

// The bound the overdue list narrows by. It has to be the SAME answer `isOverdue` gives row by row,
// because the alternative that shipped — `due_on <= <today in UTC>` — reports a Nevada firm's live
// same-day deadlines as already missed for most of the working day, and eats the page doing it.
describe("the per-zone overdue cutoff is the row-by-row comparison, in SQL", () => {
  // Every combination worth checking, run against the cutoff AND against isOverdue, so a divergence
  // between the two is what fails rather than a restated expectation.
  const cases = [
    {
      name: "a same-day untimed deadline in Los Angeles at 11:00Z is not yet overdue",
      now: "2026-08-06T11:00:00.000Z",
      deadline: { dueOn: "2026-08-06", dueAtTime: null, timeZone: LOS_ANGELES },
    },
    {
      name: "the same deadline is overdue once its own day has ended",
      now: "2026-08-07T07:00:00.000Z",
      deadline: { dueOn: "2026-08-06", dueAtTime: null, timeZone: LOS_ANGELES },
    },
    {
      name: "a timed deadline is overdue only after its own hour passes",
      now: "2026-08-06T23:59:00.000Z",
      deadline: { dueOn: "2026-08-06", dueAtTime: "17:00", timeZone: LOS_ANGELES },
    },
    {
      name: "a far-eastern zone can be overdue on a date UTC has not reached",
      now: "2026-08-06T11:00:00.000Z",
      deadline: { dueOn: "2026-08-06", dueAtTime: "09:00", timeZone: "Pacific/Auckland" },
    },
    {
      name: "the morning after a spring-forward transition",
      now: "2026-03-08T18:00:00.000Z",
      deadline: { dueOn: "2026-03-08", dueAtTime: "09:00", timeZone: LOS_ANGELES },
    },
    {
      name: "inside the repeated hour on a fall-back day, before the deadline's own reading",
      now: "2026-11-01T08:15:00.000Z",
      deadline: { dueOn: "2026-11-01", dueAtTime: "01:30", timeZone: LOS_ANGELES },
    },
    {
      name: "inside the repeated hour on a fall-back day, after the deadline's own reading",
      now: "2026-11-01T09:15:00.000Z",
      deadline: { dueOn: "2026-11-01", dueAtTime: "01:30", timeZone: LOS_ANGELES },
    },
    {
      name: "an untimed deadline on a fall-back day is not overdue until that longer day ends",
      now: "2026-11-01T09:15:00.000Z",
      deadline: { dueOn: "2026-11-01", dueAtTime: null, timeZone: LOS_ANGELES },
    },
  ] as const;

  for (const testCase of cases) {
    it(`agrees with isOverdue: ${testCase.name}`, () => {
      const cutoff = overdueCutoffFor(testCase.deadline.timeZone, testCase.now);
      expect(cutoff).toBeDefined();
      // The SQL predicate, evaluated in TypeScript exactly as the two column comparisons compose it.
      const matchedByCutoff =
        testCase.deadline.dueAtTime === null
          ? testCase.deadline.dueOn < cutoff!.currentCivilDate
          : testCase.deadline.dueOn < cutoff!.timedCivilDate ||
            (testCase.deadline.dueOn === cutoff!.timedCivilDate &&
              testCase.deadline.dueAtTime <= cutoff!.timedWallClockTime);
      expect(matchedByCutoff).toBe(
        isOverdue({ ...testCase.deadline, state: "open" }, testCase.now),
      );
    });
  }

  it("returns nothing for a zone the runtime cannot resolve", () => {
    expect(overdueCutoffFor("Mars/Olympus_Mons", "2026-08-06T11:00:00.000Z")).toBeUndefined();
    expect(overdueCutoffFor(LOS_ANGELES, "not an instant")).toBeUndefined();
  });

  // Composed into the WHERE clause, never applied to the rows afterwards: a post-filter under-fills
  // the page, makes the next cursor mean something different from page to page, and turns the page
  // size into an existence oracle for the rows it removed.
  it("composes one clause per zone into the SQL, ahead of the LIMIT", () => {
    const { database } = migratedDatabase();
    const visibility = visibleMatterPredicate();
    const statement = selectMatterDeadlinesStatement(database, {
      overdueCutoffs: [
        overdueCutoffFor(LOS_ANGELES, "2026-08-06T11:00:00.000Z")!,
        overdueCutoffFor("Pacific/Auckland", "2026-08-06T11:00:00.000Z")!,
      ],
      limit: 51,
      visibilityFragment: visibility.fragmentFor("matter_deadline.matter_id"),
      visibilityBindings: visibility.bindings,
    }) as unknown as { sql: string; bindings: readonly unknown[] };

    expect(statement.sql).toContain("matter_deadline.state = 'open'");
    expect(statement.sql).toContain("matter_deadline.time_zone = ?");
    expect(statement.sql).toContain("matter_deadline.due_at_time IS NOT NULL");
    expect(statement.sql.indexOf("matter_deadline.time_zone")).toBeLessThan(
      statement.sql.lastIndexOf("LIMIT"),
    );
    expect(statement.bindings).toContain(LOS_ANGELES);
    expect(statement.bindings).toContain("Pacific/Auckland");
  });

  // No zone means nothing can match, said explicitly — an empty OR list would otherwise compose to
  // an empty parenthesis and a syntax error.
  it("narrows to nothing when there is no zone to narrow by", () => {
    const { database } = migratedDatabase();
    const visibility = visibleMatterPredicate();
    const statement = selectMatterDeadlinesStatement(database, {
      overdueCutoffs: [],
      limit: 51,
      visibilityFragment: visibility.fragmentFor("matter_deadline.matter_id"),
      visibilityBindings: visibility.bindings,
    }) as unknown as { sql: string };
    expect(statement.sql).toContain("1 = 0");
  });
});
