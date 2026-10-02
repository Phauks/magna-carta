import { describe, expect, it } from "vitest";
import { shortfallSentences } from "$lib/calendar/shortfall.ts";
import {
  deadlineDraftFrom,
  deadlineDraftReady,
  deadlineDraftRequest,
  deadlineDraftShortfalls,
  deadlineDraftStarted,
  emptyDeadlineDraft,
} from "$lib/calendar/deadline-draft.ts";
import {
  asAllDay,
  conferenceShortfalls,
  emptyEventDraft,
  entityParticipant,
  eventDraftReady,
  eventDraftRequest,
  eventDraftShortfalls,
  eventDraftStarted,
  eventFormTabOf,
  externalParticipant,
  memberParticipant,
  participantsBySource,
  readsAsAllDay,
  recurrenceChanged,
  withMemberListed,
} from "$lib/calendar/event-draft.ts";
import {
  emptyFirmEventDraft,
  firmEventDraftRequest,
  firmEventDraftShortfalls,
} from "$lib/calendar/firm-event-draft.ts";
import { weeklyRecurrence } from "@magna-carta/civil-time/recurrence";
import { matchingTimeZones, timeZoneOptions } from "$lib/calendar/time-zone-options.ts";

describe("the event draft", () => {
  it("needs a title, a date and a zone, in that order", () => {
    const draft = emptyEventDraft("");
    expect(shortfallSentences(eventDraftShortfalls(draft))).toEqual([
      "A title is needed.",
      "A date is needed.",
      "A time zone is needed: the one the event happens in.",
    ]);
    expect(eventDraftReady(draft)).toBe(false);
  });

  it("is ready with the three answers and nothing else", () => {
    const draft = {
      ...emptyEventDraft("America/New_York"),
      title: "Hearing",
      startsOn: "2026-09-14",
    };
    expect(eventDraftReady(draft)).toBe(true);
    expect(eventDraftRequest(draft)).toEqual({
      title: "Hearing",
      eventTypeId: null,
      description: null,
      startsOn: "2026-09-14",
      startsAtTime: null,
      endsOn: null,
      endsAtTime: null,
      timeZone: "America/New_York",
      locationText: null,
      conferenceUrl: null,
      courtReference: null,
      recurrenceRule: null,
      participants: [],
      // A hearing happens in a courtroom: no meeting is the answer for almost every event, and it
      // is sent as null rather than omitted so it cannot be read as an older client.
      meeting: null,
    });
  });

  it("refuses the contradictions and the unreadable", () => {
    const base = { ...emptyEventDraft("America/New_York"), title: "Trial", startsOn: "2026-09-14" };
    expect(shortfallSentences(eventDraftShortfalls({ ...base, endsOn: "2026-09-13" }))).toEqual([
      "The end date is before the start.",
    ]);
    expect(shortfallSentences(eventDraftShortfalls({ ...base, startsAtTime: "9am" }))).toEqual([
      "The start time does not read as a time of day.",
    ]);
    expect(
      shortfallSentences(
        eventDraftShortfalls({ ...base, startsAtTime: "10:00", endsAtTime: "09:30" }),
      ),
    ).toEqual(["The end time is not after the start time."]);
    expect(
      shortfallSentences(
        eventDraftShortfalls({
          ...base,
          startsAtTime: "10:00",
          endsOn: "2026-09-15",
          endsAtTime: "09:30",
        }),
      ),
    ).toEqual([]);
    expect(shortfallSentences(eventDraftShortfalls({ ...base, timeZone: "+05:00" }))).toEqual([
      "The time zone is not one a date can be read in.",
    ]);
    expect(shortfallSentences(eventDraftShortfalls({ ...base, timeZone: "Mars/Olympus" }))).toEqual(
      ["The time zone is not one a date can be read in."],
    );
  });

  it("sends each participant shape as the contract names it", () => {
    const draft = {
      ...emptyEventDraft("America/New_York"),
      title: "Deposition",
      startsOn: "2026-09-14",
      participants: [
        memberParticipant("user_1", "Ines Trewin"),
        { ...entityParticipant("directoryPerson_1", "Hon. R. Achebe"), role: "Judge" },
        externalParticipant("  Court reporter  "),
      ],
    };
    expect(eventDraftRequest(draft).participants).toEqual([
      {
        participantKind: "member",
        memberUserId: "user_1",
        entityId: null,
        participantName: null,
        role: null,
      },
      {
        participantKind: "entity",
        memberUserId: null,
        entityId: "directoryPerson_1",
        participantName: null,
        role: "Judge",
      },
      {
        participantKind: "external",
        memberUserId: null,
        entityId: null,
        participantName: "Court reporter",
        role: null,
      },
    ]);
    expect(externalParticipant("Court Reporter").key).toBe(
      externalParticipant("court reporter").key,
    );
  });

  it("knows whether anything was typed, including a role on a chip", () => {
    const since = emptyEventDraft("America/New_York");
    expect(eventDraftStarted({ ...since }, since)).toBe(false);
    expect(eventDraftStarted({ ...since, title: "x" }, since)).toBe(true);
    const withPerson = { ...since, participants: [memberParticipant("user_1", "A")] };
    expect(eventDraftStarted(withPerson, since)).toBe(true);
    expect(
      eventDraftStarted(
        { ...withPerson, participants: [{ ...withPerson.participants[0]!, role: "Counsel" }] },
        withPerson,
      ),
    ).toBe(true);
  });
});

describe("the deadline draft", () => {
  it("needs a title, a due date and a zone", () => {
    expect(shortfallSentences(deadlineDraftShortfalls(emptyDeadlineDraft("")))).toEqual([
      "A title is needed.",
      "A due date is needed.",
      "A time zone is needed: the one the deadline is measured in.",
    ]);
  });

  it("keeps the authority optional and the hour optional, and bounds the priority", () => {
    const draft = {
      ...emptyDeadlineDraft("America/Los_Angeles"),
      title: "Response due",
      dueOn: "2026-09-10",
    };
    expect(deadlineDraftReady(draft)).toBe(true);
    expect(
      deadlineDraftRequest({ ...draft, dueAtTime: "17:00", priority: "2", source: "court_order" }),
    ).toEqual({
      title: "Response due",
      dueOn: "2026-09-10",
      dueAtTime: "17:00",
      timeZone: "America/Los_Angeles",
      source: "court_order",
      authorityText: null,
      triggerEventId: null,
      priority: 2,
    });
    expect(shortfallSentences(deadlineDraftShortfalls({ ...draft, priority: "12" }))).toEqual([
      "Priority is a whole number from 1 to 9.",
    ]);
    expect(shortfallSentences(deadlineDraftShortfalls({ ...draft, dueAtTime: "5pm" }))).toEqual([
      "The time does not read as a time of day.",
    ]);
  });

  it("reads a recorded deadline back into a draft and sees no change until one is made", () => {
    const draft = deadlineDraftFrom({
      id: "d",
      matterId: "m",
      title: "Reply brief",
      dueOn: "2026-10-01",
      dueAtTime: null,
      timeZone: "America/New_York",
      source: "court_order",
      authorityText: "Scheduling order of 2026-08-01",
      triggerEventId: "matterEvent_1",
      state: "open",
      satisfiedAt: null,
      satisfiedBy: null,
      satisfyingEventId: null,
      stateReason: null,
      priority: 3,
      overdue: false,
    });
    expect(draft).toMatchObject({ source: "court_order", priority: "3", dueAtTime: "" });
    expect(deadlineDraftStarted({ ...draft }, draft)).toBe(false);
    expect(deadlineDraftStarted({ ...draft, priority: "1" }, draft)).toBe(true);
  });
});

describe("the firm event draft", () => {
  it("shares the timing rules and sends no participants for an all-members audience", () => {
    const draft = {
      ...emptyFirmEventDraft("America/New_York"),
      title: "Closed for the holiday",
      startsOn: "2026-09-07",
      audience: "all_members" as const,
      participants: [memberParticipant("user_1", "A")],
    };
    expect(shortfallSentences(firmEventDraftShortfalls(draft))).toEqual([]);
    expect(firmEventDraftRequest(draft)).toMatchObject({
      audience: "all_members",
      participants: [],
    });
    expect(firmEventDraftRequest({ ...draft, audience: "participants" }).participants).toHaveLength(
      1,
    );
    expect(
      shortfallSentences(firmEventDraftShortfalls({ ...draft, endsOn: "2026-09-06" })),
    ).toEqual(["The end date is before the start."]);
  });
});

describe("timeZoneOptions", () => {
  const JANUARY = new Date("2026-01-15T12:00:00Z");

  it("offers the preferred zones first, once each, drops what cannot resolve, then the rest", () => {
    const options = timeZoneOptions(
      ["America/New_York", "+05:00", "America/New_York", "America/Los_Angeles"],
      ["Europe/London", "America/Chicago", "America/Los_Angeles", "Asia/Kolkata"],
      JANUARY,
    );
    // The rest run west to east, whatever order the runtime listed them in.
    expect(options.map((option) => option.value)).toEqual([
      "America/New_York",
      "America/Los_Angeles",
      "America/Chicago",
      "Europe/London",
      "Asia/Kolkata",
    ]);
  });

  it("reads every zone as the same line: the offset from UTC, the name on the day, the place", () => {
    const options = timeZoneOptions([], ["America/Los_Angeles", "Asia/Kolkata"], JANUARY);
    expect(options.map((option) => option.label)).toEqual([
      "(UTC-08:00) Pacific Standard Time · Los Angeles",
      "(UTC+05:30) India Standard Time · Kolkata",
    ]);
  });

  it("is found by its code, its name, its place, its offset or its identifier", () => {
    const options = timeZoneOptions(
      [],
      ["America/Los_Angeles", "America/Chicago", "Asia/Kolkata"],
      JANUARY,
    );
    const found = (query: string) =>
      matchingTimeZones(options, query).map((option) => option.value);
    expect(found("PST")).toEqual(["America/Los_Angeles"]);
    expect(found("pacific")).toEqual(["America/Los_Angeles"]);
    expect(found("los angeles")).toEqual(["America/Los_Angeles"]);
    expect(found("los_angeles")).toEqual(["America/Los_Angeles"]);
    expect(found("-06")).toEqual(["America/Chicago"]);
    expect(found("standard time")).toEqual([
      "America/Los_Angeles",
      "America/Chicago",
      "Asia/Kolkata",
    ]);
    expect(found("")).toHaveLength(3);
    expect(found("mars")).toEqual([]);
  });
});

describe("a conference link", () => {
  it("is optional, and an empty one refuses nothing", () => {
    expect(shortfallSentences(conferenceShortfalls(""))).toEqual([]);
    expect(shortfallSentences(conferenceShortfalls("   "))).toEqual([]);
  });

  it("takes a web address", () => {
    expect(shortfallSentences(conferenceShortfalls("https://example.test/j/123"))).toEqual([]);
    expect(shortfallSentences(conferenceShortfalls("http://example.test/room"))).toEqual([]);
  });

  it("refuses what is not one, rather than storing a link nobody can follow", () => {
    // The one moment a conference link is read is the moment somebody is late for the meeting.
    expect(shortfallSentences(conferenceShortfalls("zoom us"))).toEqual([
      "The conference link does not read as a web address.",
    ]);
    expect(shortfallSentences(conferenceShortfalls("javascript:alert(1)"))).toEqual([
      "The conference link has to be a web address.",
    ]);
  });

  it("holds the whole event back while it is wrong", () => {
    const draft = {
      ...emptyEventDraft("America/New_York", "2026-09-15"),
      title: "Deposition",
      conferenceUrl: "not a link",
    };
    expect(eventDraftReady(draft)).toBe(false);
    expect(shortfallSentences(eventDraftShortfalls(draft))).toContain(
      "The conference link does not read as a web address.",
    );
  });
});

describe("a repeat on a draft", () => {
  it("sends no rule where the setting happens once", () => {
    const draft = { ...emptyEventDraft("America/New_York", "2026-09-15"), title: "Deposition" };
    expect(draft.recurrence).toBeNull();
    expect(eventDraftRequest(draft).recurrenceRule).toBeNull();
    expect(
      firmEventDraftRequest(emptyFirmEventDraft("America/New_York")).recurrenceRule,
    ).toBeNull();
  });

  it("writes the answer out as the stored line, on both kinds of event", () => {
    const recurrence = { ...weeklyRecurrence(), interval: 2, weekdays: ["TU"] as const };
    const event = {
      ...emptyEventDraft("America/New_York", "2026-09-15"),
      title: "Status conference",
      recurrence,
    };
    expect(eventDraftRequest(event).recurrenceRule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
    const firmEvent = {
      ...emptyFirmEventDraft("America/New_York", "2026-09-15"),
      title: "Partners meeting",
      recurrence,
    };
    expect(firmEventDraftRequest(firmEvent).recurrenceRule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
  });

  it("does not call a difference the stored line cannot carry a change", () => {
    // Weekdays belong to a weekly rule. Ticking one under Monthly changes the line by nothing, so a
    // form that asked "discard your changes?" over it would be asking about nothing.
    const monthly = { ...weeklyRecurrence(), frequency: "monthly" as const };
    expect(recurrenceChanged(monthly, { ...monthly, weekdays: ["TU"] })).toBe(false);
    expect(recurrenceChanged(monthly, { ...monthly, interval: 2 })).toBe(true);
    expect(recurrenceChanged(null, monthly)).toBe(true);
    expect(recurrenceChanged(null, null)).toBe(false);
  });
});

describe("all day", () => {
  it("is a day with no hour on either end, and never a form with no day yet", () => {
    expect(readsAsAllDay(emptyEventDraft("America/Chicago"))).toBe(false);
    expect(readsAsAllDay(emptyEventDraft("America/Chicago", "2026-09-14"))).toBe(true);
    expect(
      readsAsAllDay({ ...emptyEventDraft("America/Chicago", "2026-09-14"), startsAtTime: "09:00" }),
    ).toBe(false);
  });

  it("is chosen by clearing the hours, which is what the record stores for it", () => {
    const timed = {
      ...emptyEventDraft("America/Chicago", "2026-09-14"),
      startsAtTime: "09:00",
      endsAtTime: "11:00",
    };
    const cleared = asAllDay(timed);
    expect(cleared.startsAtTime).toBe("");
    expect(cleared.endsAtTime).toBe("");
    expect(cleared.startsOn).toBe("2026-09-14");
    expect(readsAsAllDay(cleared)).toBe(true);
  });
});

describe("a staff member's own event", () => {
  it("lists them first and once, whether or not they were also picked", () => {
    const ada = memberParticipant("user_ada", "Ada Lovelace");
    const judge = externalParticipant("Judge Hale");
    expect(withMemberListed([judge], "user_ada", "Ada Lovelace")).toEqual([ada, judge]);
    expect(withMemberListed([judge, ada], "user_ada", "Ada Lovelace")).toEqual([ada, judge]);
    expect(withMemberListed([], "user_ada", "Ada Lovelace")).toEqual([ada]);
  });
});

describe("participants, bundled by where they came from", () => {
  it("groups Staff, then Directory, then Other, leaving out an empty source", () => {
    const ada = memberParticipant("user_ada", "Ada Lovelace");
    const client = entityParticipant("directoryPerson_1", "Rosalind Chase");
    const judge = externalParticipant("Judge Hale");
    expect(participantsBySource([judge, ada, client])).toEqual([
      { kind: "member", label: "Staff", participants: [ada] },
      { kind: "entity", label: "Directory", participants: [client] },
      { kind: "external", label: "Other", participants: [judge] },
    ]);
    expect(participantsBySource([judge]).map((bundle) => bundle.label)).toEqual(["Other"]);
    expect(participantsBySource([])).toEqual([]);
  });
});

describe("which tab an answer is on", () => {
  it("puts the timing on When, the link on Where, and the rest on Details", () => {
    expect(eventFormTabOf("startsOn")).toBe("when");
    expect(eventFormTabOf("timeZone")).toBe("when");
    expect(eventFormTabOf("conferenceUrl")).toBe("where");
    expect(eventFormTabOf("title")).toBe("details");
  });
});
