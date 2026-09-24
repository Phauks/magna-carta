import { civilDateOf } from "@magna-carta/civil-time/civil-date";
/*
 * What one calendar entry's sheet says, kind by kind. The formatters are injected, so the sheet is
 * asserted on what it projects and not on a locale: a date reads as the test's own stamp, a time as
 * the test's own stamp with its zone, and the paper's text follows from the record alone.
 */
import { describe, expect, it } from "vitest";
import type {
  CalendarDeadline,
  CalendarEvent,
  EventParticipant,
  FirmEvent,
} from "$lib/calendar/calendar-api.ts";
import { entrySheet, type EntrySheetContext } from "$lib/calendar/entry-print-sheet.ts";
import type { EntryRecord } from "$lib/calendar/entry-reference.ts";

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

const lead: EventParticipant = {
  id: "eventParticipant_1",
  participantKind: "member",
  memberUserId: "user_1",
  entityId: null,
  participantName: null,
  role: "Lead",
};

const witness: EventParticipant = {
  id: "eventParticipant_2",
  participantKind: "external",
  memberUserId: null,
  entityId: null,
  participantName: "Grace Hopper",
  role: null,
};

/** The surface's own rendering, made visible: every formatted value carries what it was given. */
const context: EntrySheetContext = {
  // The day a moment fell on. Pinned here so the sheet reads the same on every machine; the real
  // supplier passes formatInstantDate, which follows the reader's own zone.
  instantDate: (instant: string) => civilDateOf(instant),
  matterNumber: "2026-0042",
  typeName: "Hearing",
  officeName: null,
  participantName: (participant) =>
    participant.participantName ?? participant.memberUserId ?? "Unnamed",
  date: (civilDate) => `on ${civilDate}`,
  time: (time, timeZone) => (time === null ? null : `${time} in ${timeZone}`),
  printedAt: "5 Sep 2026, 10:00",
};

const footer = "Magna Carta · printed 5 Sep 2026, 10:00";

describe("a deadline's sheet", () => {
  it("states when it is due, its authority, source, priority and state", () => {
    const record: EntryRecord = { kind: "deadline", deadline };
    expect(entrySheet(record, context)).toEqual({
      heading: "Deadline",
      reference: "Discovery responses due",
      subtitle: "Matter 2026-0042",
      sections: [
        {
          id: "when",
          kind: "fields",
          fields: [
            { label: "Due", value: "on 2026-09-10" },
            { label: "Time", value: "End of the day" },
            { label: "Time Zone", value: "(UTC-04:00) Eastern Daylight Time · New York" },
          ],
        },
        {
          id: "facts",
          kind: "fields",
          fields: [
            { label: "Authority", value: "Not recorded" },
            { label: "Source", value: "Recorded by the firm" },
            { label: "Priority", value: "None" },
            { label: "State", value: "Open" },
          ],
        },
      ],
      footer,
    });
  });

  it("says an open deadline is past due, with its time, authority and priority stated", () => {
    const record: EntryRecord = {
      kind: "deadline",
      deadline: {
        ...deadline,
        dueAtTime: "17:00",
        source: "court_order",
        authorityText: "Fed. R. Civ. P. 33",
        priority: 1,
        overdue: true,
      },
    };
    const sheet = entrySheet(record, { ...context, matterNumber: null });
    expect(sheet.subtitle).toBeUndefined();
    expect(sheet.sections[0]).toMatchObject({
      fields: [
        { label: "Due", value: "on 2026-09-10" },
        { label: "Time", value: "17:00 in America/New_York" },
        { label: "Time Zone", value: "(UTC-04:00) Eastern Daylight Time · New York" },
      ],
    });
    expect(sheet.sections[1]).toMatchObject({
      fields: [
        { label: "Authority", value: "Fed. R. Civ. P. 33" },
        { label: "Source", value: "Set by a court order" },
        { label: "Priority", value: "1" },
        { label: "State", value: "Open, past due" },
      ],
    });
  });

  it("gives a settled deadline its state and its reason, and never calls it past due", () => {
    const record: EntryRecord = {
      kind: "deadline",
      deadline: { ...deadline, state: "vacated", stateReason: "Motion withdrawn", overdue: true },
    };
    const facts = entrySheet(record, context).sections[1];
    expect(facts).toMatchObject({
      fields: [
        { label: "Authority", value: "Not recorded" },
        { label: "Source", value: "Recorded by the firm" },
        { label: "Priority", value: "None" },
        { label: "State", value: "Vacated" },
        { label: "Reason", value: "Motion withdrawn" },
      ],
    });
  });
});

describe("a matter event's sheet", () => {
  it("states when, where, the court reference and status, then who, then the description", () => {
    const record: EntryRecord = {
      kind: "event",
      event: { ...event, endsAtTime: "10:30", description: "Bring the binder." },
      participants: [lead, witness],
    };
    expect(entrySheet(record, context)).toEqual({
      heading: "Matter Event",
      reference: "Status conference",
      subtitle: "Hearing · Matter 2026-0042",
      sections: [
        {
          id: "when",
          kind: "fields",
          fields: [
            { label: "Date", value: "on 2026-09-03" },
            { label: "Time", value: "09:30 in America/New_York" },
            { label: "Ends", value: "10:30 in America/New_York" },
            { label: "Time Zone", value: "(UTC-04:00) Eastern Daylight Time · New York" },
          ],
        },
        {
          id: "facts",
          kind: "fields",
          fields: [
            { label: "Location", value: "Courtroom 4" },
            { label: "Conference Link", value: "Not recorded" },
            { label: "Court Reference", value: "26-CV-100" },
            { label: "Status", value: "Scheduled" },
          ],
        },
        {
          id: "participants",
          kind: "fields",
          title: "Participants",
          fields: [
            { label: "Lead", value: "user_1" },
            { label: "Participant", value: "Grace Hopper" },
          ],
        },
        { id: "description", kind: "text", title: "Description", text: "Bring the binder." },
      ],
      footer,
    });
  });

  it("says all day for an untimed event, and states the end day of a span", () => {
    const record: EntryRecord = {
      kind: "event",
      event: { ...event, startsAtTime: null, endsOn: "2026-09-05" },
      participants: [],
    };
    expect(entrySheet(record, context).sections[0]).toMatchObject({
      fields: [
        { label: "Date", value: "on 2026-09-03" },
        { label: "Time", value: "All day" },
        { label: "Ends", value: "on 2026-09-05" },
        { label: "Time Zone", value: "(UTC-04:00) Eastern Daylight Time · New York" },
      ],
    });
  });

  it("leaves out what was not recorded, and carries a cancellation's reason", () => {
    const record: EntryRecord = {
      kind: "event",
      event: {
        ...event,
        locationText: null,
        conferenceUrl: null,
        recurrenceRule: null,
        courtReference: null,
        status: "cancelled",
        statusReason: "Settled",
      },
      participants: [],
    };
    const sheet = entrySheet(record, { ...context, typeName: null, matterNumber: null });
    expect(sheet.subtitle ?? "").toBe("");
    expect(sheet.sections.map((section) => section.id)).toEqual(["when", "facts"]);
    expect(sheet.sections[1]).toMatchObject({
      fields: [
        { label: "Location", value: "Not recorded" },
        { label: "Conference Link", value: "Not recorded" },
        { label: "Court Reference", value: "Not recorded" },
        { label: "Status", value: "Cancelled" },
        { label: "Reason", value: "Settled" },
      ],
    });
  });
});

describe("a firm event's sheet", () => {
  it("states when, the audience, office, venue and status, under the type's name", () => {
    const record: EntryRecord = { kind: "firmEvent", event: firmEvent, participants: [lead] };
    expect(
      entrySheet(record, { ...context, typeName: "Firm meeting", officeName: "Boston" }),
    ).toEqual({
      heading: "Firm Event",
      reference: "All hands",
      subtitle: "Firm meeting",
      sections: [
        {
          id: "when",
          kind: "fields",
          fields: [
            { label: "Date", value: "on 2026-09-04" },
            { label: "Time", value: "All day" },
            { label: "Time Zone", value: "(UTC-04:00) Eastern Daylight Time · New York" },
          ],
        },
        {
          id: "facts",
          kind: "fields",
          fields: [
            { label: "Audience", value: "Everyone" },
            { label: "Office", value: "Boston" },
            { label: "Location", value: "Not recorded" },
            { label: "Conference Link", value: "Not recorded" },
            { label: "Status", value: "Scheduled" },
          ],
        },
      ],
      footer,
    });
  });

  it("lists the participants only when the audience is them", () => {
    const record: EntryRecord = {
      kind: "firmEvent",
      event: { ...firmEvent, audience: "participants", locationText: "Boardroom" },
      participants: [lead],
    };
    const sheet = entrySheet(record, { ...context, typeName: null });
    expect(sheet.subtitle).toBeUndefined();
    expect(sheet.sections.map((section) => section.id)).toEqual(["when", "facts", "participants"]);
    expect(sheet.sections[1]).toMatchObject({
      fields: [
        { label: "Audience", value: "Participants" },
        { label: "Office", value: "Not recorded" },
        { label: "Location", value: "Boardroom" },
        { label: "Conference Link", value: "Not recorded" },
        { label: "Status", value: "Scheduled" },
      ],
    });
    expect(sheet.sections[2]).toMatchObject({
      title: "Participants",
      fields: [{ label: "Lead", value: "user_1" }],
    });
    expect(
      entrySheet({ ...record, participants: [] }, context).sections.map((section) => section.id),
    ).toEqual(["when", "facts"]);
  });

  it("carries the description as prose, and a cancellation's reason as a fact", () => {
    const record: EntryRecord = {
      kind: "firmEvent",
      event: {
        ...firmEvent,
        description: "Bring questions.",
        status: "cancelled",
        statusReason: "Weather",
      },
      participants: [],
    };
    const sheet = entrySheet(record, context);
    expect(sheet.sections[1]).toMatchObject({
      fields: [
        { label: "Audience", value: "Everyone" },
        { label: "Office", value: "Not recorded" },
        { label: "Location", value: "Not recorded" },
        { label: "Conference Link", value: "Not recorded" },
        { label: "Status", value: "Cancelled" },
        { label: "Reason", value: "Weather" },
      ],
    });
    expect(sheet.sections[2]).toEqual({
      id: "description",
      kind: "text",
      title: "Description",
      text: "Bring questions.",
    });
  });
});
