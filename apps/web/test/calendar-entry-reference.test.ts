import { describe, expect, it } from "vitest";
import type { CalendarDeadline, CalendarEvent, FirmEvent } from "$lib/calendar/calendar-api.ts";
import type { CalendarEntry } from "$lib/calendar/calendar-entries.ts";
import {
  entryRecordDate,
  entryRecordMatterId,
  entryRecordTitle,
  entryReferenceFromIdentifier,
  entryReferenceKey,
  entryReferenceOf,
  type EntryRecord,
  type EntryReference,
} from "$lib/calendar/entry-reference.ts";

const event: CalendarEvent = {
  id: "matterEvent_1",
  matterId: "matter_1",
  eventTypeId: "eventType_hearing",
  eventTypeName: "Hearing",
  title: "Status conference",
  description: null,
  status: "scheduled",
  statusReason: null,
  startsOn: "2026-09-03",
  startsAtTime: "09:30",
  endsOn: null,
  endsAtTime: null,
  timeZone: "America/New_York",
  locationText: "Courtroom 4",
  conferenceUrl: null,
  recurrenceRule: null,
  courtReference: "26-CV-100",
  recordedAt: "2026-09-01T00:00:00Z",
  recordedBy: "user_1",
  continuedFromEventId: null,
  continuedToEventId: null,
};

const deadline: CalendarDeadline = {
  id: "matterDeadline_1",
  matterId: "matter_1",
  title: "Discovery responses due",
  dueOn: "2026-09-10",
  dueAtTime: null,
  timeZone: "America/New_York",
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
};

const firmEvent: FirmEvent = {
  id: "firmEvent_1",
  eventTypeId: "eventType_meeting",
  title: "All hands",
  description: null,
  status: "scheduled",
  statusReason: null,
  startsOn: "2026-09-04",
  startsAtTime: null,
  endsOn: null,
  endsAtTime: null,
  timeZone: "America/New_York",
  audience: "all_members",
  locationId: null,
  locationText: null,
  conferenceUrl: null,
  recurrenceRule: null,
  recordedAt: "2026-09-01T00:00:00Z",
  recordedBy: null,
};

const eventRecord: EntryRecord = { kind: "event", event, participants: [] };
const deadlineRecord: EntryRecord = { kind: "deadline", deadline };
const firmEventRecord: EntryRecord = { kind: "firmEvent", event: firmEvent, participants: [] };

/** A painted entry, as the grid remembers it. */
function painted(
  kind: CalendarEntry["kind"],
  recordId: string,
  matterId: string | null,
  date: string,
): CalendarEntry {
  return {
    id: `${kind}:${recordId}`,
    kind,
    recordId,
    matterId,
    link: null,
    settled: false,
    sourceKeys: [],
    date,
    label: "Hearing",
    tone: "neutral",
  };
}

describe("entryReferenceFromIdentifier", () => {
  it("reads the kind off each prefix the window opens", () => {
    expect(entryReferenceFromIdentifier("matterEvent_1")).toEqual({
      kind: "event",
      recordId: "matterEvent_1",
    });
    expect(entryReferenceFromIdentifier("matterDeadline_1")).toEqual({
      kind: "deadline",
      recordId: "matterDeadline_1",
    });
    expect(entryReferenceFromIdentifier("firmEvent_1")).toEqual({
      kind: "firmEvent",
      recordId: "firmEvent_1",
    });
  });

  it("opens nothing for a prefix this surface does not know", () => {
    expect(entryReferenceFromIdentifier("custodyMovement_1")).toBeNull();
    expect(entryReferenceFromIdentifier("matter_1")).toBeNull();
  });

  it("opens nothing for a bare prefix with no identifier after it", () => {
    expect(entryReferenceFromIdentifier("matterEvent_")).toBeNull();
    expect(entryReferenceFromIdentifier("matterDeadline_")).toBeNull();
    expect(entryReferenceFromIdentifier("firmEvent_")).toBeNull();
  });

  it("opens nothing when the address carries no entry", () => {
    expect(entryReferenceFromIdentifier(null)).toBeNull();
    expect(entryReferenceFromIdentifier("")).toBeNull();
  });

  it("carries neither a matter nor a day, because an address knows neither", () => {
    const reference = entryReferenceFromIdentifier("matterDeadline_1");
    expect(reference).not.toBeNull();
    expect(reference).not.toHaveProperty("matterId");
    expect(reference).not.toHaveProperty("date");
  });
});

describe("entryReferenceOf", () => {
  it("remembers what a chip painted, matter and day included, for each kind the window opens", () => {
    expect(entryReferenceOf(painted("event", "matterEvent_1", "matter_1", "2026-09-03"))).toEqual({
      kind: "event",
      recordId: "matterEvent_1",
      matterId: "matter_1",
      date: "2026-09-03",
    });
    expect(
      entryReferenceOf(painted("deadline", "matterDeadline_1", "matter_1", "2026-09-10")),
    ).toEqual({
      kind: "deadline",
      recordId: "matterDeadline_1",
      matterId: "matter_1",
      date: "2026-09-10",
    });
    expect(entryReferenceOf(painted("firmEvent", "firmEvent_1", null, "2026-09-04"))).toEqual({
      kind: "firmEvent",
      recordId: "firmEvent_1",
      matterId: null,
      date: "2026-09-04",
    });
  });

  it("opens nothing for a layered kind, which goes where the federated read says it lives", () => {
    expect(entryReferenceOf(painted("other", "custodyMovement_1", "matter_1", "2026-09-20"))).toBe(
      null,
    );
  });
});

describe("entryReferenceKey", () => {
  const reference: EntryReference = {
    kind: "deadline",
    recordId: "matterDeadline_1",
    matterId: "matter_1",
    date: "2026-09-10",
  };

  it("is the same key for the same reference", () => {
    expect(entryReferenceKey(reference)).toBe(entryReferenceKey({ ...reference }));
  });

  it("tells two references apart by matter alone, and by day alone", () => {
    expect(entryReferenceKey({ ...reference, matterId: "matter_2" })).not.toBe(
      entryReferenceKey(reference),
    );
    expect(entryReferenceKey({ ...reference, date: "2026-09-11" })).not.toBe(
      entryReferenceKey(reference),
    );
  });

  it("tells a record from another of a different kind or identifier", () => {
    expect(entryReferenceKey({ ...reference, kind: "event" })).not.toBe(
      entryReferenceKey(reference),
    );
    expect(entryReferenceKey({ ...reference, recordId: "matterDeadline_2" })).not.toBe(
      entryReferenceKey(reference),
    );
  });

  it("keys an address's reference, which knows no matter or day, the same whether those are absent or null", () => {
    expect(entryReferenceKey({ kind: "event", recordId: "matterEvent_1" })).toBe(
      entryReferenceKey({ kind: "event", recordId: "matterEvent_1", matterId: null }),
    );
  });
});

describe("what a record says about itself", () => {
  it("reads the title off whichever kind it is", () => {
    expect(entryRecordTitle(eventRecord)).toBe("Status conference");
    expect(entryRecordTitle(deadlineRecord)).toBe("Discovery responses due");
    expect(entryRecordTitle(firmEventRecord)).toBe("All hands");
  });

  it("puts a deadline on its due day and an event on its first day", () => {
    expect(entryRecordDate(eventRecord)).toBe("2026-09-03");
    expect(entryRecordDate(deadlineRecord)).toBe("2026-09-10");
    expect(entryRecordDate(firmEventRecord)).toBe("2026-09-04");
  });

  it("names the matter for a matter's records, and none for a firm event", () => {
    expect(entryRecordMatterId(eventRecord)).toBe("matter_1");
    expect(entryRecordMatterId(deadlineRecord)).toBe("matter_1");
    expect(entryRecordMatterId(firmEventRecord)).toBeNull();
  });
});
