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
import { AvailabilityReads } from "$lib/calendar/availability-reads.svelte.ts";
import {
  availabilityEntryFromTimelineRow,
  type CalendarEntry,
  type EntryContext,
} from "$lib/calendar/calendar-entries.ts";
import type { TimelineEntry } from "$lib/calendar/calendar-api.ts";
import {
  emptyEventDraft,
  eventDraftFrom,
  eventDraftRequest,
  eventDraftStarted,
  eventFormTabOf,
  EVENT_FIELDS,
  isMeetingChoice,
  meetingGuestsSentence,
  meetingInput,
  memberParticipant,
  MEETING_LOBBY_LABEL,
  FIRM_MEETING_GUESTS_SENTENCE,
  MEETING_GUESTS_SENTENCE,
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
    expect(eventDraftRequest(draft("video")).meeting).toEqual({ medium: "video", lobby: "off" });
    expect(eventDraftRequest(draft("audio")).meeting).toEqual({ medium: "audio", lobby: "off" });
    // Null rather than absent: "no meeting" and "a client that has not heard of meetings" must not
    // be the same request.
    expect(eventDraftRequest(draft("none")).meeting).toBeNull();
    expect(meetingInput("none")).toBeNull();
  });

  it("sends it the same way on a firm event, because it is one form", () => {
    const firm = { ...emptyFirmEventDraft(ZONE, "2026-10-05", "audio"), title: "All-hands" };
    expect(firmEventDraftRequest(firm).meeting).toEqual({ medium: "audio", lobby: "off" });
    expect(firmEventDraftRequest(emptyFirmEventDraft(ZONE, "2026-10-05")).meeting).toBeNull();
  });

  it("opens the room with the door the reader asked for, on either arm", () => {
    // A standing the room STARTS with rather than a setting of the meeting's: a host changes it
    // from inside, and nothing before the room exists can be changed from inside it.
    expect(eventDraftRequest({ ...draft("video"), meetingLobby: "on" }).meeting).toEqual({
      medium: "video",
      lobby: "on",
    });
    const firm = {
      ...emptyFirmEventDraft(ZONE, "2026-10-05", "video"),
      title: "All-hands",
      meetingLobby: "on" as const,
    };
    expect(firmEventDraftRequest(firm).meeting).toEqual({ medium: "video", lobby: "on" });
  });

  it("sends the door only where a meeting is being opened at all", () => {
    // A lobby answer on an event with no meeting is an answer to a question nobody asked, and the
    // request would be carrying a standing for a room that does not exist.
    expect(eventDraftRequest({ ...draft("none"), meetingLobby: "on" }).meeting).toBeNull();
    expect(meetingInput("none", "on")).toBeNull();
  });

  it("rests OFF, because every participant today is already on the event", () => {
    // A lobby resting on would put a colleague in a queue for every ordinary hearing.
    expect(emptyEventDraft(ZONE, "2026-10-05", "video").meetingLobby).toBe("off");
    expect(emptyFirmEventDraft(ZONE, "2026-10-05", "video").meetingLobby).toBe("off");
  });

  it("counts a changed door as work worth asking about before closing", () => {
    const opened = draft("video");
    expect(eventDraftStarted({ ...opened, meetingLobby: "on" }, opened)).toBe(true);
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

/** Lets a read that has already resolved reach the bookkeeping that was waiting on it. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ANA = { userId: "user_a", displayName: "Ana Marsh" };
const DAY = "2026-10-05";

describe("the reads behind the availability line", () => {
  it("asks once per colleague and day, and asks again after a close and a reopen", async () => {
    // The answer is a claim about a particular hour of a particular day. A form reopened later is a
    // fresh question — the day may have filled up since — and a cached "Free" from an hour ago is
    // the one answer that would be believed without being checked.
    const asked: string[] = [];
    const reads = new AvailabilityReads();
    const answer = (userId: string, date: string) => {
      asked.push(`${userId}@${date}`);
      return Promise.resolve<readonly CalendarEntry[]>([]);
    };

    reads.refresh(true, [ANA], DAY, answer);
    await settled();
    reads.refresh(true, [ANA], DAY, answer);
    expect(asked).toEqual([`user_a@${DAY}`]);
    expect(reads.entriesFor("user_a", DAY)).toEqual([]);

    reads.refresh(false, [ANA], DAY, answer);
    // Nothing read survives the form closing, so nothing is painted from it either.
    expect(reads.entriesFor("user_a", DAY)).toBeUndefined();

    reads.refresh(true, [ANA], DAY, answer);
    expect(asked).toEqual([`user_a@${DAY}`, `user_a@${DAY}`]);
  });

  it("asks again after a read that did not come back", async () => {
    // A failure that stayed marked as asked meant the one thing that could never happen again was
    // asking: the line stayed blank for the rest of the form's life, with nothing saying why.
    const asked: string[] = [];
    const reads = new AvailabilityReads();
    let answers = false;
    const answer = (userId: string, date: string) => {
      asked.push(`${userId}@${date}`);
      return Promise.resolve<readonly CalendarEntry[] | null>(answers ? [] : null);
    };

    reads.refresh(true, [ANA], DAY, answer);
    await settled();
    // Blank rather than free: a read that did not come back claims nothing about the colleague.
    expect(reads.entriesFor("user_a", DAY)).toBeUndefined();

    answers = true;
    reads.refresh(true, [ANA], DAY, answer);
    await settled();

    expect(asked).toHaveLength(2);
    expect(reads.entriesFor("user_a", DAY)).toEqual([]);
  });

  it("does not fill in a form that closed while the read was still in flight", async () => {
    const reads = new AvailabilityReads();
    let release: (entries: readonly CalendarEntry[]) => void = () => {};
    const answer = () =>
      new Promise<readonly CalendarEntry[]>((resolve) => {
        release = resolve;
      });

    reads.refresh(true, [ANA], DAY, answer);
    reads.refresh(false, [ANA], DAY, answer);
    release([]);
    await settled();

    expect(reads.entriesFor("user_a", DAY)).toBeUndefined();
  });
});

const AVAILABILITY_CONTEXT: EntryContext = {
  matterNumbers: new Map(),
  eventTypesByCode: new Map(),
  readerTimeZone: ZONE,
};

function timelineRow(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    sourceKey: "firmEvent",
    kind: "firmEvent",
    sortKey: DAY,
    rowId: "firmEvent_1",
    matterId: null,
    actorUserId: null,
    label: "Firm meeting · all_members",
    link: "/calendar/firm-events?entry=firmEvent_1",
    timeOfDay: "10:00",
    timeZone: ZONE,
    ...overrides,
  };
}

describe("a firm event on a colleague's day", () => {
  it("reads as busy rather than as free", () => {
    // The grid skips a federated firm-event row because the firm's own listing is read beside it
    // and carries the title. Availability has no second read to defer to, so dropping the row put
    // "Free" beside somebody sitting in a firm-wide training.
    const entry = availabilityEntryFromTimelineRow(timelineRow({}), AVAILABILITY_CONTEXT);
    expect(entry).not.toBeNull();
    if (entry === null) return;
    expect(entry.kind).toBe("firmEvent");
    expect(entry.recordId).toBe("firmEvent_1");
    // The source's own declared label, with the audience read into the product's word. Never a
    // title: what a firm event is called is not the platform's to put on another form.
    expect(entry.label).toBe("Firm meeting · Everyone");

    expect(busyLabels([entry], { date: DAY, startMinute: 600, endMinute: 660 })).toEqual([
      "Firm meeting · Everyone",
    ]);
  });

  it("says what it can where the source declared no type, and paints an unknown word as it came", () => {
    const untyped = availabilityEntryFromTimelineRow(
      timelineRow({ label: "participants" }),
      AVAILABILITY_CONTEXT,
    );
    expect(untyped?.label).toBe("Firm event · Participants");

    // A source that has learned an audience this build has not should read oddly rather than be
    // dropped: a colleague who is busy is busy whatever the word beside it says.
    const unknown = availabilityEntryFromTimelineRow(
      timelineRow({ label: "Firm meeting · partners_only" }),
      AVAILABILITY_CONTEXT,
    );
    expect(unknown?.label).toBe("Firm meeting · partners_only");
  });

  it("leaves every other row to the projection the grid already uses", () => {
    const hearing = availabilityEntryFromTimelineRow(
      timelineRow({
        sourceKey: "matterEvent",
        kind: "event",
        label: "HEARING",
        matterId: "matter_1",
      }),
      AVAILABILITY_CONTEXT,
    );
    expect(hearing?.kind).toBe("event");
    // A deadline is still skipped: it is read by its own path, which carries its title.
    expect(
      availabilityEntryFromTimelineRow(timelineRow({ kind: "deadline" }), AVAILABILITY_CONTEXT),
    ).toBeNull();
  });
});

const MEETINGS_PAGE = readFileSync(
  fileURLToPath(new URL("../src/routes/(app)/meetings/+page.svelte", import.meta.url)),
  "utf8",
);

const EVENT_FORM = readFileSync(
  fileURLToPath(new URL("../src/lib/calendar/record-event-dialog.svelte", import.meta.url)),
  "utf8",
);

const ENTRY_ACTION = readFileSync(
  fileURLToPath(new URL("../src/lib/meetings/meeting-entry-action.svelte", import.meta.url)),
  "utf8",
);

describe("what the form promises about who is told", () => {
  it("says the colleagues on a matter event are invited, and that a client is not", () => {
    expect(meetingGuestsSentence("matter")).toBe(MEETING_GUESTS_SENTENCE);
    expect(MEETING_GUESTS_SENTENCE).toContain("invited");
  });

  it("says a firm meeting tells nobody, because nothing sends that message yet", () => {
    // The notification subject an invitation is written against has no firm-event value, and
    // widening it is a rebuild of a table that cannot be rebuilt against a firm database holding
    // data. The meeting is scheduled, created, joinable and on everybody's calendar; it is the
    // telling that waits. A form promising an invitation here would stop a member short of the one
    // thing that actually gets their colleagues into the room, which is telling them.
    for (const owner of ["firm", "staff"] as const) {
      const said = meetingGuestsSentence(owner);
      expect(said).toBe(FIRM_MEETING_GUESTS_SENTENCE);
      expect(said).not.toContain("invited");
      expect(said).toContain("tell the people on it yourself");
    }
  });

  it("renders the sentence the record it is about to write earns", () => {
    // The one wiring fact with no value to assert it through: which of the two sentences the form
    // puts on the screen. A regression here is a promise the product does not keep.
    expect(EVENT_FORM).toContain("meetingGuestsSentence(owner)");
  });
});

describe("the door the event form opens a room with", () => {
  it("is asked beside the Meeting choice, in the one home the words are written in", () => {
    // The same question is asked at the other door into a room — Start on a recorded entry — and
    // two spellings of one control is how a reader learns that two parts of one product were
    // written by two people.
    expect(EVENT_FORM).toContain("MEETING_LOBBY_LABEL");
    expect(ENTRY_ACTION).toContain("MEETING_LOBBY_LABEL");
    expect(MEETING_LOBBY_LABEL).toBe("Hold arrivals in a lobby");
  });

  it("is asked only once a meeting has been chosen", () => {
    // It sits inside the branch the guests sentence sits in: a door means nothing without a room.
    const where = EVENT_FORM.slice(EVENT_FORM.indexOf('{#if draft.meeting !== "none"}'));
    expect(where.indexOf("MEETING_LOBBY_LABEL")).toBeGreaterThan(-1);
    expect(where.indexOf("MEETING_LOBBY_LABEL")).toBeLessThan(where.indexOf("{/if}"));
  });
});

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
