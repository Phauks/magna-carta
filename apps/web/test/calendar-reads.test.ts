import { describe, expect, it } from "vitest";
import type {
  CalendarDeadline,
  CalendarEvent,
  FirmEvent,
  TimelineEntry,
} from "$lib/calendar/calendar-api.ts";
import type { EntryContext } from "$lib/calendar/calendar-entries.ts";
import {
  MAX_PAGES_PER_READ,
  describeReadFailure,
  readCalendarWindow,
  readFailureTitle,
} from "$lib/calendar/calendar-reads.ts";
import { calendarWindow } from "$lib/calendar/calendar-window.ts";

const context: EntryContext = {
  matterNumbers: new Map([["matter_1", "2026-0042"]]),
  eventTypesByCode: new Map(),
  readerTimeZone: "America/New_York",
};

interface Route {
  readonly match: (url: URL) => boolean;
  readonly answer: (url: URL) => { status: number; body: unknown };
}

/** A fetch that answers from a route table and records every request it saw. */
function fakeFetch(routes: readonly Route[]): { fetch: typeof fetch; requests: URL[] } {
  const requests: URL[] = [];
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input), "https://firm.example");
    requests.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (route === undefined) return new Response("{}", { status: 404 });
    const { status, body } = route.answer(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

function page<T>(data: T[], nextCursor: string | null = null): { status: number; body: unknown } {
  return { status: 200, body: { data, nextCursor } };
}

const event: CalendarEvent = {
  id: "matterEvent_in",
  matterId: "matter_1",
  eventTypeId: null,
  eventTypeName: "Hearing",
  title: "Motion to compel",
  description: null,
  status: "scheduled",
  statusReason: null,
  startsOn: "2026-09-14",
  startsAtTime: null,
  endsOn: null,
  endsAtTime: null,
  timeZone: "America/New_York",
  locationText: null,
  conferenceUrl: null,
  recurrenceRule: null,
  courtReference: null,
  recordedAt: "2026-09-01T00:00:00.000Z",
  recordedBy: null,
  continuedFromEventId: null,
  continuedToEventId: null,
};

const deadline: CalendarDeadline = {
  id: "matterDeadline_1",
  matterId: "matter_1",
  title: "Response due",
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
  eventTypeId: null,
  title: "Closed for Labor Day",
  description: null,
  status: "scheduled",
  statusReason: null,
  startsOn: "2026-09-07",
  startsAtTime: null,
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
};

const timelineRow: TimelineEntry = {
  sourceKey: "matterEvent",
  kind: "event",
  sortKey: "2026-09-14",
  rowId: "matterEvent_in",
  matterId: "matter_1",
  actorUserId: null,
  label: "HEARING",
  link: "/matters/matter_1/calendar?entry=matterEvent_in",
  timeOfDay: null,
  timeZone: null,
};

describe("readCalendarWindow, resource scope", () => {
  const window = calendarWindow("week", "2026-09-15");

  it("reads the resource's availability alone, paints bookings as their events, and marks conflicts", async () => {
    const { fetch, requests } = fakeFetch([
      {
        match: (url) => url.pathname === "/api/v1/calendar/resources/firmResource_1/availability",
        answer: () => ({
          status: 200,
          body: {
            data: [
              {
                bookingId: "firmResourceBooking_a",
                startsOn: "2026-09-15",
                startsAtTime: "10:00",
                endsOn: null,
                endsAtTime: "11:00",
                timeZone: "America/New_York",
                eventKind: "matterEvent",
                eventId: "matterEvent_in",
                eventTypeName: "Deposition",
                link: "/matters/matter_1/calendar?entry=matterEvent_in",
                overlappingBookingIds: ["firmResourceBooking_b"],
              },
              {
                bookingId: "firmResourceBooking_c",
                startsOn: "2026-09-17",
                startsAtTime: null,
                endsOn: null,
                endsAtTime: null,
                timeZone: "America/New_York",
                eventKind: "firmEvent",
                eventId: "firmEvent_1",
                eventTypeName: null,
                link: "/calendar/firm-events?entry=firmEvent_1",
                overlappingBookingIds: [],
              },
            ],
          },
        }),
      },
    ]);
    const result = await readCalendarWindow(
      fetch,
      { kind: "resource", resourceId: "firmResource_1" },
      window,
      context,
    );
    expect(requests.map((url) => url.pathname)).toEqual([
      "/api/v1/calendar/resources/firmResource_1/availability",
    ]);
    expect(requests[0]?.searchParams.get("from")).toBe(window.from);
    expect(requests[0]?.searchParams.get("to")).toBe(window.to);
    expect(result.failures).toEqual([]);
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "event:matterEvent_in",
      "firmEvent:firmEvent_1",
    ]);
    expect(result.entries[0]).toMatchObject({
      kind: "event",
      recordId: "matterEvent_in",
      label: "Deposition",
      detail: "Double-booked",
      tone: "danger",
      time: "10:00 AM",
    });
    expect(result.entries[1]).toMatchObject({
      kind: "firmEvent",
      label: "Firm event",
      tone: "accent",
      detail: undefined,
    });
  });

  it("names the bookings read when it fails", async () => {
    const { fetch } = fakeFetch([
      { match: () => true, answer: () => ({ status: 500, body: { status: 500, title: "Down" } }) },
    ]);
    const result = await readCalendarWindow(
      fetch,
      { kind: "resource", resourceId: "firmResource_1" },
      window,
      context,
    );
    expect(result.entries).toEqual([]);
    expect(result.failures.map((failed) => failed.read)).toEqual(["bookings"]);
  });
});

describe("readCalendarWindow, firm scope", () => {
  const window = calendarWindow("month", "2026-09-15");

  it("makes the three reads over the window, narrowed to the matter-event source, and merges them", async () => {
    const { fetch, requests } = fakeFetch([
      {
        match: (url) => url.pathname === "/api/v1/calendar/events",
        answer: () => page([timelineRow]),
      },
      {
        match: (url) => url.pathname === "/api/v1/calendar/deadlines",
        answer: () => page([deadline]),
      },
      { match: (url) => url.pathname === "/api/v1/firm-events", answer: () => page([firmEvent]) },
    ]);
    const result = await readCalendarWindow(fetch, { kind: "firm" }, window, context);

    expect(result.failures).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "firmEvent:firmEvent_1",
      "deadline:matterDeadline_1",
      "event:matterEvent_in",
    ]);

    const federated = requests.find((url) => url.pathname === "/api/v1/calendar/events");
    expect(federated?.searchParams.get("from")).toBe(window.from);
    expect(federated?.searchParams.get("to")).toBe(window.to);
    expect(federated?.searchParams.get("scope")).toBe("matter");
    expect(federated?.searchParams.getAll("kind")).toEqual(["matterEvent"]);
    expect(federated?.searchParams.has("memberId")).toBe(false);

    const deadlines = requests.find((url) => url.pathname === "/api/v1/calendar/deadlines");
    expect(deadlines?.searchParams.get("from")).toBe(window.from);
    expect(deadlines?.searchParams.get("through")).toBe(window.to);
  });

  it("reads a date calendar as its own calendar, narrowed to that layer's sources", async () => {
    // A date calendar is a ROW IN THE RAIL with a read of its own, not a widening of the firm's
    // case settings read: widening would read the same rows twice and put a custody due-back on the
    // Case Settings calendar, which is not where it is.
    const dueBack: TimelineEntry = {
      ...timelineRow,
      sourceKey: "custodyDueBack",
      kind: "dueBack",
      sortKey: "2026-09-20",
      rowId: "custodyMovement_1",
      label: "C-0001",
      link: "/matters/matter_1/custodian",
    };
    const { fetch, requests } = fakeFetch([
      {
        match: (url) =>
          url.pathname === "/api/v1/calendar/events" &&
          url.searchParams.getAll("kind").includes("custodyDueBack"),
        answer: () => page([dueBack]),
      },
      { match: () => true, answer: () => page([]) },
    ]);
    const result = await readCalendarWindow(fetch, { kind: "firm" }, window, context, {
      sources: [
        {
          key: "layer:custody",
          name: "Custody dates",
          kind: { kind: "layer", layerKey: "custody" },
        },
      ],
    });
    const federated = requests.find((url) => url.pathname === "/api/v1/calendar/events");
    expect(federated?.searchParams.getAll("kind")).toEqual(["custodyDueBack", "custodyReviewDue"]);
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "other:custodyDueBack:custodyMovement_1",
    ]);
    expect(result.entries[0]).toMatchObject({
      label: "Due back",
      detail: "2026-0042 · C-0001",
      link: "/matters/matter_1/custodian",
      // Tagged with the calendar it came from, so the grid can colour and lane it.
      sourceKeys: ["layer:custody"],
    });
  });

  it("reads one member's calendar through the member filter the server resolves", async () => {
    const { fetch, requests } = fakeFetch([
      { match: () => true, answer: () => page([timelineRow]) },
    ]);
    const result = await readCalendarWindow(fetch, { kind: "firm" }, window, context, {
      sources: [
        {
          key: "member:user_ada",
          name: "Ada Lovelace",
          kind: { kind: "member", memberId: "user_ada" },
        },
      ],
    });
    const federated = requests.find((url) => url.pathname === "/api/v1/calendar/events");
    expect(federated?.searchParams.get("memberId")).toBe("user_ada");
    expect(result.entries[0]?.sourceKeys).toEqual(["member:user_ada"]);
    // A member calendar is settings; the deadlines read has no member predicate, so it is not made.
    expect(requests.some((url) => url.pathname === "/api/v1/calendar/deadlines")).toBe(false);
  });

  it("reads one record arriving from two calendars as one row that knows it is on both", async () => {
    const { fetch } = fakeFetch([{ match: () => true, answer: () => page([timelineRow]) }]);
    const result = await readCalendarWindow(fetch, { kind: "firm" }, window, context, {
      sources: [
        {
          key: "member:user_ada",
          name: "Ada Lovelace",
          kind: { kind: "member", memberId: "user_ada" },
        },
        {
          key: "member:user_grace",
          name: "Grace Hopper",
          kind: { kind: "member", memberId: "user_grace" },
        },
      ],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.sourceKeys).toEqual(["member:user_ada", "member:user_grace"]);
  });

  it("reads nothing at all for a calendar nobody turned on", async () => {
    const { fetch, requests } = fakeFetch([{ match: () => true, answer: () => page([]) }]);
    await readCalendarWindow(fetch, { kind: "firm" }, window, context, { sources: [] });
    expect(requests).toEqual([]);
  });

  it("passes the member on the mine scope", async () => {
    const { fetch, requests } = fakeFetch([{ match: () => true, answer: () => page([]) }]);
    await readCalendarWindow(fetch, { kind: "mine", memberId: "user_me" }, window, context);
    const federated = requests.find((url) => url.pathname === "/api/v1/calendar/events");
    expect(federated?.searchParams.get("memberId")).toBe("user_me");
  });

  it("keeps the reads that worked when one fails, and names the one that did", async () => {
    const { fetch } = fakeFetch([
      {
        match: (url) => url.pathname === "/api/v1/calendar/events",
        answer: () => page([timelineRow]),
      },
      {
        match: (url) => url.pathname === "/api/v1/calendar/deadlines",
        answer: () => ({ status: 500, body: { status: 500, title: "Down" } }),
      },
      { match: (url) => url.pathname === "/api/v1/firm-events", answer: () => page([]) },
    ]);
    const result = await readCalendarWindow(fetch, { kind: "firm" }, window, context);
    expect(result.entries.map((entry) => entry.id)).toEqual(["event:matterEvent_in"]);
    expect(result.failures.map((failure) => failure.read)).toEqual(["deadlines"]);
    expect(describeReadFailure("deadlines")).toBe("The deadlines could not be read.");
  });

  it("walks a paged read to its end, and stops at the ceiling saying so", async () => {
    let served = 0;
    const { fetch } = fakeFetch([
      {
        match: (url) => url.pathname === "/api/v1/calendar/events",
        answer: (url) => {
          served += 1;
          const cursor = url.searchParams.get("cursor");
          return page(
            [{ ...timelineRow, rowId: `row_${cursor ?? "first"}` }],
            `c${String(served)}`,
          );
        },
      },
      { match: () => true, answer: () => page([]) },
    ]);
    const result = await readCalendarWindow(fetch, { kind: "firm" }, window, context);
    expect(served).toBe(MAX_PAGES_PER_READ);
    expect(result.entries).toHaveLength(MAX_PAGES_PER_READ);
    expect(result.truncated).toBe(true);
  });
});

describe("readCalendarWindow, matter scope", () => {
  const window = calendarWindow("month", "2026-09-15");
  const scope = { kind: "matter", matterId: "matter_1" } as const;

  it("reads the matter's own events with their titles and the matter's deadlines", async () => {
    const { fetch, requests } = fakeFetch([
      {
        match: (url) => url.pathname === "/api/v1/matters/matter_1/events",
        answer: () => page([event]),
      },
      {
        match: (url) => url.pathname === "/api/v1/calendar/deadlines",
        answer: () => page([deadline]),
      },
    ]);
    const result = await readCalendarWindow(fetch, scope, window, context);
    expect(result.entries.map((entry) => entry.label)).toEqual([
      "Response due",
      "Motion to compel",
    ]);
    const deadlines = requests.find((url) => url.pathname === "/api/v1/calendar/deadlines");
    expect(deadlines?.searchParams.get("matterId")).toBe("matter_1");
    expect(requests.some((url) => url.pathname === "/api/v1/calendar/events")).toBe(false);
  });

  it("stops walking the newest-first listing once a page has passed the window", async () => {
    let served = 0;
    const { fetch } = fakeFetch([
      {
        match: (url) => url.pathname === "/api/v1/matters/matter_1/events",
        answer: () => {
          served += 1;
          if (served === 1) return page([{ ...event, id: "future", startsOn: "2026-11-01" }], "c1");
          if (served === 2) return page([{ ...event, id: "inside", startsOn: "2026-09-03" }], "c2");
          return page([{ ...event, id: "past", startsOn: "2026-07-01" }], "c3");
        },
      },
      { match: () => true, answer: () => page([]) },
    ]);
    const result = await readCalendarWindow(fetch, scope, window, context);
    expect(served).toBe(3);
    expect(result.entries.map((entry) => entry.recordId)).toEqual(["inside"]);
  });

  it("keeps a span that starts before the window and ends inside it", async () => {
    const { fetch } = fakeFetch([
      {
        match: (url) => url.pathname === "/api/v1/matters/matter_1/events",
        answer: () =>
          page([{ ...event, id: "trial", startsOn: "2026-08-27", endsOn: "2026-09-01" }]),
      },
      { match: () => true, answer: () => page([]) },
    ]);
    const result = await readCalendarWindow(fetch, scope, window, context);
    expect(result.entries.map((entry) => entry.recordId)).toEqual(["trial"]);
  });
});

describe("how a failed read is named", () => {
  it("leads with a sentence naming which read it was", () => {
    expect(describeReadFailure("events")).toBe("The events could not be read.");
    expect(describeReadFailure("deadlines")).toBe("The deadlines could not be read.");
    expect(describeReadFailure("firmEvents")).toBe("The firm's own events could not be read.");
    expect(describeReadFailure("bookings")).toBe("The resource's bookings could not be read.");
  });

  it("stands under a title that says the same thing as a heading", () => {
    expect(readFailureTitle("events")).toBe("The Events Could Not Be Read");
    expect(readFailureTitle("deadlines")).toBe("The Deadlines Could Not Be Read");
    expect(readFailureTitle("firmEvents")).toBe("The Firm's Own Events Could Not Be Read");
    expect(readFailureTitle("bookings")).toBe("The Resource's Bookings Could Not Be Read");
  });

  it("never lets the title and the sentence name different reads", () => {
    for (const read of ["events", "deadlines", "firmEvents", "bookings"] as const) {
      expect(readFailureTitle(read).toLowerCase()).toBe(
        describeReadFailure(read).toLowerCase().replace(/\.$/, ""),
      );
    }
  });
});
