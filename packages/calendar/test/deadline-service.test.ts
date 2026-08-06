import { describe, expect, it } from "vitest";
import {
  closeMatterDeadline,
  createMatterDeadline,
  satisfyMatterDeadline,
} from "../src/deadline-service.ts";
import { readMatterDeadline } from "../src/deadline-statements.ts";
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
