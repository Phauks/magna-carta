import { describe, expect, it } from "vitest";
import type { FirmEventId, MatterEventId } from "@magna-carta/identifiers/types";
import { createMatterEvent } from "../src/event-service.ts";
import { readMatterEvent, readMatterEventParticipants } from "../src/event-statements.ts";
import { createFirmEvent } from "../src/firm-event-service.ts";
import { readFirmEvent } from "../src/firm-event-statements.ts";
import {
  changeFirmEventOccurrence,
  changeMatterEventOccurrence,
  readSeriesInWindow,
} from "../src/series-service.ts";
import { CalendarValidationError } from "../src/validation.ts";
import {
  ACTOR,
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedMatters,
  visibility,
} from "./support.ts";

// A repeating setting, read as its days and changed one day at a time. The series is one row; the
// days come from the rule at read time; a changed day is an exception row the read skips.

// Tuesday 2026-11-10 and Thursday, every second week, twelve times.
const CONFERENCE = {
  matterId: MATTER,
  title: "Status conference",
  startsOn: "2026-11-10",
  startsAtTime: "10:00",
  timeZone: "America/Los_Angeles",
  recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=12",
  participants: [{ participantKind: "member" as const, memberUserId: ACTOR }],
};

const NOVEMBER = { fromDate: "2026-11-01", toDate: "2026-11-30" };

async function recorded() {
  const context = migratedDatabase();
  seedMatters(context.raw);
  const created = createMatterEvent(context.database, CONFERENCE, options);
  await commit(context.database, created.effect);
  return { ...context, seriesId: created.eventId };
}

describe("reading a series as its days", () => {
  it("returns every day of the series in the window, its first day included", async () => {
    const { database } = await recorded();
    const { series } = await readSeriesInWindow(database, { ...NOVEMBER, side: "all", visibility });
    expect(series).toHaveLength(1);
    expect(series[0]?.occurrences).toEqual([
      "2026-11-10",
      "2026-11-12",
      "2026-11-24",
      "2026-11-26",
    ]);
  });

  it("returns a series that began before the window, and none that ended before it", async () => {
    const { database } = await recorded();
    const january = await readSeriesInWindow(database, {
      fromDate: "2027-01-01",
      toDate: "2027-01-31",
      side: "matter",
      visibility,
    });
    expect(january.series[0]?.occurrences).toEqual([
      "2027-01-05",
      "2027-01-07",
      "2027-01-19",
      "2027-01-21",
    ]);
    const march = await readSeriesInWindow(database, {
      fromDate: "2027-03-01",
      toDate: "2027-03-31",
      side: "all",
      visibility,
    });
    expect(march.series).toHaveLength(0);
  });

  it("carries a matter series' title only when read for that matter", async () => {
    const { database } = await recorded();
    const firmWide = await readSeriesInWindow(database, { ...NOVEMBER, side: "all", visibility });
    expect(firmWide.series[0]?.title).toBeNull();
    const forMatter = await readSeriesInWindow(database, {
      ...NOVEMBER,
      side: "matter",
      matterId: MATTER,
      visibility,
    });
    expect(forMatter.series[0]?.title).toBe("Status conference");
  });
});

describe("changing one occurrence", () => {
  it("writes an exception the read skips, carrying the series' participants", async () => {
    const { database, seriesId } = await recorded();
    const changed = await changeMatterEventOccurrence(
      database,
      seriesId,
      "2026-11-24",
      "this",
      { kind: "update", fields: { startsOn: "2026-11-25", startsAtTime: "14:00" } },
      options,
    );
    await commit(database, changed.effect);

    const exception = await readMatterEvent(database, changed.id as MatterEventId, visibility);
    expect(exception?.starts_on).toBe("2026-11-25");
    expect(exception?.recurrence_rule).toBeNull();
    expect(exception?.recurrence_parent_id).toBe(seriesId);
    expect(exception?.recurrence_occurrence_on).toBe("2026-11-24");
    expect(await readMatterEventParticipants(database, changed.id as MatterEventId)).toHaveLength(
      1,
    );
    expect(changed.effect.outboxMessages?.map((message) => message.topic)).toEqual([
      "calendar.event.rescheduled",
    ]);

    const { series } = await readSeriesInWindow(database, { ...NOVEMBER, side: "all", visibility });
    expect(series[0]?.occurrences).toEqual(["2026-11-10", "2026-11-12", "2026-11-26"]);
  });

  it("cancels one occurrence as an exception that stays, struck", async () => {
    const { database, seriesId } = await recorded();
    const changed = await changeMatterEventOccurrence(
      database,
      seriesId,
      "2026-11-12",
      "this",
      { kind: "cancel", statusReason: "Judge unavailable" },
      options,
    );
    await commit(database, changed.effect);
    const exception = await readMatterEvent(database, changed.id as MatterEventId, visibility);
    expect(exception?.status).toBe("cancelled");
    expect(exception?.status_reason).toBe("Judge unavailable");
    expect(exception?.starts_on).toBe("2026-11-12");
  });

  it("refuses a day the series does not fall on, and a day already changed", async () => {
    const { database, seriesId } = await recorded();
    await expect(
      changeMatterEventOccurrence(
        database,
        seriesId,
        "2026-11-17",
        "this",
        { kind: "cancel", statusReason: null },
        options,
      ),
    ).rejects.toThrow(CalendarValidationError);
    const first = await changeMatterEventOccurrence(
      database,
      seriesId,
      "2026-11-12",
      "this",
      { kind: "cancel", statusReason: null },
      options,
    );
    await commit(database, first.effect);
    await expect(
      changeMatterEventOccurrence(
        database,
        seriesId,
        "2026-11-12",
        "this",
        { kind: "cancel", statusReason: null },
        options,
      ),
    ).rejects.toThrow(/already changed/);
  });
});

describe("changing an occurrence and every later one", () => {
  it("cuts the series, sharing the count, and moves later exceptions to the new series", async () => {
    const { database, seriesId } = await recorded();
    const moved = await changeMatterEventOccurrence(
      database,
      seriesId,
      "2026-12-08",
      "this",
      { kind: "update", fields: { startsAtTime: "11:00" } },
      options,
    );
    await commit(database, moved.effect);

    const cut = await changeMatterEventOccurrence(
      database,
      seriesId,
      "2026-11-24",
      "following",
      {
        kind: "update",
        fields: {
          startsOn: "2026-11-24",
          startsAtTime: "09:00",
          recurrenceRule: CONFERENCE.recurrenceRule,
        },
      },
      options,
    );
    await commit(database, cut.effect);

    const earlier = await readMatterEvent(database, seriesId, visibility);
    expect(earlier?.recurrence_rule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=2");
    const later = await readMatterEvent(database, cut.id as MatterEventId, visibility);
    expect(later?.starts_on).toBe("2026-11-24");
    expect(later?.starts_at_time).toBe("09:00");
    expect(later?.recurrence_rule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=10");
    const exception = await readMatterEvent(database, moved.id as MatterEventId, visibility);
    expect(exception?.recurrence_parent_id).toBe(cut.id);

    const { series } = await readSeriesInWindow(database, {
      fromDate: "2026-11-01",
      toDate: "2026-12-31",
      side: "all",
      visibility,
    });
    const days = series.flatMap((each) => each.occurrences);
    expect(days).toEqual([
      "2026-11-10",
      "2026-11-12",
      "2026-11-24",
      "2026-11-26",
      "2026-12-10",
      "2026-12-22",
      "2026-12-24",
    ]);
  });
});

describe("a firm event's series", () => {
  it("changes one day of a weekly staff meeting and reads the rest", async () => {
    const { database } = migratedDatabase();
    const created = await createFirmEvent(
      database,
      {
        title: "Staff meeting",
        startsOn: "2026-11-09",
        startsAtTime: "08:30",
        timeZone: "America/Los_Angeles",
        audience: "all_members",
        recurrenceRule: "FREQ=WEEKLY",
      },
      options,
    );
    await commit(database, created.effect);
    const changed = await changeFirmEventOccurrence(
      database,
      created.firmEventId,
      "2026-11-23",
      "this",
      { kind: "cancel", statusReason: null },
      options,
    );
    await commit(database, changed.effect);
    const exception = await readFirmEvent(database, changed.id as FirmEventId);
    expect(exception?.status).toBe("cancelled");
    const { series } = await readSeriesInWindow(database, {
      ...NOVEMBER,
      side: "firm",
      visibility,
    });
    expect(series[0]?.title).toBe("Staff meeting");
    expect(series[0]?.occurrences).toEqual(["2026-11-09", "2026-11-16", "2026-11-30"]);
  });
});
