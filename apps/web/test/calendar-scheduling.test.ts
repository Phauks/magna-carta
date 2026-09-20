/*
 * SCHEDULING A MEETING IS RECORDING AN EVENT WITH A MEDIUM ON IT, and every decision that follows
 * from that is a pure function — what the form sends, which tab the question is on, whether a
 * correction may take a room away, and what a colleague's busy line says. None of it needs a
 * browser, which is the module's own rule: a Svelte file renders these answers and decides none of
 * them.
 *
 * The two source scans at the end are the exception and earn it. The Meetings page's contribution
 * is entirely a WIRING decision — that the screen offers the act at all, and that it opens the form
 * already set to a video meeting — and there is no value to assert it through. A regression there
 * removes the way in from a screen whose whole reason for existing is getting back to a room.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "$lib/calendar/calendar-entries.ts";
import {
  emptyEventDraft,
  eventDraftFrom,
  eventDraftRequest,
  eventDraftStarted,
  eventFormTabOf,
  EVENT_FIELDS,
  isMeetingChoice,
  meetingInput,
  memberParticipant,
  entityParticipant,
  externalParticipant,
  MEETING_CHOICE_OPTIONS,
} from "$lib/calendar/event-draft.ts";
import { emptyFirmEventDraft, firmEventDraftRequest } from "$lib/calendar/firm-event-draft.ts";
import { eventUpdateOf, firmEventUpdateOf } from "$lib/calendar/entry-updates.ts";
import {
  availabilitySentence,
  busyLabels,
  memberParticipantsOf,
  proposedOccurrenceOf,
} from "$lib/calendar/member-availability.ts";
import type { CalendarEvent } from "$lib/calendar/calendar-api.ts";

const ZONE = "America/Los_Angeles";

function draft(meeting: "none" | "video" | "audio" = "none") {
  return {
    ...emptyEventDraft(ZONE, "2026-10-05", meeting),
    title: "Deposition preparation",
    startsAtTime: "10:00",
    endsAtTime: "11:00",
  };
}

describe("the meeting an event carries", () => {
  it("offers exactly three answers, and None is one of them", () => {
    // None is an ANSWER rather than the absence of one: almost every event a firm records happens
    // in a courtroom, and a control whose only options were the two media would read as a form
    // asking which kind of meeting a filing is.
    expect(MEETING_CHOICE_OPTIONS.map((option) => option.value)).toEqual([
      "none",
      "video",
      "audio",
    ]);
    expect(isMeetingChoice("video")).toBe(true);
    expect(isMeetingChoice("telepathy")).toBe(false);
  });

  it("sends the medium the reader chose, and null where they chose none", () => {
    expect(eventDraftRequest(draft("video")).meeting).toEqual({ medium: "video" });
    expect(eventDraftRequest(draft("audio")).meeting).toEqual({ medium: "audio" });
    // Null rather than absent: "no meeting" and "a client that has not heard of meetings" must not
    // be the same request.
    expect(eventDraftRequest(draft("none")).meeting).toBeNull();
    expect(meetingInput("none")).toBeNull();
  });

  it("sends it the same way on a firm event, because it is one form", () => {
    const firm = { ...emptyFirmEventDraft(ZONE, "2026-10-05", "audio"), title: "All-hands" };
    expect(firmEventDraftRequest(firm).meeting).toEqual({ medium: "audio" });
    expect(firmEventDraftRequest(emptyFirmEventDraft(ZONE, "2026-10-05")).meeting).toBeNull();
  });

  it("puts the question on Where, beside the link it stands in for", () => {
    expect(eventFormTabOf(EVENT_FIELDS.meeting)).toBe("where");
    expect(eventFormTabOf(EVENT_FIELDS.conferenceUrl)).toBe("where");
  });

  it("counts a changed answer as work worth asking about before closing", () => {
    const opened = draft("none");
    expect(eventDraftStarted(opened, opened)).toBe(false);
    expect(eventDraftStarted({ ...opened, meeting: "video" }, opened)).toBe(true);
  });

  it("opens a recorded event on None, because a correction can only ever ADD a room", () => {
    // The meeting is a row of its own, read beside the event rather than off it, and ending one is
    // an act with its own route. A draft that opened on the recorded medium would offer a reader
    // the one gesture this form must not have: taking a gathering off an event by editing it.
    const recorded = {
      title: "Deposition",
      eventTypeId: null,
      description: null,
      startsOn: "2026-10-05",
      startsAtTime: "10:00",
      endsOn: null,
      endsAtTime: null,
      timeZone: ZONE,
      locationText: null,
      conferenceUrl: null,
      courtReference: null,
      recurrenceRule: null,
    } as unknown as CalendarEvent;
    expect(eventDraftFrom(recorded, []).meeting).toBe("none");
  });

  it("never lets a correction from the entry window touch the meeting at all", () => {
    // The window's Edit sends the fields its pane edits and nothing else. A meeting reaching the
    // update from here would open a room as a side effect of moving a hearing.
    expect("meeting" in eventUpdateOf(eventDraftRequest(draft("video")))).toBe(false);
    const firm = { ...emptyFirmEventDraft(ZONE, "2026-10-05", "video"), title: "All-hands" };
    expect("meeting" in firmEventUpdateOf(firmEventDraftRequest(firm))).toBe(false);
  });
});

function entry(overrides: Partial<CalendarEntry> & { id: string }): CalendarEntry {
  return {
    date: "2026-10-05",
    label: "Hearing",
    tone: "neutral",
    kind: "event",
    sourceKeys: [],
    recordId: overrides.id,
    matterId: null,
    link: null,
    settled: false,
    ...overrides,
  } as CalendarEntry;
}

describe("who is already busy at the hour the form proposes", () => {
  it("asks about colleagues and about nobody else", () => {
    // A Directory contact and somebody named once have no calendar here to read, and an external
    // guest has no way into the room either.
    const participants = [
      memberParticipant("user_a", "Ana Marsh"),
      entityParticipant("directoryPerson_c", "The client"),
      externalParticipant("Hon. A. Judge"),
      memberParticipant("user_a", "Ana Marsh"),
    ];
    expect(memberParticipantsOf(participants)).toEqual([
      { userId: "user_a", displayName: "Ana Marsh" },
    ]);
  });

  it("asks about one day and says nothing before a day has been chosen", () => {
    expect(proposedOccurrenceOf(draft("video"))).toEqual({
      date: "2026-10-05",
      startMinute: 600,
      endMinute: 660,
    });
    // All day: the hours are absent rather than midnight, so the comparison reads it as the whole
    // day it is.
    expect(proposedOccurrenceOf(emptyEventDraft(ZONE, "2026-10-05"))).toEqual({
      date: "2026-10-05",
      startMinute: undefined,
      endMinute: undefined,
    });
    expect(proposedOccurrenceOf(emptyEventDraft(ZONE, null))).toBeNull();
  });

  it("says what the grid paints, once per thing they are doing", () => {
    const occurrence = { date: "2026-10-05", startMinute: 600, endMinute: 660 };
    const entries = [
      entry({ id: "a", label: "Hearing", startMinute: 570, endMinute: 630 }),
      // The same hearing reaching the list twice — once as theirs, once as the firm's — is one
      // thing they are doing, and "Hearing, Hearing" reads as two.
      entry({ id: "b", label: "Hearing", startMinute: 600, endMinute: 660 }),
      entry({ id: "c", label: "Client meeting", startMinute: 610, endMinute: 640 }),
      // Well clear of the hour.
      entry({ id: "d", label: "Filing", startMinute: 900, endMinute: 960 }),
    ];
    expect(busyLabels(entries, occurrence)).toEqual(["Hearing", "Client meeting"]);
  });

  it("distinguishes free from not-yet-read, because only one of them is a claim", () => {
    const base = { userId: "user_a", displayName: "Ana Marsh" };
    expect(availabilitySentence({ ...base, busy: [], read: false })).toBeNull();
    expect(availabilitySentence({ ...base, busy: [], read: true })).toBe("Free");
    expect(availabilitySentence({ ...base, busy: ["Hearing"], read: true })).toBe("Busy: Hearing");
    expect(availabilitySentence({ ...base, busy: ["Hearing", "Trial"], read: true })).toBe(
      "Busy: Hearing, Trial",
    );
  });
});

const MEETINGS_PAGE = readFileSync(
  fileURLToPath(new URL("../src/routes/(app)/meetings/+page.svelte", import.meta.url)),
  "utf8",
);

describe("the Meetings page offers the act", () => {
  it("draws the product's one create control rather than a button of its own", () => {
    expect(MEETINGS_PAGE).toContain("CreateControl");
    expect(MEETINGS_PAGE).toContain('noun="Meeting"');
  });

  it("opens the calendar's own event form, preset to a video meeting", () => {
    // Never a second form: a meeting is a calendar event with a medium on it, and a scheduling
    // panel of this screen's own would be a second answer to every question the event form asks.
    expect(MEETINGS_PAGE).toContain("RecordEventDialog");
    expect(MEETINGS_PAGE).toContain('initialMeeting="video"');
  });
});
