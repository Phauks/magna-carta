import { describe, expect, it } from "vitest";
import type { ProviderEventWrite } from "@magna-carta/calendar/sync-port";
import { parseRecurrence } from "@magna-carta/civil-time/recurrence";
import type { HttpClient, HttpRequest } from "@magna-carta/integrations/http";
import {
  createGoogleCalendarAdapter,
  googleEventBody,
  googleEventIdFor,
  googleEventReference,
  googleRecurrenceOf,
  WRITTEN_COPY_PROPERTY_NAME,
} from "../src/calendar-sync-adapter.ts";

const API = "https://www.googleapis.com/calendar/v3";
const credential = { kind: "oauth", accessToken: "access-1", refreshToken: "refresh-1" } as const;
const now = () => new Date("2026-11-13T12:00:00.000Z");

interface Answer {
  readonly status: number;
  readonly body?: unknown;
}

// A fake Google: each request is answered by the first rule whose method and address match.
function google(answer: (request: HttpRequest) => Answer | undefined): {
  http: HttpClient;
  sent: HttpRequest[];
} {
  const sent: HttpRequest[] = [];
  return {
    sent,
    http: {
      request: (input) => {
        sent.push(input);
        const found = answer(input) ?? { status: 404, body: {} };
        return Promise.resolve({
          status: found.status,
          json: () => Promise.resolve(found.body ?? {}),
        });
      },
    },
  };
}

function portOver(http: HttpClient, channelIds: string[] = ["channel-1", "channel-2"]) {
  let next = 0;
  return createGoogleCalendarAdapter({
    http,
    now,
    newChannelId: () => channelIds[next++] ?? `channel-${next}`,
  }).create({ credential });
}

const calendarListAnswer = {
  status: 200,
  body: {
    items: [
      { id: "holidays#group.v.calendar.google.com", summary: "Holidays", accessRole: "reader" },
      {
        id: "member@example.test",
        summary: "member@example.test",
        primary: true,
        accessRole: "owner",
      },
      { id: "team@group.calendar.google.com", summary: "Team", accessRole: "writer" },
      { id: "busy@example.test", summary: "Somebody", accessRole: "freeBusyReader" },
      { id: "gone@example.test", summary: "Gone", accessRole: "owner", deleted: true },
    ],
  },
};

const timed: ProviderEventWrite = {
  title: "Hearing",
  notes: "Courtroom 4",
  location: "County Courthouse",
  startsOn: "2026-12-01",
  startsAtTime: "09:30",
  endsOn: null,
  endsAtTime: "11:00",
  timeZone: "America/Chicago",
};

const wholeDay: ProviderEventWrite = {
  title: "Trial",
  notes: null,
  location: null,
  startsOn: "2026-12-01",
  startsAtTime: null,
  endsOn: "2026-12-03",
  endsAtTime: null,
  timeZone: "America/Chicago",
};

function repeating(line: string, skippedDays: readonly string[] = []): ProviderEventWrite {
  return { ...timed, repeats: { line, rule: parseRecurrence(line), skippedDays } };
}

describe("the Google calendar adapter", () => {
  it("declares a per-member sign-in and every operation of the port", () => {
    const adapter = createGoogleCalendarAdapter({
      http: google(() => undefined).http,
      now,
      newChannelId: () => "c",
    });
    expect(adapter.descriptor).toMatchObject({
      adapterId: "google-calendar",
      category: "calendar-sync",
      credential: { kind: "oauth", scope: "user" },
    });
    expect(Object.values(adapter.descriptor.operations).every((entry) => entry.supported)).toBe(
      true,
    );
  });

  it("refuses to be built without an access token", () => {
    const adapter = createGoogleCalendarAdapter({
      http: google(() => undefined).http,
      now,
      newChannelId: () => "c",
    });
    expect(() => adapter.create({})).toThrow();
    expect(() => adapter.create({ credential: { kind: "oauth", refreshToken: "r" } })).toThrow();
  });

  it("lists the calendars whose events can be read, across pages", async () => {
    const { http, sent } = google((request) => {
      if (!request.url.startsWith(`${API}/users/me/calendarList?`)) return undefined;
      return request.url.includes("pageToken=page-2")
        ? {
            status: 200,
            body: { items: [{ id: "second", summary: "Second", accessRole: "reader" }] },
          }
        : { status: 200, body: { ...calendarListAnswer.body, nextPageToken: "page-2" } };
    });
    expect(await portOver(http).listCalendars()).toEqual({
      ok: true,
      value: [
        {
          remoteId: "holidays#group.v.calendar.google.com",
          name: "Holidays",
          isDefault: false,
          canWrite: false,
        },
        {
          remoteId: "member@example.test",
          name: "member@example.test",
          isDefault: true,
          canWrite: true,
        },
        {
          remoteId: "team@group.calendar.google.com",
          name: "Team",
          isDefault: false,
          canWrite: true,
        },
        { remoteId: "second", name: "Second", isDefault: false, canWrite: false },
      ],
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]?.headers).toEqual({ Authorization: "Bearer access-1" });
  });

  it.each([
    [401, {}, "auth"],
    [429, {}, "rate_limit"],
    [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "rate_limit"],
    [403, { error: { errors: [{ reason: "forbidden" }] } }, "validation"],
    [503, {}, "upstream"],
  ])("reads a %i %j as a %s problem", async (status, body, category) => {
    const { http } = google(() => ({ status, body }));
    expect(await portOver(http).listCalendars()).toMatchObject({
      ok: false,
      reason: "adapter-error",
      problem: { category },
    });
  });

  it("reads a transport failure as a network problem", async () => {
    const http: HttpClient = { request: () => Promise.reject(new Error("offline")) };
    expect(await portOver(http).listCalendars()).toMatchObject({
      ok: false,
      problem: { category: "network" },
    });
  });
});

describe("an event as Google takes it", () => {
  it("sends a timed event at its wall-clock time in its own zone, marked as a copy, with nobody invited", () => {
    const body = googleEventBody(timed);
    expect(body).toEqual({
      summary: "Hearing",
      description: "Courtroom 4",
      location: "County Courthouse",
      start: { date: null, dateTime: "2026-12-01T09:30:00", timeZone: "America/Chicago" },
      end: { date: null, dateTime: "2026-12-01T11:00:00", timeZone: "America/Chicago" },
      extendedProperties: { private: { [WRITTEN_COPY_PROPERTY_NAME]: "1" } },
      recurrence: [],
    });
    expect(body).not.toHaveProperty("attendees");
  });

  it("ends a whole-day event on the day after its last day, and clears any time it had", () => {
    expect(googleEventBody(wholeDay)).toMatchObject({
      start: { date: "2026-12-01", dateTime: null, timeZone: null },
      end: { date: "2026-12-04", dateTime: null, timeZone: null },
    });
  });

  it("ends a timed event with no end when it starts", () => {
    expect(googleEventBody({ ...timed, endsAtTime: null })).toMatchObject({
      end: { dateTime: "2026-12-01T09:30:00" },
    });
  });
});

describe("a series as Google repeats it", () => {
  it("is absent for an event that happens once", () => {
    expect(googleRecurrenceOf(timed)).toBeUndefined();
  });

  it.each([
    ["FREQ=DAILY", ["RRULE:FREQ=DAILY"]],
    ["FREQ=DAILY;INTERVAL=3;COUNT=5", ["RRULE:FREQ=DAILY;INTERVAL=3;COUNT=5"]],
    // 2026-12-01 is a Tuesday.
    ["FREQ=WEEKLY", ["RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=TU"]],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,TU", ["RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=TU,TH"]],
    ["FREQ=MONTHLY", ["RRULE:FREQ=MONTHLY;BYMONTHDAY=1"]],
    ["FREQ=MONTHLY;BYSETPOS=BYDAY", ["RRULE:FREQ=MONTHLY;BYDAY=1TU"]],
    ["FREQ=YEARLY", ["RRULE:FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=1"]],
    // The end of 2027-01-31 in Chicago, which is six hours behind UTC in winter.
    ["FREQ=DAILY;UNTIL=20270131", ["RRULE:FREQ=DAILY;UNTIL=20270201T055959Z"]],
  ])("sends %s as %j", (line, expected) => {
    expect(googleRecurrenceOf(repeating(line))).toEqual(expected);
  });

  it("names the last day itself for a whole-day series", () => {
    expect(
      googleRecurrenceOf({
        ...wholeDay,
        endsOn: null,
        repeats: {
          line: "FREQ=DAILY;UNTIL=20270131",
          rule: parseRecurrence("FREQ=DAILY;UNTIL=20270131"),
          skippedDays: ["2026-12-05"],
        },
      }),
    ).toEqual(["RRULE:FREQ=DAILY;UNTIL=20270131", "EXDATE;VALUE=DATE:20261205"]);
  });

  it("takes skipped days out at the series' own time in its own zone", () => {
    expect(googleRecurrenceOf(repeating("FREQ=WEEKLY", ["2026-12-08", "2026-12-22"]))).toEqual([
      "RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=TU",
      "EXDATE;TZID=America/Chicago:20261208T093000,20261222T093000",
    ]);
  });

  it("refuses a weekly series whose first day is not one of its weekdays", () => {
    expect(googleRecurrenceOf(repeating("FREQ=WEEKLY;BYDAY=MO,WE"))).toBeNull();
  });

  it("refuses a rule this platform cannot itself read", () => {
    expect(
      googleRecurrenceOf({
        ...timed,
        repeats: { line: "FREQ=HOURLY", rule: null, skippedDays: [] },
      }),
    ).toBeNull();
  });
});

describe("the identifier a new copy is given", () => {
  it("is made from the transaction identifier, in the letters Google allows", () => {
    expect(googleEventIdFor("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(
      "3f2504e04f8941d39a0c0305e82c3301",
    );
  });

  it("is left to Google when the transaction identifier leaves too little", () => {
    expect(googleEventIdFor("xyz-1")).toBeUndefined();
  });
});

describe("writing events through the Google calendar adapter", () => {
  const transactionId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const eventId = "3f2504e04f8941d39a0c0305e82c3301";
  const calendarId = "member@example.test";
  const eventsAddress = `${API}/calendars/member%40example.test/events`;
  const reference = googleEventReference(eventId, calendarId);

  it("creates a copy under an identifier of its own choosing and answers where it is", async () => {
    const { http, sent } = google((request) =>
      request.method === "POST" ? { status: 200, body: { id: eventId, etag: '"1"' } } : undefined,
    );
    expect(await portOver(http).createEvent(calendarId, timed, transactionId)).toEqual({
      ok: true,
      value: { remoteId: `${eventId}/member@example.test`, versionTag: '"1"' },
    });
    expect(sent[0]?.url).toBe(eventsAddress);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({ id: eventId, summary: "Hearing" });
  });

  it("answers the copy already made when a create is tried a second time", async () => {
    const { http, sent } = google((request) =>
      request.method === "POST"
        ? { status: 409, body: {} }
        : { status: 200, body: { id: eventId, etag: '"1"', status: "confirmed" } },
    );
    expect(await portOver(http).createEvent(calendarId, timed, transactionId)).toEqual({
      ok: true,
      value: { remoteId: reference, versionTag: '"1"' },
    });
    expect(sent[1]?.method).toBe("GET");
    expect(sent[1]?.url.startsWith(`${eventsAddress}/${eventId}?`)).toBe(true);
  });

  it("refuses a series it cannot repeat on the same days before sending anything", async () => {
    const { http, sent } = google(() => ({ status: 200, body: {} }));
    const port = portOver(http);
    const unrepeatable = repeating("FREQ=WEEKLY;BYDAY=MO");
    expect(await port.createEvent(calendarId, unrepeatable, transactionId)).toMatchObject({
      ok: false,
      problem: { category: "validation", status: 422 },
    });
    expect(await port.updateEvent(reference, unrepeatable)).toMatchObject({
      ok: false,
      problem: { status: 422 },
    });
    expect(sent).toHaveLength(0);
  });

  it("changes a copy in the calendar it is in", async () => {
    const { http, sent } = google(() => ({ status: 200, body: { id: eventId, etag: '"2"' } }));
    expect(await portOver(http).updateEvent(reference, wholeDay)).toEqual({
      ok: true,
      value: { found: true, versionTag: '"2"' },
    });
    expect(sent[0]?.method).toBe("PATCH");
    expect(sent[0]?.url).toBe(`${eventsAddress}/${eventId}`);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({
      start: { date: "2026-12-01", dateTime: null },
      recurrence: [],
    });
  });

  it.each([
    [{ status: 404 }],
    [{ status: 410 }],
    [{ status: 200, body: { id: eventId, status: "cancelled" } }],
  ])("reads %j as a copy that is no longer there", async (answer) => {
    const port = portOver(google(() => answer).http);
    expect(await port.updateEvent(reference, timed)).toEqual({ ok: true, value: { found: false } });
    expect(await port.updateSeriesDay(reference, timed)).toEqual({
      ok: true,
      value: { found: false },
    });
    expect(await port.readEvent(reference)).toEqual({ ok: true, value: null });
  });

  it("deletes a copy, and is content when it is already gone", async () => {
    for (const status of [204, 404, 410]) {
      const { http, sent } = google(() => ({ status }));
      expect(await portOver(http).deleteEvent(reference)).toEqual({ ok: true, value: null });
      expect(sent[0]?.method).toBe("DELETE");
    }
  });

  it("treats an identifier that names no calendar as a copy that is not there", async () => {
    const { http, sent } = google(() => ({ status: 200, body: {} }));
    const port = portOver(http);
    expect(await port.updateEvent("no-calendar", timed)).toEqual({
      ok: true,
      value: { found: false },
    });
    expect(await port.deleteEvent("no-calendar")).toEqual({ ok: true, value: null });
    expect(await port.readEvent("no-calendar")).toEqual({ ok: true, value: null });
    expect(await port.listSeriesChangedDays("no-calendar")).toEqual({ ok: true, value: null });
    expect(sent).toHaveLength(0);
  });

  it("writes one day of a series with only what a member can see", async () => {
    const day = googleEventReference(`${eventId}_20261208T153000Z`, calendarId);
    const { http, sent } = google(() => ({ status: 200, body: { id: "x", etag: '"3"' } }));
    expect(await portOver(http).updateSeriesDay(day, { ...timed, startsOn: "2026-12-08" })).toEqual(
      { ok: true, value: { found: true, versionTag: '"3"' } },
    );
    expect(sent[0]?.url).toBe(`${eventsAddress}/${eventId}_20261208T153000Z`);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual({
      summary: "Hearing",
      location: "County Courthouse",
      start: { date: null, dateTime: "2026-12-08T09:30:00", timeZone: "America/Chicago" },
      end: { date: null, dateTime: "2026-12-08T11:00:00", timeZone: "America/Chicago" },
    });
  });
});

describe("reading events through the Google calendar adapter", () => {
  it("reads a timed copy as two instants and a whole-day one as its days", async () => {
    const answers: Record<string, unknown> = {
      timed: {
        id: "timed",
        etag: '"1"',
        summary: "Hearing",
        location: " ",
        start: { dateTime: "2026-12-01T09:30:00-06:00", timeZone: "America/Chicago" },
        end: { dateTime: "2026-12-01T11:00:00-06:00", timeZone: "America/Chicago" },
      },
      days: { id: "days", start: { date: "2026-12-01" }, end: { date: "2026-12-04" } },
    };
    const { http } = google((request) => {
      const id = /events\/([a-z]+)\?/.exec(request.url)?.[1] ?? "";
      return { status: 200, body: answers[id] };
    });
    const port = portOver(http);
    expect(await port.readEvent(googleEventReference("timed", "cal"))).toEqual({
      ok: true,
      value: {
        remoteId: "timed/cal",
        versionTag: '"1"',
        title: "Hearing",
        location: null,
        when: {
          kind: "instants",
          startsAtMilliseconds: Date.parse("2026-12-01T15:30:00.000Z"),
          endsAtMilliseconds: Date.parse("2026-12-01T17:00:00.000Z"),
        },
      },
    });
    expect(await port.readEvent(googleEventReference("days", "cal"))).toMatchObject({
      ok: true,
      value: { when: { kind: "days", startsOn: "2026-12-01", endsOn: "2026-12-03" } },
    });
  });

  it("lists only the copies it wrote, from every calendar a copy could be in", async () => {
    const { http, sent } = google((request) => {
      if (request.url.startsWith(`${API}/users/me/calendarList?`)) return calendarListAnswer;
      if (request.url.includes("member%40example.test")) {
        return {
          status: 200,
          body: {
            items: [
              { id: "one", start: { date: "2026-12-01" }, end: { date: "2026-12-02" } },
              // A day of a series the member changed, and one they deleted.
              {
                id: "s_1",
                recurringEventId: "s",
                start: { date: "2026-12-02" },
                end: { date: "2026-12-03" },
              },
              { id: "s_2", recurringEventId: "s", status: "cancelled" },
            ],
          },
        };
      }
      return { status: 200, body: {} };
    });
    const listed = await portOver(http).listWrittenEvents();
    expect(listed).toMatchObject({
      ok: true,
      value: { complete: true, events: [{ remoteId: "one/member@example.test" }] },
    });
    // The calendar list, then the two calendars the member can write. Never the read-only ones.
    expect(sent).toHaveLength(3);
    for (const request of sent.slice(1)) {
      expect(request.url).toContain(`privateExtendedProperty=${WRITTEN_COPY_PROPERTY_NAME}%3D1`);
      expect(request.url).toContain("singleEvents=false");
    }
    expect(sent.some((request) => request.url.includes("holidays"))).toBe(false);
  });

  it("says so when a calendar held more copies than it would page through", async () => {
    const { http } = google((request) => {
      if (request.url.startsWith(`${API}/users/me/calendarList?`)) return calendarListAnswer;
      return { status: 200, body: { items: [], nextPageToken: "more" } };
    });
    expect(await portOver(http).listWrittenEvents()).toMatchObject({
      ok: true,
      value: { complete: false },
    });
  });

  it("lists a calendar's events in a window, a series as its days, leaving out what did not happen", async () => {
    const { http, sent } = google(() => ({
      status: 200,
      body: {
        items: [
          {
            id: "own",
            summary: "Lunch",
            start: { date: "2026-12-01" },
            end: { date: "2026-12-02" },
          },
          {
            id: "s_20261202",
            recurringEventId: "s",
            start: { dateTime: "2026-12-02T15:00:00Z" },
            end: { dateTime: "2026-12-02T16:00:00Z" },
          },
          { id: "off", status: "cancelled" },
          {
            id: "home",
            eventType: "workingLocation",
            start: { date: "2026-12-01" },
            end: { date: "2026-12-02" },
          },
          { id: "odd", start: { dateTime: "not a time" }, end: { dateTime: "not a time" } },
        ],
      },
    }));
    const listed = await portOver(http).listCalendarEvents("cal", {
      fromInstant: "2026-12-01T00:00:00.000Z",
      toInstant: "2026-12-08T00:00:00.000Z",
    });
    expect(listed).toMatchObject({
      ok: true,
      value: {
        complete: true,
        events: [
          { remoteId: "own/cal", seriesRemoteId: null },
          { remoteId: "s_20261202/cal", seriesRemoteId: "s/cal" },
        ],
      },
    });
    expect(sent[0]?.url).toContain("singleEvents=true");
    expect(sent[0]?.url).toContain("timeMin=2026-12-01T00%3A00%3A00.000Z");
    expect(sent[0]?.url).toContain("timeMax=2026-12-08T00%3A00%3A00.000Z");
  });

  it("answers null for a calendar the account no longer has", async () => {
    const { http } = google(() => ({ status: 404 }));
    expect(
      await portOver(http).listCalendarEvents("cal", {
        fromInstant: "2026-12-01T00:00:00.000Z",
        toInstant: "2026-12-08T00:00:00.000Z",
      }),
    ).toEqual({ ok: true, value: null });
  });

  it("answers the days of a series near now, each saying which day it was", async () => {
    const { http, sent } = google(() => ({
      status: 200,
      body: {
        items: [
          {
            id: "s_20261208T153000Z",
            recurringEventId: "s",
            summary: "Moved",
            originalStartTime: { dateTime: "2026-12-08T09:30:00-06:00" },
            start: { dateTime: "2026-12-08T13:00:00-06:00" },
            end: { dateTime: "2026-12-08T14:00:00-06:00" },
          },
          {
            id: "s_20261215",
            originalStartTime: { date: "2026-12-15" },
            start: { date: "2026-12-15" },
            end: { date: "2026-12-16" },
          },
          // Says nothing of which day it was, so it is left alone.
          { id: "s_x", start: { date: "2026-12-22" }, end: { date: "2026-12-23" } },
        ],
      },
    }));
    const days = await portOver(http).listSeriesChangedDays(googleEventReference("s", "cal"));
    expect(days).toMatchObject({
      ok: true,
      value: [
        {
          remoteId: "s_20261208T153000Z/cal",
          title: "Moved",
          originalStartsAtMilliseconds: Date.parse("2026-12-08T15:30:00.000Z"),
        },
        {
          remoteId: "s_20261215/cal",
          originalStartsAtMilliseconds: Date.parse("2026-12-15T12:00:00.000Z"),
        },
      ],
    });
    expect(sent[0]?.url.startsWith(`${API}/calendars/cal/events/s/instances?`)).toBe(true);
    expect(sent[0]?.url).toContain("timeMin=2026-10-13T12%3A00%3A00.000Z");
  });
});

describe("watching a Google account for changes", () => {
  const request = {
    address: "https://app.example.test/notices/google/firm/connection",
    secret: "secret-1",
    expiresAt: "2026-11-16T12:00:00.000Z",
  };

  it("watches each calendar it can read, the member's own first, and answers the soonest end", async () => {
    const { http, sent } = google((sentRequest) => {
      if (sentRequest.url.startsWith(`${API}/users/me/calendarList?`)) return calendarListAnswer;
      if (sentRequest.url.includes("holidays")) return { status: 400, body: {} };
      const body = JSON.parse(sentRequest.body ?? "{}") as { id: string };
      return {
        status: 200,
        body: {
          id: body.id,
          resourceId: `resource-of-${body.id}`,
          expiration: body.id === "channel-1" ? "1794830400000" : "1794744000000",
        },
      };
    });
    const begun = await portOver(http, ["channel-1", "channel-2", "channel-3"]).watchChanges(
      request,
    );
    expect(begun).toEqual({
      ok: true,
      value: {
        watchId: JSON.stringify([
          ["channel-1", "resource-of-channel-1"],
          ["channel-3", "resource-of-channel-3"],
        ]),
        expiresAt: new Date(1794744000000).toISOString(),
      },
    });
    const watches = sent.filter((sentRequest) => sentRequest.url.endsWith("/events/watch"));
    expect(watches).toHaveLength(3);
    expect(watches[0]?.url).toBe(`${API}/calendars/member%40example.test/events/watch`);
    expect(JSON.parse(watches[0]?.body ?? "{}")).toEqual({
      id: "channel-1",
      type: "web_hook",
      address: request.address,
      token: "secret-1",
      expiration: String(Date.parse(request.expiresAt)),
    });
  });

  it("has not begun when no calendar could be watched", async () => {
    const { http } = google((sentRequest) =>
      sentRequest.url.startsWith(`${API}/users/me/calendarList?`)
        ? calendarListAnswer
        : { status: 503, body: {} },
    );
    expect(await portOver(http).watchChanges(request)).toMatchObject({
      ok: false,
      problem: { category: "upstream" },
    });
  });

  it("ends every channel of a watch, and renewing one ends it so a new one is begun", async () => {
    const watchId = JSON.stringify([
      ["channel-1", "resource-1"],
      ["channel-2", "resource-2"],
    ]);
    for (const act of ["stop", "renew"] as const) {
      const { http, sent } = google(() => ({ status: 204 }));
      const port = portOver(http);
      expect(
        act === "stop"
          ? await port.stopWatch(watchId)
          : await port.renewWatch(watchId, "2026-11-19T12:00:00.000Z"),
      ).toEqual({ ok: true, value: null });
      expect(sent.map((sentRequest) => sentRequest.url)).toEqual([
        `${API}/channels/stop`,
        `${API}/channels/stop`,
      ]);
      expect(JSON.parse(sent[1]?.body ?? "{}")).toEqual({
        id: "channel-2",
        resourceId: "resource-2",
      });
    }
  });

  it("is content to stop a watch it cannot read or that is already gone", async () => {
    const { http, sent } = google(() => ({ status: 404 }));
    const port = portOver(http);
    expect(await port.stopWatch("not a watch")).toEqual({ ok: true, value: null });
    expect(sent).toHaveLength(0);
    expect(await port.stopWatch(JSON.stringify([["c", "r"]]))).toEqual({ ok: true, value: null });
  });
});
