import { describe, expect, it } from "vitest";
import {
  deadlineDraftFrom,
  deadlineDraftReady,
  deadlineDraftRequest,
  deadlineDraftShortfalls,
  deadlineDraftStarted,
  emptyDeadlineDraft,
} from "$lib/calendar/deadline-draft.ts";
import {
  emptyEventDraft,
  entityParticipant,
  eventDraftReady,
  eventDraftRequest,
  eventDraftShortfalls,
  eventDraftStarted,
  externalParticipant,
  memberParticipant,
} from "$lib/calendar/event-draft.ts";
import {
  emptyFirmEventDraft,
  firmEventDraftRequest,
  firmEventDraftShortfalls,
} from "$lib/calendar/firm-event-draft.ts";
import { timeZoneOptions } from "$lib/calendar/time-zone-options.ts";

describe("the event draft", () => {
  it("needs a title, a date and a zone, in that order", () => {
    const draft = emptyEventDraft("");
    expect(eventDraftShortfalls(draft)).toEqual([
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
      courtReference: null,
      participants: [],
    });
  });

  it("refuses the contradictions and the unreadable", () => {
    const base = { ...emptyEventDraft("America/New_York"), title: "Trial", startsOn: "2026-09-14" };
    expect(eventDraftShortfalls({ ...base, endsOn: "2026-09-13" })).toEqual([
      "The end date is before the start.",
    ]);
    expect(eventDraftShortfalls({ ...base, startsAtTime: "9am" })).toEqual([
      "The start time does not read as a time of day.",
    ]);
    expect(eventDraftShortfalls({ ...base, startsAtTime: "10:00", endsAtTime: "09:30" })).toEqual([
      "The end time is not after the start time.",
    ]);
    expect(
      eventDraftShortfalls({
        ...base,
        startsAtTime: "10:00",
        endsOn: "2026-09-15",
        endsAtTime: "09:30",
      }),
    ).toEqual([]);
    expect(eventDraftShortfalls({ ...base, timeZone: "+05:00" })).toEqual([
      "The time zone is not one a date can be read in.",
    ]);
    expect(eventDraftShortfalls({ ...base, timeZone: "Mars/Olympus" })).toEqual([
      "The time zone is not one a date can be read in.",
    ]);
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
    expect(deadlineDraftShortfalls(emptyDeadlineDraft(""))).toEqual([
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
    expect(deadlineDraftShortfalls({ ...draft, priority: "12" })).toEqual([
      "Priority is a whole number from 1 to 9.",
    ]);
    expect(deadlineDraftShortfalls({ ...draft, dueAtTime: "5pm" })).toEqual([
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
    expect(firmEventDraftShortfalls(draft)).toEqual([]);
    expect(firmEventDraftRequest(draft)).toMatchObject({
      audience: "all_members",
      participants: [],
    });
    expect(firmEventDraftRequest({ ...draft, audience: "participants" }).participants).toHaveLength(
      1,
    );
    expect(firmEventDraftShortfalls({ ...draft, endsOn: "2026-09-06" })).toEqual([
      "The end date is before the start.",
    ]);
  });
});

describe("timeZoneOptions", () => {
  it("offers the preferred zones first, once each, drops what cannot resolve, then the rest", () => {
    const options = timeZoneOptions(
      ["America/New_York", "+05:00", "America/New_York", "America/Los_Angeles"],
      ["America/Chicago", "America/Los_Angeles", "Europe/London"],
    );
    expect(options.map((option) => option.value)).toEqual([
      "America/New_York",
      "America/Los_Angeles",
      "America/Chicago",
      "Europe/London",
    ]);
    expect(options[0]?.label).toBe("America / New York");
  });
});
