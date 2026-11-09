import { describe, expect, it } from "vitest";
import {
  closeMatterDeadline,
  createMatterDeadline,
  satisfyMatterDeadline,
  updateMatterDeadline,
} from "../src/deadline-service.ts";
import { readMatterDeadline, readOpenDeadlineTimeZones } from "../src/deadline-statements.ts";
import { createMatterEvent } from "../src/event-service.ts";
import { CalendarValidationError } from "../src/validation.ts";
import {
  ACTOR,
  MATTER,
  WALLED_MATTER,
  commit,
  migratedDatabase,
  options,
  seedMatters,
  visibility,
} from "./support.ts";

const DEADLINE = {
  matterId: MATTER,
  title: "Opposition to the motion to compel",
  dueOn: "2026-09-07",
  dueAtTime: "17:00",
  timeZone: "America/Los_Angeles",
  authorityText: "order entered 14 August 2026",
} as const;

describe("recording a deadline", () => {
  it("records the date, the time, the zone, and the firm's stated authority", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { deadlineId, effect } = await createMatterDeadline(database, DEADLINE, options);
    await commit(database, effect);
    const stored = await readMatterDeadline(database, deadlineId, visibility);
    expect(stored?.due_on).toBe("2026-09-07");
    expect(stored?.due_at_time).toBe("17:00");
    expect(stored?.state).toBe("open");
    expect(stored?.source).toBe("member");
    expect(stored?.authority_text).toBe("order entered 14 August 2026");
    // The catalog columns exist and stay null: nothing has been verified, so nothing claims to be.
    expect(stored?.catalog_entry_key).toBeNull();
    expect(stored?.catalog_version).toBeNull();
  });

  it("refuses a deadline sourced from the statutory catalog, because no verified catalog exists", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    await expect(
      createMatterDeadline(database, { ...DEADLINE, source: "statutory_catalog" }, options),
    ).rejects.toThrow(/no verified deadline catalog is encoded/);
  });

  it("refuses a trigger event that belongs to a different matter", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId, effect } = createMatterEvent(
      database,
      {
        matterId: WALLED_MATTER,
        title: "Service of process",
        startsOn: "2026-08-20",
        timeZone: "America/Los_Angeles",
      },
      options,
    );
    await commit(database, effect);
    await expect(
      createMatterDeadline(database, { ...DEADLINE, triggerEventId: eventId }, options),
    ).rejects.toThrow(/different matter/);
  });
});

describe("a deadline's time of day", () => {
  it("refuses a time that is not a wall-clock time, on recording and on editing", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    await Promise.all(
      ["5pm", "24:00", "17:60", "9:30", ""].map((dueAtTime) =>
        expect(
          createMatterDeadline(database, { ...DEADLINE, dueAtTime }, options),
          dueAtTime,
        ).rejects.toMatchObject({ code: "calendar-invalid-time" }),
      ),
    );

    const { deadlineId, effect } = await createMatterDeadline(database, DEADLINE, options);
    await commit(database, effect);
    await expect(
      updateMatterDeadline(database, deadlineId, { dueAtTime: "half past five" }, options),
    ).rejects.toMatchObject({ code: "calendar-invalid-time" });
  });

  it("records no time as the end of the day rather than refusing it", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { deadlineId, effect } = await createMatterDeadline(
      database,
      { ...DEADLINE, dueAtTime: null },
      options,
    );
    await commit(database, effect);
    const stored = await readMatterDeadline(database, deadlineId, visibility);
    expect(stored?.due_at_time).toBeNull();
  });
});

describe("reading the zones open deadlines are recorded in", () => {
  // The zone read is what turns "overdue" into a bound a query can carry — one cutoff per zone,
  // because no D1 query resolves a zone. It is bounded like every read here, and a caller that cannot
  // see the bound bite is worse off than for an ordinary page: a zone this never returns contributes
  // no cutoff, so every deadline in it matches neither the overdue bound nor the due-today window and
  // the caller reports nothing at all about a whole jurisdiction while its counts read healthy. So
  // the truncation rides the answer instead of being re-derived by each caller.
  function seedDeadlinesInZones(
    raw: ReturnType<typeof migratedDatabase>["raw"],
    zones: readonly string[],
  ): void {
    for (const [index, zone] of zones.entries()) {
      raw.exec(
        `INSERT INTO matter_deadline (id, matter_id, title, due_on, due_at_time, time_zone, source, state, recorded_at, created_at, updated_at) ` +
          `VALUES ('matterDeadline_${String(index).padStart(6, "0")}', '${MATTER}', 'Response to motion', '2026-09-07', NULL, '${zone}', 'member', 'open', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      );
    }
  }

  const ZONE_READ = {
    throughDate: "2026-12-31",
    visibilityFragment: visibility.fragmentFor("matter_deadline.matter_id"),
    visibilityBindings: visibility.bindings,
  } as const;

  it("says so when the limit cut the zone list short, and returns no more than the limit", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    seedDeadlinesInZones(raw, [
      "America/Los_Angeles",
      "America/Chicago",
      "America/New_York",
      "Europe/London",
    ]);

    const read = await readOpenDeadlineTimeZones(database, { ...ZONE_READ, limit: 3 });

    expect(read.timeZones).toHaveLength(3);
    expect(read.clamped).toBe(true);
  });

  it("says the list is complete when it is, so the signal means something when it fires", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    seedDeadlinesInZones(raw, ["America/Los_Angeles", "America/Chicago"]);

    // Exactly at the limit is COMPLETE, not truncated: the read over-reads by one, so a full answer
    // and a cut-short one are distinguishable rather than inferred from the count.
    const read = await readOpenDeadlineTimeZones(database, { ...ZONE_READ, limit: 2 });

    expect([...read.timeZones].sort()).toStrictEqual(["America/Chicago", "America/Los_Angeles"]);
    expect(read.clamped).toBe(false);
  });
});

describe("settling a deadline", () => {
  async function openDeadline() {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { deadlineId, effect } = await createMatterDeadline(database, DEADLINE, options);
    await commit(database, effect);
    return { database, raw, deadlineId };
  }

  it("satisfies with the filing that discharged it", async () => {
    const { database, deadlineId } = await openDeadline();
    const { eventId, effect } = createMatterEvent(
      database,
      {
        matterId: MATTER,
        title: "Opposition filed",
        startsOn: "2026-09-05",
        timeZone: "America/Los_Angeles",
      },
      options,
    );
    await commit(database, effect);
    const { effect: satisfyEffect } = await satisfyMatterDeadline(
      database,
      deadlineId,
      { satisfiedBy: ACTOR, satisfyingEventId: eventId },
      options,
    );
    await commit(database, satisfyEffect);
    const stored = await readMatterDeadline(database, deadlineId, visibility);
    expect(stored?.state).toBe("satisfied");
    expect(stored?.satisfying_event_id).toBe(eventId);
    expect(stored?.satisfied_by).toBe(ACTOR);
  });

  it("refuses to satisfy one that is already satisfied", async () => {
    const { database, deadlineId } = await openDeadline();
    const { effect } = await satisfyMatterDeadline(
      database,
      deadlineId,
      { satisfiedBy: ACTOR },
      options,
    );
    await commit(database, effect);
    await expect(
      satisfyMatterDeadline(database, deadlineId, { satisfiedBy: ACTOR }, options),
    ).rejects.toThrow(CalendarValidationError);
  });

  it("refuses to vacate without a reason, and keeps the reason when one is given", async () => {
    const { database, deadlineId } = await openDeadline();
    await expect(
      closeMatterDeadline(database, deadlineId, "vacated", { stateReason: "   " }, options),
    ).rejects.toThrow(/records why it is no longer in force/);
    const { effect } = await closeMatterDeadline(
      database,
      deadlineId,
      "vacated",
      { stateReason: "vacated by stipulation entered 1 September" },
      options,
    );
    await commit(database, effect);
    const stored = await readMatterDeadline(database, deadlineId, visibility);
    expect(stored?.state).toBe("vacated");
    expect(stored?.state_reason).toBe("vacated by stipulation entered 1 September");
  });
});
