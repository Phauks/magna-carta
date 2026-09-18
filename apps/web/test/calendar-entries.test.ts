import { describe, expect, it } from "vitest";
import type {
  CalendarDeadline,
  CalendarEvent,
  EventType,
  FirmEvent,
  TimelineEntry,
} from "$lib/calendar/calendar-api.ts";
import {
  colored,
  entryFromDeadline,
  entryFromFirmEvent,
  entryFromMatterEvent,
  entryFromTimelineRow,
  mergeByRecord,
  numbered,
  orderEntries,
  perLane,
  recordKeyOf,
  taggedWith,
  type CalendarEntry,
  type EntryContext,
} from "$lib/calendar/calendar-entries.ts";
import {
  eventTypesByCode,
  humanizeKind,
  layeredKindLabel,
} from "$lib/calendar/calendar-vocabulary.ts";

const HEARING: EventType = {
  id: "matterEventType_hearing",
  name: "Hearing",
  code: "HEARING",
  category: "litigation",
  origin: "platform",
  active: true,
};
const FILING: EventType = {
  id: "matterEventType_filing",
  name: "Filing",
  code: "FILING",
  category: "litigation",
  origin: "platform",
  active: true,
};
const FIRM_MEETING: EventType = {
  id: "matterEventType_firmMeeting",
  name: "Firm meeting",
  code: "FIRMMEETING",
  category: "firm",
  origin: "platform",
  active: true,
};

const context: EntryContext = {
  matterNumbers: new Map([["matter_1", "2026-0042"]]),
  eventTypesByCode: eventTypesByCode([HEARING, FILING, FIRM_MEETING]),
  readerTimeZone: "America/New_York",
};

const firmScope = { kind: "firm" } as const;
const matterScope = { kind: "matter", matterId: "matter_1" } as const;

function timelineRow(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    sourceKey: "matterEvent",
    kind: "event",
    sortKey: "2026-09-14",
    rowId: "matterEvent_1",
    matterId: "matter_1",
    actorUserId: null,
    label: "HEARING",
    link: "/matters/matter_1/calendar?entry=matterEvent_1",
    timeOfDay: null,
    timeZone: null,
    ...overrides,
  };
}

function deadline(overrides: Partial<CalendarDeadline>): CalendarDeadline {
  return {
    id: "matterDeadline_1",
    matterId: "matter_1",
    title: "Response due",
    dueOn: "2026-09-10",
    dueAtTime: "17:00",
    timeZone: "America/Los_Angeles",
    source: "member",
    authorityText: null,
    triggerEventId: null,
    state: "open",
    satisfiedAt: null,
    satisfiedBy: null,
    satisfyingEventId: null,
    stateReason: null,
    priority: null,
    overdue: false,
    ...overrides,
  };
}

function matterEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "matterEvent_1",
    matterId: "matter_1",
    eventTypeId: HEARING.id,
    eventTypeName: "Hearing",
    title: "Motion to compel",
    description: null,
    status: "scheduled",
    statusReason: null,
    startsOn: "2026-09-14",
    startsAtTime: "09:00",
    endsOn: null,
    endsAtTime: null,
    timeZone: "America/New_York",
    locationText: "Dept. 12",
    conferenceUrl: null,
    recurrenceRule: null,
    courtReference: null,
    recordedAt: "2026-09-01T00:00:00.000Z",
    recordedBy: null,
    continuedFromEventId: null,
    continuedToEventId: null,
    ...overrides,
  };
}

function firmEvent(overrides: Partial<FirmEvent>): FirmEvent {
  return {
    id: "firmEvent_1",
    eventTypeId: FIRM_MEETING.id,
    title: "Partners' meeting",
    description: null,
    status: "scheduled",
    statusReason: null,
    startsOn: "2026-09-08",
    startsAtTime: "08:30",
    endsOn: null,
    endsAtTime: null,
    timeZone: "America/New_York",
    audience: "all_members",
    locationId: null,
    locationText: null,
    conferenceUrl: null,
    recurrenceRule: null,
    recordedAt: "2026-09-01T00:00:00.000Z",
    recordedBy: null,
    ...overrides,
  };
}

describe("entryFromTimelineRow", () => {
  it("paints a matter event as its type's name and its matter number, never a title", () => {
    const entry = entryFromTimelineRow(timelineRow({}), context);
    expect(entry).toMatchObject({
      id: "event:matterEvent_1",
      kind: "event",
      date: "2026-09-14",
      label: "Hearing",
      detail: "2026-0042",
      tone: "info",
      link: "/matters/matter_1/calendar?entry=matterEvent_1",
    });
  });

  it("strikes a setting the source says was called off, and counts it settled", () => {
    const entry = entryFromTimelineRow(
      timelineRow({ kind: "cancelledEvent", rowId: "off", label: "HEARING" }),
      context,
    );
    expect(entry).toMatchObject({
      id: "event:off",
      kind: "event",
      label: "Hearing",
      tone: "warning",
      struck: true,
      settled: true,
    });
  });

  it("reads a filing as neutral and an unknown or firm-authored type as Event", () => {
    expect(entryFromTimelineRow(timelineRow({ label: "FILING" }), context)?.tone).toBe("neutral");
    expect(entryFromTimelineRow(timelineRow({ label: null }), context)?.label).toBe("Event");
    expect(entryFromTimelineRow(timelineRow({ label: "BESPOKE" }), context)?.label).toBe("Event");
  });

  it("paints without a matter number where the matter did not resolve", () => {
    const entry = entryFromTimelineRow(timelineRow({ matterId: "matter_unknown" }), context);
    expect(entry?.detail).toBeUndefined();
  });

  it("skips deadlines and firm events, which their own reads paint with titles", () => {
    expect(entryFromTimelineRow(timelineRow({ kind: "deadline" }), context)).toBeNull();
    expect(entryFromTimelineRow(timelineRow({ kind: "firmEvent" }), context)).toBeNull();
  });

  it("gives a layered kind its layer's word, with the source's label beside the matter", () => {
    const entry = entryFromTimelineRow(
      timelineRow({ sourceKey: "custodyDueBack", kind: "dueBack", rowId: "x", label: "C-0001" }),
      context,
    );
    expect(entry).toMatchObject({
      kind: "other",
      label: "Due back",
      detail: "2026-0042 · C-0001",
      tone: "neutral",
      settled: false,
    });
    expect(layeredKindLabel("packetReviewDue")).toBe("Packet review due");
    expect(layeredKindLabel("itemReviewDue")).toBe("Item review due");
    // A kind no layer names still reads as something rather than as its key.
    expect(layeredKindLabel("matter_transfer")).toBe(humanizeKind("matter_transfer"));
  });
});

describe("entryFromDeadline", () => {
  it("is danger when open and past due, success when satisfied, struck when settled", () => {
    expect(entryFromDeadline(deadline({ overdue: true }), context, firmScope).tone).toBe("danger");
    expect(entryFromDeadline(deadline({ state: "satisfied" }), context, firmScope)).toMatchObject({
      tone: "success",
      struck: false,
    });
    expect(entryFromDeadline(deadline({ state: "vacated" }), context, firmScope)).toMatchObject({
      tone: "neutral",
      struck: true,
    });
    expect(
      entryFromDeadline(deadline({ state: "superseded", overdue: true }), context, firmScope),
    ).toMatchObject({ tone: "neutral", struck: true });
  });

  it("carries the matter number on the firm calendar and drops it inside the matter", () => {
    expect(entryFromDeadline(deadline({}), context, firmScope).detail).toBe("2026-0042");
    expect(entryFromDeadline(deadline({}), context, matterScope).detail).toBeUndefined();
  });

  it("shows the zone on the time only where it is not the reader's", () => {
    // The zone by its code ON THE DAY: the tenth of September is daylight time in Los Angeles.
    expect(entryFromDeadline(deadline({}), context, firmScope).time).toBe("5:00 PM PDT");
    expect(
      entryFromDeadline(deadline({ timeZone: "America/New_York" }), context, firmScope).time,
    ).toBe("5:00 PM");
    expect(
      entryFromDeadline(deadline({ dueAtTime: null }), context, firmScope).time,
    ).toBeUndefined();
  });
});

describe("entryFromMatterEvent", () => {
  it("paints the title inside the matter with the type and the place beneath", () => {
    const entry = entryFromMatterEvent(matterEvent({}), context, matterScope);
    expect(entry).toMatchObject({
      label: "Motion to compel",
      detail: "Hearing · Dept. 12",
      time: "9:00 AM",
      tone: "info",
      struck: false,
    });
  });

  it("strikes a cancelled setting rather than hiding it", () => {
    const entry = entryFromMatterEvent(matterEvent({ status: "cancelled" }), context, matterScope);
    expect(entry).toMatchObject({ struck: true, tone: "warning" });
  });

  it("carries a span's end date", () => {
    const entry = entryFromMatterEvent(matterEvent({ endsOn: "2026-09-16" }), context, matterScope);
    expect(entry.endDate).toBe("2026-09-16");
  });
});

describe("entryFromFirmEvent", () => {
  it("takes the accent register, names its type and audience, and strikes when cancelled", () => {
    expect(entryFromFirmEvent(firmEvent({}), context)).toMatchObject({
      id: "firmEvent:firmEvent_1",
      label: "Partners' meeting",
      detail: "Firm meeting · Everyone",
      tone: "accent",
      matterId: null,
    });
    expect(entryFromFirmEvent(firmEvent({ status: "cancelled" }), context)).toMatchObject({
      struck: true,
      tone: "warning",
    });
    expect(
      entryFromFirmEvent(firmEvent({ eventTypeId: null, audience: "participants" }), context)
        .detail,
    ).toBe("Firm event · Participants");
  });
});

describe("orderEntries", () => {
  it("orders by day, all-day first, then by the clock, then by label", () => {
    const ordered = orderEntries([
      entryFromMatterEvent(
        matterEvent({ id: "b", startsOn: "2026-09-14", startsAtTime: "14:00", title: "B" }),
        context,
        matterScope,
      ),
      entryFromMatterEvent(
        matterEvent({ id: "c", startsOn: "2026-09-13", startsAtTime: null, title: "C" }),
        context,
        matterScope,
      ),
      entryFromMatterEvent(
        matterEvent({ id: "a", startsOn: "2026-09-14", startsAtTime: "09:00", title: "A" }),
        context,
        matterScope,
      ),
      entryFromMatterEvent(
        matterEvent({ id: "d", startsOn: "2026-09-14", startsAtTime: null, title: "D" }),
        context,
        matterScope,
      ),
    ]);
    expect(ordered.map((entry) => entry.recordId)).toEqual(["c", "d", "a", "b"]);
  });
});

describe("settled", () => {
  it("marks what is no longer coming, and only that", () => {
    expect(entryFromDeadline(deadline({ state: "open" }), context, firmScope).settled).toBe(false);
    expect(entryFromDeadline(deadline({ state: "satisfied" }), context, firmScope).settled).toBe(
      true,
    );
    expect(entryFromDeadline(deadline({ state: "vacated" }), context, firmScope).settled).toBe(
      true,
    );
    expect(entryFromDeadline(deadline({ state: "superseded" }), context, firmScope).settled).toBe(
      true,
    );
    expect(entryFromMatterEvent(matterEvent({}), context, firmScope).settled).toBe(false);
    expect(
      entryFromMatterEvent(matterEvent({ status: "cancelled" }), context, firmScope).settled,
    ).toBe(true);
    expect(entryFromFirmEvent(firmEvent({}), context).settled).toBe(false);
    expect(entryFromFirmEvent(firmEvent({ status: "cancelled" }), context).settled).toBe(true);
  });
});

describe("which calendars an entry is on", () => {
  const hearing = entryFromTimelineRow(timelineRow({ rowId: "matterEvent_1" }), context)!;

  it("is empty out of the projection, and the read plan tags it", () => {
    // A projection is handed a row and has no idea which read produced it, so it says so.
    expect(hearing.sourceKeys).toEqual([]);
    expect(taggedWith(hearing, "member:user_ada").sourceKeys).toEqual(["member:user_ada"]);
  });

  it("merges one record arriving from two calendars into one row that knows it is on both", () => {
    const fromAda = taggedWith(hearing, "member:user_ada");
    const fromGrace = taggedWith(hearing, "member:user_grace");
    const merged = mergeByRecord([fromAda, fromGrace]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceKeys).toEqual(["member:user_ada", "member:user_grace"]);
  });

  it("paints in the colour of the first calendar the rail lists it on", () => {
    const colors = new Map([
      ["records", "blue" as const],
      ["member:user_ada", "green" as const],
    ]);
    const onBoth = { ...hearing, sourceKeys: ["member:user_ada", "records"] };
    // The rail's order is the reader's own arrangement, so "the first calendar this is on" is an
    // answer they can predict.
    expect(colored(onBoth, colors, ["records", "member:user_ada"]).color).toBe("blue");
    expect(colored(onBoth, colors, ["member:user_ada", "records"]).color).toBe("green");
  });
});

describe("a day's columns", () => {
  const hearing = {
    ...entryFromTimelineRow(timelineRow({ rowId: "matterEvent_1" }), context)!,
    sourceKeys: ["member:user_ada", "member:user_grace"],
  };
  const colors = new Map([
    ["member:user_ada", "green" as const],
    ["member:user_grace", "pink" as const],
  ]);

  it("draws one record once per calendar it is on, each in that column's colour", () => {
    // Deliberately more than once: a column that left a shared hearing out of one attorney's day
    // would be lying about that attorney's afternoon.
    const lanes = perLane([hearing], ["member:user_ada", "member:user_grace"], colors);
    expect(lanes.map((entry) => entry.lane)).toEqual(["member:user_ada", "member:user_grace"]);
    expect(lanes.map((entry) => entry.color)).toEqual(["green", "pink"]);
    expect(new Set(lanes.map((entry) => entry.id)).size).toBe(2);
  });

  it("leaves a record out of a column it is not on", () => {
    expect(perLane([hearing], ["member:user_kay"], colors)).toEqual([]);
  });

  it("reaches the one record from either copy", () => {
    const lanes = perLane([hearing], ["member:user_ada", "member:user_grace"], colors);
    for (const drawn of lanes) expect(recordKeyOf(drawn.id)).toBe(hearing.id);
    // A row nothing expanded is its own key.
    expect(recordKeyOf(hearing.id)).toBe(hearing.id);
  });
});

describe("the hour a chip sits at", () => {
  it("comes from the record's own wall clock, in the record's own zone", () => {
    const row = timelineRow({ timeOfDay: "09:30", timeZone: "America/Los_Angeles" });
    const entry = entryFromTimelineRow(row, context)!;
    // Never converted: a nine o'clock hearing is on the nine o'clock row whoever is reading it.
    expect(entry.startMinute).toBe(570);
    expect(entry.time).toContain("9:30");
  });

  it("is absent where the record has no hour, which is what a filing is", () => {
    const entry = entryFromTimelineRow(timelineRow({ timeOfDay: null }), context)!;
    expect(entry.startMinute).toBeUndefined();
    expect(entry.time).toBeUndefined();
  });
});

describe("a matter number arriving after the chips", () => {
  const NUMBERS = new Map([["matter_a", "2026-0042"]]);

  function chip(overrides: Partial<CalendarEntry>): CalendarEntry {
    return {
      id: "event:e1",
      kind: "event",
      recordId: "e1",
      matterId: "matter_a",
      detailIsMatterNumber: true,
      link: null,
      settled: false,
      sourceKeys: [],
      date: "2026-09-15",
      label: "Hearing",
      tone: "neutral",
      ...overrides,
    } as CalendarEntry;
  }

  it("fills the number in", () => {
    expect(numbered(chip({ detail: undefined }), NUMBERS).detail).toBe("2026-0042");
  });

  it("REPLACES the stand-in a chip was painted with while the number was unknown", () => {
    // A matter event with no type name falls back to its type word; the number is what it wanted.
    expect(numbered(chip({ detail: "Hearing" }), NUMBERS).detail).toBe("2026-0042");
  });

  it("leaves a detail that never wanted a number alone", () => {
    // A matter's OWN calendar says "Hearing · Department 12": every row shares the matter, so the
    // number is the one fact worth saying nowhere.
    const onItsOwnMatter = chip({ detail: "Hearing · Department 12", detailIsMatterNumber: false });
    expect(numbered(onItsOwnMatter, NUMBERS)).toBe(onItsOwnMatter);
  });

  it("leaves an entry with no matter alone", () => {
    const firmEvent = chip({ matterId: null, detail: "Firm meeting" });
    expect(numbered(firmEvent, NUMBERS)).toBe(firmEvent);
  });

  it("is unchanged while the matters are still being read", () => {
    const waiting = chip({ detail: undefined });
    expect(numbered(waiting, new Map())).toBe(waiting);
  });

  it("returns the SAME object once the chip already carries the number", () => {
    // A grid re-rendering a row nothing happened to is work for no reason.
    const already = chip({ detail: "2026-0042" });
    expect(numbered(already, NUMBERS)).toBe(already);
  });

  it("is unchanged for a matter the read did not return — a capped walk loses no chip", () => {
    const elsewhere = chip({ matterId: "matter_beyond_the_cap", detail: undefined });
    expect(numbered(elsewhere, NUMBERS)).toBe(elsewhere);
  });
});
