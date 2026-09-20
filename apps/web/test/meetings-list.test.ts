// @vitest-environment happy-dom
/*
 * The Meetings screen's sections: what a row says, and what pressing it reaches.
 *
 * Two halves. The first is the presentation, which is pure and where the date rules actually bite —
 * the event's clock is read in the EVENT'S zone with its shortcode beside it, because a hearing at
 * nine in Denver is at nine for everybody who reads the entry, while when a meeting ENDED is an
 * instant and belongs to whoever is looking. The second mounts a section over fixed meetings, which
 * is what pins the parts no type can asserts: that a live row offers the room and an ended row
 * offers the event instead, that a meeting on a matter links to the matter and a firm meeting says
 * so in words, that a section with nothing in it states that inside its own table, and that a
 * failed read replaces the table rather than standing an empty one over the failure.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MeetingListSection from "../src/lib/meetings/meeting-list-section.svelte";
import MeetingsScreen from "../src/lib/meetings/meetings-screen.svelte";
import {
  matterAddress,
  meetingAddress,
  meetingColumns,
  meetingEnded,
  meetingWhen,
  meetingWhere,
  MEETING_COLUMN_IDENTIFIERS,
  MEETING_SECTIONS,
  MEETING_SCOPES,
  type MeetingScope,
} from "../src/lib/meetings/meeting-list.ts";
import type { MeetingSummary } from "@magna-carta/api-client";

function meeting(overrides: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    id: "meeting_1",
    eventKind: "matter",
    eventId: "matterEvent_1",
    matterId: "matter_1",
    title: "Hearing preparation",
    startsOn: "2026-09-18",
    startsAtTime: "09:00",
    endsAtTime: "10:00",
    timeZone: "America/Denver",
    status: "live",
    startedAt: "2026-09-18T15:02:00.000Z",
    endedAt: null,
    medium: "video",
    liveCount: 3,
    configured: true,
    ...overrides,
  };
}

describe("what a row says", () => {
  it("reads the event's day and clock in the event's own zone, with that zone named", () => {
    const line = meetingWhen(meeting());
    expect(line).toContain("9:00 AM");
    // The zone is stated as its shortcode ON THE RECORD'S OWN DAY — the same zone is MST in January
    // and MDT in July, so a code taken from today is wrong about half the year's meetings.
    expect(line).toContain("MDT");
    expect(line).toContain("Sep");
  });

  it("says only the day where the entry carries no clock", () => {
    const line = meetingWhen(meeting({ startsAtTime: null }));
    expect(line).not.toContain("AM");
    expect(line).toContain("2026");
  });

  it("states where the meeting hangs, and links a matter only when there is one", () => {
    expect(meetingWhere(meeting())).toBe("Matter");
    expect(matterAddress(meeting())).toBe("/matters/matter_1/overview");
    expect(meetingWhere(meeting({ matterId: null, eventKind: "firm" }))).toBe("Firm event");
    expect(matterAddress(meeting({ matterId: null }))).toBeNull();
  });

  it("names the room by the meeting rather than letting an identifier shape the address", () => {
    expect(meetingAddress(meeting())).toBe("/meetings/meeting_1");
    expect(meetingAddress(meeting({ id: "a/b" }))).toBe("/meetings/a%2Fb");
  });

  it("leaves the ended column empty for a meeting that has not ended", () => {
    expect(meetingEnded(meeting())).toBe("");
    expect(meetingEnded(meeting({ endedAt: "2026-09-18T16:00:00.000Z" }))).not.toBe("");
  });

  it("gives every section the same first columns, and one of its own", () => {
    const identifiersFor = (scope: MeetingScope) =>
      meetingColumns(scope).map((column) => column.id);
    for (const scope of MEETING_SCOPES) {
      expect(identifiersFor(scope).slice(0, 3)).toEqual([
        MEETING_COLUMN_IDENTIFIERS.title,
        MEETING_COLUMN_IDENTIFIERS.where,
        MEETING_COLUMN_IDENTIFIERS.when,
      ]);
    }
    expect(identifiersFor("live")).toContain(MEETING_COLUMN_IDENTIFIERS.inTheRoom);
    expect(identifiersFor("recent")).toContain(MEETING_COLUMN_IDENTIFIERS.ended);
    expect(identifiersFor("upcoming")).not.toContain(MEETING_COLUMN_IDENTIFIERS.inTheRoom);
  });
});

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

function draw(props: ComponentProps<typeof MeetingListSection>): HTMLElement {
  instance = mount(MeetingListSection, { target, props });
  flushSync();
  return target;
}

function drawScreen(props: ComponentProps<typeof MeetingsScreen>): HTMLElement {
  instance = mount(MeetingsScreen, { target, props });
  flushSync();
  return target;
}

/** The three scopes, each answered with whatever a case hands it. */
function pages(
  live: MeetingSummary[] | null,
  upcoming: MeetingSummary[] | null,
  recent: MeetingSummary[] | null,
): Record<MeetingScope, { meetings: MeetingSummary[] | null }> {
  return {
    live: { meetings: live },
    upcoming: { meetings: upcoming },
    recent: { meetings: recent },
  };
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
});

describe("a section of the screen", () => {
  it("names itself and offers the room on every live row", () => {
    const rendered = draw({ scope: "live", meetings: [meeting(), meeting({ id: "meeting_2" })] });

    expect(rendered.querySelector("h2")?.textContent?.trim()).toBe(MEETING_SECTIONS.live.heading);
    expect(rendered.textContent).toContain("Hearing preparation");
    expect(rendered.querySelector('a[href="/meetings/meeting_1"]')?.textContent?.trim()).toBe(
      "Join Meeting",
    );
    expect(rendered.querySelector('a[href="/meetings/meeting_2"]')).not.toBeNull();
    // The matter is reached from the row it is named on.
    expect(rendered.querySelector('a[href="/matters/matter_1/overview"]')).not.toBeNull();
  });

  it("marks a call as one, and says what pressing Join walks into", () => {
    const rendered = draw({
      scope: "live",
      meetings: [meeting({ medium: "audio" })],
    });

    expect(rendered.querySelector('a[href="/meetings/meeting_1"]')?.textContent?.trim()).toBe(
      "Join Call",
    );
    // The kind is on the row itself, where a reader meets the event's name — and it is named for
    // somebody who cannot see the glyph.
    expect(rendered.querySelector('[aria-label="Call"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Video meeting"]')).toBeNull();
  });

  it("sends an ended meeting back to its event rather than into a room that is closed", () => {
    const rendered = draw({
      scope: "recent",
      meetings: [meeting({ status: "ended", endedAt: "2026-09-18T16:00:00.000Z", liveCount: 0 })],
    });

    expect(rendered.querySelector('a[href="/meetings/meeting_1"]')).toBeNull();
    expect(
      rendered.querySelector('a[href="/matters/matter_1/calendar?entry=matterEvent_1"]'),
    ).not.toBeNull();
  });

  it("says a firm meeting is on a firm event, in words rather than a link", () => {
    const rendered = draw({
      scope: "upcoming",
      meetings: [meeting({ matterId: null, eventKind: "firm", eventId: "firmEvent_1" })],
    });

    expect(rendered.textContent).toContain("Firm event");
    expect(rendered.querySelector('a[href^="/matters/"]')).toBeNull();
  });

  it("states an empty section inside the table it would have filled", () => {
    const rendered = draw({ scope: "upcoming", meetings: [] });

    expect(rendered.querySelector("table")).not.toBeNull();
    expect(rendered.textContent).toContain("No Results");
  });

  it("replaces the table with the refusal when the read failed", () => {
    const rendered = draw({
      scope: "live",
      meetings: null,
      failure: { problem: null, request: "GET /api/v1/meetings", failedAt: new Date() },
      onRetry: () => {},
    });

    // A table standing empty over a failure says the firm has no meetings, which nobody asked it.
    expect(rendered.querySelector("table")).toBeNull();
    expect(rendered.textContent).toContain("Nothing answered");
    expect(
      [...rendered.querySelectorAll("button")].some(
        (control) => control.textContent?.trim() === "Retry",
      ),
    ).toBe(true);
  });
});

describe("the screen", () => {
  it("draws the three sections in the order the questions are asked", () => {
    const rendered = drawScreen({
      sections: pages(
        [meeting()],
        [meeting({ id: "meeting_2", status: "scheduled", liveCount: 0 })],
        [meeting({ id: "meeting_3", status: "ended", endedAt: "2026-09-17T16:00:00.000Z" })],
      ),
    });

    const headings = [...rendered.querySelectorAll("h2")].map((node) => node.textContent?.trim());
    expect(headings).toEqual([
      MEETING_SECTIONS.live.heading,
      MEETING_SECTIONS.upcoming.heading,
      MEETING_SECTIONS.recent.heading,
    ]);
    expect(rendered.querySelectorAll("table")).toHaveLength(3);
  });

  it("holds every section's frame while the reads are still in flight", () => {
    const rendered = drawScreen({ sections: pages(null, null, null) });

    // Not a spinner and not three blank stretches: each table renders its own placeholder rows, so
    // the screen is the shape it will be when the answers land.
    expect(rendered.querySelectorAll("table")).toHaveLength(3);
  });

  it("says once that meetings are not turned on, instead of three empty sections", () => {
    const rendered = drawScreen({ sections: pages([], [], []), configured: false });

    expect(rendered.textContent).toContain("Meetings Are Not Turned On");
    expect(rendered.querySelector("table")).toBeNull();
    expect(rendered.querySelectorAll("h2")).toHaveLength(0);
  });
});
