import { describe, expect, it } from "vitest";
import { cancelMatterEvent, createMatterEvent, updateMatterEvent } from "../src/event-service.ts";
import { readMatterEvent, readMatterEventParticipants } from "../src/event-statements.ts";
import { CalendarValidationError } from "../src/validation.ts";
import { ACTOR, MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

const HEARING = {
  matterId: MATTER,
  title: "Hearing on the motion to compel",
  startsOn: "2026-09-14",
  startsAtTime: "09:00",
  timeZone: "America/Los_Angeles",
  locationText: "Department 12",
  courtReference: "A-26-123456-C",
} as const;

describe("recording an event", () => {
  it("records a hearing with a time, a zone, and two participants", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId, effect } = createMatterEvent(
      database,
      {
        ...HEARING,
        participants: [
          { participantKind: "member", memberUserId: ACTOR, role: "appearing counsel" },
          { participantKind: "external", participantName: "Hon. A. Judge", role: "judge" },
        ],
      },
      options,
    );
    await commit(database, effect);

    const stored = await readMatterEvent(database, eventId);
    expect(stored?.starts_on).toBe("2026-09-14");
    expect(stored?.starts_at_time).toBe("09:00");
    expect(stored?.time_zone).toBe("America/Los_Angeles");
    expect(stored?.status).toBe("scheduled");
    // recorded_at is when a person asserted it, which is a different fact from when it happens.
    expect(stored?.recorded_at).toBe(options.clock.now());
    const participants = await readMatterEventParticipants(database, eventId);
    expect(participants.map((row) => row.participant_kind).sort()).toEqual(["external", "member"]);
  });

  it("refuses an event that ends before it starts", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    expect(() =>
      createMatterEvent(database, { ...HEARING, endsOn: "2026-09-13" }, options),
    ).toThrow(CalendarValidationError);
  });

  it("refuses an end time on an event with no start time", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    expect(() =>
      createMatterEvent(database, { ...HEARING, startsAtTime: null, endsAtTime: "16:30" }, options),
    ).toThrow(/end time needs a start time/);
  });

  it("refuses a zone no runtime can resolve, and refuses a fixed offset", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    expect(() =>
      createMatterEvent(database, { ...HEARING, timeZone: "Mars/Olympus" }, options),
    ).toThrow(/not a time zone/);
    // A fixed offset is wrong for half the year in every zone that observes daylight saving.
    expect(() => createMatterEvent(database, { ...HEARING, timeZone: "-07:00" }, options)).toThrow(
      /not a time zone/,
    );
  });

  it("refuses a date that is not on the calendar", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    expect(() =>
      createMatterEvent(database, { ...HEARING, startsOn: "2026-02-30" }, options),
    ).toThrow(/not a date on the calendar/);
  });

  it("refuses a participant whose kind names an empty column", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    expect(() =>
      createMatterEvent(
        database,
        { ...HEARING, participants: [{ participantKind: "entity", entityId: null }] },
        options,
      ),
    ).toThrow(/must name one/);
  });
});

describe("a continued hearing is the same hearing, edited in place", () => {
  it("moves the date on the one row and writes exactly one audit entry carrying the move", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId, effect } = createMatterEvent(database, HEARING, options);
    await commit(database, effect);

    const { effect: updateEffect } = await updateMatterEvent(
      database,
      eventId,
      { startsOn: "2026-10-05" },
      options,
    );
    await commit(database, updateEffect);

    const stored = await readMatterEvent(database, eventId);
    expect(stored?.starts_on).toBe("2026-10-05");
    // One row, not two: a second row would put two hearings on the calendar and make every consumer
    // responsible for hiding one.
    const events = raw
      .prepare(`SELECT COUNT(*) AS total FROM matter_event WHERE matter_id = ?`)
      .all(MATTER) as { total: number }[];
    expect(events[0]?.total).toBe(1);

    const audits = raw
      .prepare(`SELECT event, metadata FROM audit_log WHERE event = 'calendar.event.updated'`)
      .all() as { event: string; metadata: string }[];
    expect(audits).toHaveLength(1);
    const metadata = JSON.parse(audits[0]?.metadata ?? "{}") as Record<string, unknown>;
    expect(metadata["startsOnBefore"]).toBe("2026-09-14");
    expect(metadata["startsOnAfter"]).toBe("2026-10-05");
    // The audit row carries identifiers and dates, never the event's own words.
    expect(JSON.stringify(metadata)).not.toContain("motion to compel");
  });

  it("cancels rather than deletes", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId, effect } = createMatterEvent(database, HEARING, options);
    await commit(database, effect);
    const { effect: cancelEffect } = await cancelMatterEvent(database, eventId, options);
    await commit(database, cancelEffect);
    const stored = await readMatterEvent(database, eventId);
    expect(stored?.status).toBe("cancelled");
  });
});
