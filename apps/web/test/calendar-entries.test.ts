import { describe, expect, it } from "vitest";
import type {
  CalendarDeadline,
  CalendarEvent,
  EventType,
  FirmEvent,
  TimelineEntry,
} from "$lib/calendar/calendar-api.ts";
import {
  entryFromDeadline,
  entryFromFirmEvent,
  entryFromMatterEvent,
  entryFromTimelineRow,
  orderEntries,
  type EntryContext,
} from "$lib/calendar/calendar-entries.ts";
import { eventTypesByCode, humanizeKind } from "$lib/calendar/calendar-vocabulary.ts";

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

  it("gives any other kind its humanized word", () => {
    const entry = entryFromTimelineRow(
      timelineRow({ sourceKey: "custodyDueBack", kind: "dueBack", rowId: "x" }),
      context,
    );
    expect(entry).toMatchObject({ kind: "other", label: "Due back", tone: "neutral" });
    expect(humanizeKind("packetReviewDue")).toBe("Packet review due");
    expect(humanizeKind("matter_transfer")).toBe("Matter transfer");
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
    expect(entryFromDeadline(deadline({}), context, firmScope).time).toBe(
      "5:00 PM (America/Los_Angeles)",
    );
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
