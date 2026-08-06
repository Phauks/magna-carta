import { describe, expect, it } from "vitest";
import { createMatterDeadline, satisfyMatterDeadline } from "../src/deadline-service.ts";
import { dueInstantMilliseconds, isOverdue } from "../src/overdue.ts";
import { ACTOR, MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

// Overdue is a comparison made where the reader is, never a column and never a sweep.

describe("the due instant resolves in the deadline's own zone", () => {
  it("reads a wall-clock time in the court's zone, not the server's", () => {
    // Five in the afternoon Pacific on a summer date is midnight UTC the following day.
    const instant = dueInstantMilliseconds({
      dueOn: "2026-09-07",
      dueAtTime: "17:00",
      timeZone: "America/Los_Angeles",
      state: "open",
    });
    expect(new Date(instant).toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });

  it("holds across a daylight-saving boundary in both directions", () => {
    // Spring forward: 2 March in New Zealand and 8 March in Los Angeles bracket two different
    // transitions, and each side of a transition carries its own offset.
    const beforeSpringForward = dueInstantMilliseconds({
      dueOn: "2026-03-07",
      dueAtTime: "12:00",
      timeZone: "America/Los_Angeles",
      state: "open",
    });
    const afterSpringForward = dueInstantMilliseconds({
      dueOn: "2026-03-09",
      dueAtTime: "12:00",
      timeZone: "America/Los_Angeles",
      state: "open",
    });
    expect(new Date(beforeSpringForward).toISOString()).toBe("2026-03-07T20:00:00.000Z");
    expect(new Date(afterSpringForward).toISOString()).toBe("2026-03-09T19:00:00.000Z");

    // Fall back: the same wall-clock noon is an hour later in absolute terms after the change.
    const beforeFallBack = dueInstantMilliseconds({
      dueOn: "2026-10-31",
      dueAtTime: "12:00",
      timeZone: "America/Los_Angeles",
      state: "open",
    });
    const afterFallBack = dueInstantMilliseconds({
      dueOn: "2026-11-02",
      dueAtTime: "12:00",
      timeZone: "America/Los_Angeles",
      state: "open",
    });
    expect(new Date(beforeFallBack).toISOString()).toBe("2026-10-31T19:00:00.000Z");
    expect(new Date(afterFallBack).toISOString()).toBe("2026-11-02T20:00:00.000Z");
  });

  it("holds in a zone whose offset differs from the server's, on the far side of the date line", () => {
    const instant = dueInstantMilliseconds({
      dueOn: "2026-09-07",
      dueAtTime: "09:00",
      timeZone: "Pacific/Auckland",
      state: "open",
    });
    // Nine in the morning in Auckland is the previous evening in UTC.
    expect(new Date(instant).toISOString()).toBe("2026-09-06T21:00:00.000Z");
  });

  it("treats a deadline with no recorded time as due at the END of its day in its own zone", () => {
    const instant = dueInstantMilliseconds({
      dueOn: "2026-09-07",
      dueAtTime: null,
      timeZone: "America/Los_Angeles",
      state: "open",
    });
    // The last millisecond of the 7th in Los Angeles, not its midnight — a deadline whose hour
    // nobody wrote down is not missed at one minute past midnight.
    expect(new Date(instant).toISOString()).toBe("2026-09-08T06:59:59.999Z");
  });
});

describe("overdue is derived and never written", () => {
  it("reports an open deadline past its due instant as overdue, and never a settled one", () => {
    const deadline = {
      dueOn: "2026-09-07",
      dueAtTime: "17:00",
      timeZone: "America/Los_Angeles",
      state: "open",
    };
    expect(isOverdue(deadline, "2026-09-07T23:00:00.000Z")).toBe(false);
    expect(isOverdue(deadline, "2026-09-08T00:00:01.000Z")).toBe(true);
    // A firm that dealt with it is never told again that it did not.
    expect(isOverdue({ ...deadline, state: "satisfied" }, "2027-01-01T00:00:00.000Z")).toBe(false);
    expect(isOverdue({ ...deadline, state: "vacated" }, "2027-01-01T00:00:00.000Z")).toBe(false);
  });

  it("writes no column: a deadline long past its date is still 'open' in the database", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { deadlineId, effect } = await createMatterDeadline(
      database,
      {
        matterId: MATTER,
        title: "Long-past deadline",
        dueOn: "2020-01-01",
        timeZone: "America/Los_Angeles",
      },
      options,
    );
    await commit(database, effect);

    const rows = raw.prepare(`SELECT state FROM matter_deadline WHERE id = ?`).all(deadlineId) as {
      state: string;
    }[];
    expect(rows[0]?.state).toBe("open");
    // No column anywhere in the table says a firm missed anything.
    const columns = raw.prepare(`PRAGMA table_info(matter_deadline)`).all() as { name: string }[];
    const columnNames = columns.map((column) => column.name);
    expect(columnNames).not.toContain("overdue");
    expect(columnNames).not.toContain("missed");
    expect(columnNames.some((name) => name.includes("overdue") || name.includes("missed"))).toBe(
      false,
    );

    // And the derivation still answers, from the row as it stands.
    expect(
      isOverdue(
        { dueOn: "2020-01-01", dueAtTime: null, timeZone: "America/Los_Angeles", state: "open" },
        options.clock.now(),
      ),
    ).toBe(true);

    // Settling it is a state change a person made, never one a clock made.
    const { effect: satisfyEffect } = await satisfyMatterDeadline(
      database,
      deadlineId,
      { satisfiedBy: ACTOR },
      options,
    );
    await commit(database, satisfyEffect);
    const settled = raw
      .prepare(`SELECT state FROM matter_deadline WHERE id = ?`)
      .all(deadlineId) as {
      state: string;
    }[];
    expect(settled[0]?.state).toBe("satisfied");
  });
});
