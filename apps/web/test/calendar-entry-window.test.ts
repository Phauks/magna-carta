import { describe, expect, it } from "vitest";
import { shortfallSentences } from "$lib/calendar/shortfall.ts";
import type {
  CalendarDeadline,
  CalendarEvent,
  EventLink,
  EventParticipant,
  FirmEvent,
} from "$lib/calendar/calendar-api.ts";
import { calendarManageRefusal, mayManageCalendar } from "$lib/calendar/calendar-permission.ts";
import { ENTRY_KIND_WORDS, PARTICIPANT_KIND_WORDS } from "$lib/calendar/calendar-vocabulary.ts";
import {
  continueDraftFrom,
  continueDraftRequest,
  continueDraftShortfalls,
  continueDraftStarted,
  emptyContinueDraft,
} from "$lib/calendar/continue-draft.ts";
import { civilDateValue, isWallClockTime, optionalText } from "$lib/calendar/draft-text.ts";
import {
  otherEnd,
  relateChoices,
  relatedLinksOf,
  unseenEndLabel,
} from "$lib/calendar/entry-links.ts";
import { entryRecordKindLine, type EntryRecord } from "$lib/calendar/entry-reference.ts";
import {
  deadlineUpdateOf,
  eventUpdateOf,
  firmEventUpdateOf,
  PARTICIPANTS_UNTOUCHED,
} from "$lib/calendar/entry-updates.ts";
import {
  deadlineRefusal,
  deadlineVerbRefusal,
  editRefusal,
  eventVerbRefusal,
  linkCount,
  participantCount,
  settingRefusal,
} from "$lib/calendar/entry-verbs.ts";
import { deadlineDraftFrom, deadlineDraftRequest } from "$lib/calendar/deadline-draft.ts";
import { eventDraftFrom, eventDraftRequest } from "$lib/calendar/event-draft.ts";
import { firmEventDraftFrom, firmEventDraftRequest } from "$lib/calendar/firm-event-draft.ts";

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

const participant: EventParticipant = {
  id: "eventParticipant_1",
  participantKind: "member",
  memberUserId: "user_1",
  entityId: null,
  participantName: null,
  role: "Lead",
};

const eventRecord: EntryRecord = { kind: "event", event, participants: [participant] };
const deadlineRecord: EntryRecord = { kind: "deadline", deadline };
const firmEventRecord: EntryRecord = { kind: "firmEvent", event: firmEvent, participants: [] };

const open = { record: eventRecord, reading: false, manageRefusal: undefined };

describe("the text the drafts read", () => {
  it("trims, and treats empty as nothing said", () => {
    expect(optionalText("  Courtroom 4 ")).toBe("Courtroom 4");
    expect(optionalText("   ")).toBeNull();
  });

  it("accepts a twenty-four-hour clock and nothing else", () => {
    expect(isWallClockTime("09:30")).toBe(true);
    expect(isWallClockTime("23:59")).toBe(true);
    expect(isWallClockTime("24:00")).toBe(false);
    expect(isWallClockTime("9:30")).toBe(false);
  });

  it("gives the picker a date, or nothing while the field is empty or half-entered", () => {
    expect(civilDateValue("2026-09-03")?.toString()).toBe("2026-09-03");
    expect(civilDateValue(null)).toBeUndefined();
    expect(civilDateValue("2026-09")).toBeUndefined();
  });
});

describe("what this account may do", () => {
  it("reads the permission off the session", () => {
    expect(mayManageCalendar({ permissions: ["calendar:manage"] })).toBe(true);
    expect(mayManageCalendar({ permissions: ["calendar:read"] })).toBe(false);
    expect(mayManageCalendar(null)).toBe(false);
  });

  it("answers in the order a reader meets the states", () => {
    expect(
      calendarManageRefusal("Recording on the calendar", {
        sessionSettled: false,
        session: null,
        mayManage: false,
      }),
    ).toBe("Reading your session.");
    expect(
      calendarManageRefusal("Recording on the calendar", {
        sessionSettled: true,
        session: null,
        mayManage: false,
      }),
    ).toBe("Your session could not be read, so nothing can be recorded.");
    expect(
      calendarManageRefusal("Recording on the calendar", {
        sessionSettled: true,
        session: {},
        mayManage: false,
      }),
    ).toBe(
      "Recording on the calendar needs the calendar:manage permission, which this account does not hold.",
    );
    expect(
      calendarManageRefusal("Recording on the calendar", {
        sessionSettled: true,
        session: {},
        mayManage: true,
      }),
    ).toBeUndefined();
  });
});

describe("which verbs a record's state allows", () => {
  it("refuses a setting that has occurred or been cancelled", () => {
    expect(settingRefusal("scheduled")).toBeUndefined();
    expect(settingRefusal("occurred")).toBe("This setting has already occurred.");
    expect(settingRefusal("cancelled")).toBe("This setting is already cancelled.");
  });

  it("refuses a deadline that is settled, naming its state", () => {
    expect(deadlineRefusal("open")).toBeUndefined();
    expect(deadlineRefusal("satisfied")).toBe("This deadline is already satisfied.");
    expect(deadlineRefusal("vacated")).toBe("This deadline is already vacated.");
  });

  it("puts the session's refusal before everything", () => {
    const refused = { ...open, manageRefusal: "Reading your session." };
    expect(editRefusal(refused)).toBe("Reading your session.");
    expect(eventVerbRefusal(refused)).toBe("Reading your session.");
    expect(deadlineVerbRefusal(refused)).toBe("Reading your session.");
  });

  it("says whether the record is still being read, or is not there", () => {
    expect(editRefusal({ record: null, reading: true, manageRefusal: undefined })).toBe(
      "Reading the record.",
    );
    expect(editRefusal({ record: null, reading: false, manageRefusal: undefined })).toBe(
      "There is no record to change.",
    );
    expect(eventVerbRefusal({ record: null, reading: false, manageRefusal: undefined })).toBe(
      "There is no record to act on.",
    );
  });

  it("opens Edit on a scheduled setting and an open deadline, and on nothing settled", () => {
    expect(editRefusal(open)).toBeUndefined();
    expect(editRefusal({ ...open, record: deadlineRecord })).toBeUndefined();
    expect(
      editRefusal({
        ...open,
        record: { kind: "deadline", deadline: { ...deadline, state: "satisfied" } },
      }),
    ).toBe("A settled deadline is kept as it was recorded.");
    expect(
      editRefusal({
        ...open,
        record: { kind: "event", event: { ...event, status: "cancelled" }, participants: [] },
      }),
    ).toBe("A cancelled setting is kept as it was recorded.");
  });

  it("keeps a setting's verbs and a deadline's verbs to their own kind", () => {
    expect(eventVerbRefusal(open)).toBeUndefined();
    expect(eventVerbRefusal({ ...open, record: deadlineRecord })).toBe("Not a setting.");
    expect(deadlineVerbRefusal({ ...open, record: deadlineRecord })).toBeUndefined();
    expect(deadlineVerbRefusal(open)).toBe("Not a deadline.");
    expect(eventVerbRefusal({ ...open, record: firmEventRecord })).toBeUndefined();
  });
});

describe("the counts on the tabs", () => {
  it("counts a setting's continuance ends with its related links", () => {
    expect(linkCount(eventRecord, 2)).toBe(2);
    expect(
      linkCount(
        {
          kind: "event",
          event: { ...event, continuedFromEventId: "matterEvent_0" },
          participants: [],
        },
        1,
      ),
    ).toBe(2);
  });

  it("counts a deadline's one trigger, and a firm event's related links alone", () => {
    expect(linkCount(deadlineRecord, 5)).toBe(0);
    expect(
      linkCount(
        { kind: "deadline", deadline: { ...deadline, triggerEventId: "matterEvent_1" } },
        5,
      ),
    ).toBe(1);
    expect(linkCount(firmEventRecord, 3)).toBe(3);
    expect(linkCount(null, 3)).toBeUndefined();
  });

  it("shows no participant count for a deadline or an all-members firm event", () => {
    expect(participantCount(eventRecord)).toBe(1);
    expect(participantCount(deadlineRecord)).toBeUndefined();
    expect(participantCount(firmEventRecord)).toBeUndefined();
    expect(
      participantCount({
        kind: "firmEvent",
        event: { ...firmEvent, audience: "participants" },
        participants: [participant, participant],
      }),
    ).toBe(2);
  });
});

describe("what a correction sends", () => {
  it("does not send a setting's participants when the window never touched them", () => {
    const request = eventDraftRequest(eventDraftFrom(event, [participant]));
    expect(request.participants).toHaveLength(1);
    const update = eventUpdateOf(request);
    expect(update).not.toHaveProperty("participants");
    expect(update).toEqual({
      eventTypeId: "eventType_hearing",
      title: "Status conference",
      description: null,
      startsOn: "2026-09-03",
      startsAtTime: "09:30",
      endsOn: null,
      endsAtTime: null,
      timeZone: "America/New_York",
      locationText: "Courtroom 4",
      conferenceUrl: null,
      recurrenceRule: null,
      courtReference: "26-CV-100",
    });
  });

  it("keeps a deadline's source frozen on the record", () => {
    const update = deadlineUpdateOf(deadlineDraftRequest(deadlineDraftFrom(deadline)));
    expect(update).not.toHaveProperty("source");
    expect(update.title).toBe("Discovery responses due");
    expect(update.dueOn).toBe("2026-09-10");
  });

  it("never re-sends a firm event's audience, and leaves its participants alone by default", () => {
    const update = firmEventUpdateOf(firmEventDraftRequest(firmEventDraftFrom(firmEvent, [])));
    expect(update).not.toHaveProperty("audience");
    expect(update).not.toHaveProperty("participants");
    expect(update.locationId).toBeNull();
  });

  it("sends the whole list once the participant pane was edited", () => {
    // Supplying participants replaces the list; omitting them leaves it alone. So a window that
    // DID touch who is at a setting has to send them, or adding somebody would silently do nothing.
    const request = eventDraftRequest(eventDraftFrom(event, [participant]));
    const update = eventUpdateOf(request, { edited: true });
    expect(update.participants).toEqual(request.participants);
  });

  it("sends a firm event's participants the same way", () => {
    const request = firmEventDraftRequest(firmEventDraftFrom(firmEvent, []));
    expect(firmEventUpdateOf(request, { edited: true }).participants).toEqual(request.participants);
    expect(firmEventUpdateOf(request, { edited: false })).not.toHaveProperty("participants");
  });

  it("sends an EMPTY list when the pane was edited down to nobody", () => {
    // Taking the last person off a setting is a real correction, and a projection that dropped an
    // empty list would make it the one edit that silently does nothing.
    const request = eventDraftRequest(eventDraftFrom(event, []));
    const update = eventUpdateOf(request, { edited: true });
    expect(update.participants).toEqual([]);
  });

  it("treats the untouched intent as the default", () => {
    const request = eventDraftRequest(eventDraftFrom(event, [participant]));
    expect(eventUpdateOf(request, PARTICIPANTS_UNTOUCHED)).toEqual(eventUpdateOf(request));
  });
});

describe("the continuance draft", () => {
  it("starts from the old setting's zone, times, place, link and court, with no date", () => {
    const draft = continueDraftFrom({ ...event, conferenceUrl: "https://example.test/hearing" });
    expect(draft.startsOn).toBeNull();
    expect(draft.startsAtTime).toBe("09:30");
    expect(draft.timeZone).toBe("America/New_York");
    expect(draft.locationText).toBe("Courtroom 4");
    // A continued hearing is the same hearing on a new date, so where it is joined carries over.
    expect(draft.conferenceUrl).toBe("https://example.test/hearing");
    expect(draft.courtReference).toBe("26-CV-100");
    expect(continueDraftStarted(draft)).toBe(false);
    expect(shortfallSentences(continueDraftShortfalls(draft))).toEqual(["A date is needed."]);
  });

  it("is ready once the new date is stated, and sends nothing for what was left blank", () => {
    const draft = { ...continueDraftFrom(event), startsOn: "2026-09-17", statusReason: "  " };
    expect(continueDraftStarted(draft)).toBe(true);
    expect(shortfallSentences(continueDraftShortfalls(draft))).toEqual([]);
    expect(continueDraftRequest(draft)).toEqual({
      startsOn: "2026-09-17",
      startsAtTime: "09:30",
      endsOn: null,
      endsAtTime: null,
      timeZone: "America/New_York",
      locationText: "Courtroom 4",
      conferenceUrl: null,
      courtReference: "26-CV-100",
      statusReason: null,
    });
  });

  it("shares the timing rules every event shares", () => {
    const draft = { ...emptyContinueDraft(), startsOn: "2026-09-17", startsAtTime: "9am" };
    expect(shortfallSentences(continueDraftShortfalls(draft))).toContain(
      "The start time does not read as a time of day.",
    );
  });
});

describe("the links a setting carries", () => {
  const related: EventLink = {
    id: "calendarEventLink_1",
    kind: "related",
    from: { matterEventId: "matterEvent_1", firmEventId: null },
    to: { matterEventId: "matterEvent_2", firmEventId: null },
    note: "Prep for the conference",
    createdAt: "2026-09-01T00:00:00Z",
  };
  const continuance: EventLink = { ...related, id: "calendarEventLink_2", kind: "continuance_of" };

  it("finds the end that is not this setting, from either side", () => {
    expect(otherEnd(related, { kind: "event", id: "matterEvent_1" })).toEqual({
      kind: "event",
      id: "matterEvent_2",
    });
    expect(otherEnd(related, { kind: "event", id: "matterEvent_2" })).toEqual({
      kind: "event",
      id: "matterEvent_1",
    });
    expect(otherEnd(related, { kind: "firmEvent", id: "firmEvent_9" })).toEqual({
      kind: "event",
      id: "matterEvent_1",
    });
  });

  it("reads a firm-event end as a firm event", () => {
    const crossKind: EventLink = {
      ...related,
      to: { matterEventId: null, firmEventId: "firmEvent_1" },
    };
    expect(otherEnd(crossKind, { kind: "event", id: "matterEvent_1" })).toEqual({
      kind: "firmEvent",
      id: "firmEvent_1",
    });
  });

  it("lists only the links related by hand", () => {
    expect(relatedLinksOf([related, continuance])).toEqual([related]);
  });

  it("offers every other setting not already related, dated", () => {
    const candidates = [
      { id: "matterEvent_1", startsOn: "2026-09-03", title: "Status conference" },
      { id: "matterEvent_2", startsOn: "2026-09-02", title: "Pre-hearing prep" },
      { id: "matterEvent_3", startsOn: "2026-10-01", title: "Trial" },
    ];
    expect(relateChoices(candidates, "matterEvent_1", new Set(["matterEvent_2"]))).toEqual([
      { value: "matterEvent_3", label: "2026-10-01 · Trial" },
    ]);
  });

  it("names an end this reader may not see by its kind alone", () => {
    expect(unseenEndLabel({ kind: "event", id: "x" })).toBe("A setting you cannot see");
    expect(unseenEndLabel({ kind: "firmEvent", id: "x" })).toBe("A firm event");
  });
});

describe("how the record's kind reads", () => {
  it("prefers the type's name, then the kind's own word", () => {
    const typeName = (): string | undefined => "Firm meeting";
    expect(entryRecordKindLine(eventRecord, "event", ENTRY_KIND_WORDS, typeName)).toBe("Hearing");
    expect(
      entryRecordKindLine(
        { kind: "event", event: { ...event, eventTypeName: null }, participants: [] },
        "event",
        ENTRY_KIND_WORDS,
        typeName,
      ),
    ).toBe("Event");
    expect(entryRecordKindLine(deadlineRecord, "deadline", ENTRY_KIND_WORDS, typeName)).toBe(
      "Deadline",
    );
    expect(entryRecordKindLine(firmEventRecord, "firmEvent", ENTRY_KIND_WORDS, typeName)).toBe(
      "Firm meeting",
    );
    expect(
      entryRecordKindLine(firmEventRecord, "firmEvent", ENTRY_KIND_WORDS, () => undefined),
    ).toBe("Firm Event");
    expect(entryRecordKindLine(null, "firmEvent", ENTRY_KIND_WORDS, typeName)).toBe("Firm Event");
  });

  it("names every participant kind", () => {
    expect(PARTICIPANT_KIND_WORDS).toEqual({
      member: "Staff",
      entity: "Directory",
      external: "Other",
    });
  });
});
