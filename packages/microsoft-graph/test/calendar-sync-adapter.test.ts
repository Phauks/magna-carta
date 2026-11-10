import { describe, expect, it } from "vitest";
import type { ProviderEventWrite } from "@magna-carta/calendar/sync-port";
import { parseRecurrence } from "@magna-carta/civil-time/recurrence";
import type { HttpClient, HttpRequest } from "@magna-carta/integrations/http";
import {
  createMicrosoftCalendarAdapter,
  graphEventBody,
  graphRecurrenceOf,
  WRITTEN_COPY_PROPERTY_ID,
} from "../src/calendar-sync-adapter.ts";

function serving(pages: Record<string, { status: number; body: unknown }>): {
  http: HttpClient;
  sent: HttpRequest[];
} {
  const sent: HttpRequest[] = [];
  return {
    sent,
    http: {
      request: (input) => {
        sent.push(input);
        const page = pages[input.url] ?? { status: 404, body: {} };
        return Promise.resolve({ status: page.status, json: () => Promise.resolve(page.body) });
      },
    },
  };
}

const first = "https://graph.microsoft.com/v1.0/me/calendars?$top=100";
const credential = { kind: "oauth", accessToken: "access-1", refreshToken: "refresh-1" } as const;

describe("the Microsoft calendar adapter", () => {
  it("declares a per-member sign-in and the operations it supports", () => {
    const adapter = createMicrosoftCalendarAdapter({ http: serving({}).http });
    expect(adapter.descriptor).toMatchObject({
      adapterId: "microsoft-graph",
      category: "calendar-sync",
      credential: { kind: "oauth", scope: "user" },
      operations: { listCalendars: { supported: true } },
    });
  });

  it("refuses to be built without an access token", () => {
    const adapter = createMicrosoftCalendarAdapter({ http: serving({}).http });
    expect(() => adapter.create({})).toThrow();
    expect(() => adapter.create({ credential: { kind: "oauth", refreshToken: "r" } })).toThrow();
  });

  it("lists the member's calendars across pages, asking for identifiers that do not change", async () => {
    const second = "https://graph.microsoft.com/v1.0/me/calendars?$skip=100";
    const { http, sent } = serving({
      [first]: {
        status: 200,
        body: {
          value: [{ id: "cal-1", name: "Calendar", canEdit: true, isDefaultCalendar: true }],
          "@odata.nextLink": second,
        },
      },
      [second]: {
        status: 200,
        body: { value: [{ id: "cal-2", name: "Holidays", canEdit: false }] },
      },
    });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.listCalendars()).toEqual({
      ok: true,
      value: [
        { remoteId: "cal-1", name: "Calendar", isDefault: true, canWrite: true },
        { remoteId: "cal-2", name: "Holidays", isDefault: false, canWrite: false },
      ],
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]?.headers).toEqual({
      Authorization: "Bearer access-1",
      Prefer: 'IdType="ImmutableId"',
    });
  });

  it("never sends the token to a next page outside Microsoft Graph", async () => {
    const { http, sent } = serving({
      [first]: {
        status: 200,
        body: { value: [], "@odata.nextLink": "https://graph.microsoft.com.example.test/next" },
      },
    });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.listCalendars()).toEqual({ ok: true, value: [] });
    expect(sent).toHaveLength(1);
  });

  it.each([
    [401, "auth"],
    [429, "rate_limit"],
    [503, "upstream"],
  ])("reads a %i as a %s problem", async (status, category) => {
    const { http } = serving({ [first]: { status, body: {} } });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.listCalendars()).toMatchObject({
      ok: false,
      reason: "adapter-error",
      problem: { category },
    });
  });

  it("refuses a list it cannot read instead of passing it on", async () => {
    const { http } = serving({ [first]: { status: 200, body: { value: [{ name: "No id" }] } } });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.listCalendars()).toMatchObject({
      ok: false,
      problem: { category: "validation" },
    });
  });
});

describe("writing events through the Microsoft calendar adapter", () => {
  const timed = {
    title: "Hearing",
    notes: "Courtroom 4",
    location: "County Courthouse",
    startsOn: "2026-12-01",
    startsAtTime: "09:30",
    endsOn: null,
    endsAtTime: "11:00",
    timeZone: "America/Chicago",
  } as const;

  function recording(answer: { status: number; body: unknown }): {
    http: HttpClient;
    sent: HttpRequest[];
  } {
    const sent: HttpRequest[] = [];
    return {
      sent,
      http: {
        request: (input) => {
          sent.push(input);
          return Promise.resolve({
            status: answer.status,
            json: () => Promise.resolve(answer.body),
          });
        },
      },
    };
  }

  it("sends a timed event in its own zone, with no attendees", () => {
    expect(graphEventBody(timed)).toEqual({
      subject: "Hearing",
      body: { contentType: "text", content: "Courtroom 4" },
      location: { displayName: "County Courthouse" },
      isAllDay: false,
      start: { dateTime: "2026-12-01T09:30:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-12-01T11:00:00", timeZone: "America/Chicago" },
      singleValueExtendedProperties: [{ id: WRITTEN_COPY_PROPERTY_ID, value: "1" }],
    });
  });

  it("ends a timed event with no end when it starts", () => {
    expect(graphEventBody({ ...timed, endsAtTime: null })).toMatchObject({
      start: { dateTime: "2026-12-01T09:30:00" },
      end: { dateTime: "2026-12-01T09:30:00" },
    });
  });

  it("runs a whole-day event from midnight to the midnight after its last day", () => {
    expect(graphEventBody({ ...timed, startsAtTime: null, endsAtTime: null })).toMatchObject({
      isAllDay: true,
      start: { dateTime: "2026-12-01T00:00:00" },
      end: { dateTime: "2026-12-02T00:00:00" },
    });
    expect(
      graphEventBody({ ...timed, startsAtTime: null, endsAtTime: null, endsOn: "2026-12-31" }),
    ).toMatchObject({
      start: { dateTime: "2026-12-01T00:00:00" },
      end: { dateTime: "2027-01-01T00:00:00" },
    });
  });

  it("creates an event in the named calendar under the caller's transaction identifier", async () => {
    const { http, sent } = recording({ status: 201, body: { id: "evt-1", changeKey: "v1" } });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.createEvent("cal/1", timed, "txn-1")).toEqual({
      ok: true,
      value: { remoteId: "evt-1", versionTag: "v1" },
    });
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.url).toBe("https://graph.microsoft.com/v1.0/me/calendars/cal%2F1/events");
    expect(sent[0]?.headers.Prefer).toBe('IdType="ImmutableId"');
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({
      subject: "Hearing",
      transactionId: "txn-1",
    });
  });

  it("updates an event, and says so when the copy is gone", async () => {
    const present = recording({ status: 200, body: { id: "evt-1", changeKey: "v2" } });
    const port = createMicrosoftCalendarAdapter({ http: present.http }).create({ credential });
    expect(await port.updateEvent("evt-1", timed)).toEqual({
      ok: true,
      value: { found: true, versionTag: "v2" },
    });
    expect(present.sent[0]?.method).toBe("PATCH");
    expect(JSON.parse(present.sent[0]?.body ?? "{}")).not.toHaveProperty("transactionId");

    const gone = recording({ status: 404, body: {} });
    expect(
      await createMicrosoftCalendarAdapter({ http: gone.http })
        .create({ credential })
        .updateEvent("evt-1", timed),
    ).toEqual({ ok: true, value: { found: false } });
  });

  it("deletes an event, and treats one already gone as deleted", async () => {
    for (const status of [204, 404]) {
      const { http, sent } = recording({ status, body: {} });
      const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
      expect(await port.deleteEvent("evt-1")).toEqual({ ok: true, value: null });
      expect(sent[0]?.method).toBe("DELETE");
    }
  });

  it("reports a refused token and a limited account as what they are", async () => {
    const refused = recording({ status: 401, body: {} });
    expect(
      await createMicrosoftCalendarAdapter({ http: refused.http })
        .create({ credential })
        .createEvent("cal-1", timed, "txn-1"),
    ).toMatchObject({ ok: false, problem: { category: "auth" } });
    const limited = recording({ status: 429, body: {} });
    expect(
      await createMicrosoftCalendarAdapter({ http: limited.http })
        .create({ credential })
        .deleteEvent("evt-1"),
    ).toMatchObject({ ok: false, problem: { category: "rate_limit" } });
  });
});

describe("reading back the copies this platform wrote", () => {
  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${WRITTEN_COPY_PROPERTY_ID}' and ep/value eq '1')`;
  const list =
    `https://graph.microsoft.com/v1.0/me/events?$filter=${encodeURIComponent(filter)}` +
    "&$select=id,changeKey,subject,location,isAllDay,start,end&$top=100";
  const timed = {
    id: "evt-1",
    changeKey: "v7",
    subject: "Motion hearing",
    location: { displayName: "Courtroom 4" },
    isAllDay: false,
    start: { dateTime: "2026-12-01T15:30:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-12-01T17:00:00.0000000", timeZone: "UTC" },
  };

  it("marks every event it writes, so only its own copies can be asked for", () => {
    const body = graphEventBody({
      title: "Motion hearing",
      notes: null,
      location: null,
      startsOn: "2026-12-01",
      startsAtTime: "09:30",
      endsOn: null,
      endsAtTime: null,
      timeZone: "America/Chicago",
    });
    expect(body.singleValueExtendedProperties).toEqual([
      { id: WRITTEN_COPY_PROPERTY_ID, value: "1" },
    ]);
  });

  it("asks for the marked events only, and reads a timed and a whole-day copy", async () => {
    const second = "https://graph.microsoft.com/v1.0/me/events?$skip=100";
    const { http, sent } = serving({
      [list]: { status: 200, body: { value: [timed], "@odata.nextLink": second } },
      [second]: {
        status: 200,
        body: {
          value: [
            {
              id: "evt-2",
              subject: "Deadline: Answer due",
              location: { displayName: "" },
              isAllDay: true,
              start: { dateTime: "2026-12-15T00:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2026-12-17T00:00:00.0000000", timeZone: "UTC" },
            },
          ],
        },
      },
    });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.listWrittenEvents()).toEqual({
      ok: true,
      value: {
        complete: true,
        events: [
          {
            remoteId: "evt-1",
            versionTag: "v7",
            title: "Motion hearing",
            location: "Courtroom 4",
            when: {
              kind: "instants",
              startsAtMilliseconds: Date.UTC(2026, 11, 1, 15, 30),
              endsAtMilliseconds: Date.UTC(2026, 11, 1, 17, 0),
            },
          },
          {
            remoteId: "evt-2",
            versionTag: null,
            title: "Deadline: Answer due",
            location: null,
            // The provider's end is the midnight after the last day.
            when: { kind: "days", startsOn: "2026-12-15", endsOn: "2026-12-16" },
          },
        ],
      },
    });
    expect(sent.map((request) => request.url)).toEqual([list, second]);
    expect(sent.every((request) => request.headers.Prefer === 'IdType="ImmutableId"')).toBe(true);
  });

  it("refuses a list holding a time in a zone it did not ask for", async () => {
    const { http } = serving({
      [list]: {
        status: 200,
        body: {
          value: [{ ...timed, start: { dateTime: "2026-12-01T09:30:00", timeZone: "Central" } }],
        },
      },
    });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.listWrittenEvents()).toMatchObject({
      ok: false,
      problem: { category: "validation" },
    });
  });

  it("reads one copy by its identifier, and answers null for one that is gone", async () => {
    const one =
      "https://graph.microsoft.com/v1.0/me/events/evt-1?$select=id,changeKey,subject,location,isAllDay,start,end";
    const { http } = serving({ [one]: { status: 200, body: timed } });
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.readEvent("evt-1")).toMatchObject({
      ok: true,
      value: { remoteId: "evt-1", versionTag: "v7" },
    });
    expect(await port.readEvent("evt-gone")).toEqual({ ok: true, value: null });
  });
});

describe("a series, as Microsoft Graph repeats it", () => {
  // 2026-12-01 is the first Tuesday of the month.
  function series(line: string, startsOn = "2026-12-01"): ProviderEventWrite {
    return {
      title: "Status conference",
      notes: null,
      location: null,
      startsOn,
      startsAtTime: "09:30",
      endsOn: null,
      endsAtTime: "10:00",
      timeZone: "America/Chicago",
      repeats: { line, rule: parseRecurrence(line), skippedDays: [] },
    };
  }
  const noEnd = { type: "noEnd", startDate: "2026-12-01", recurrenceTimeZone: "America/Chicago" };

  it("is nothing at all for an event that happens once", () => {
    const once = { ...series("FREQ=DAILY"), repeats: null };
    expect(graphRecurrenceOf(once)).toBeUndefined();
    expect(graphEventBody(once)).not.toHaveProperty("recurrence");
  });

  // Every shape the repeat editor writes, beside the pattern Graph is sent.
  it.each([
    ["FREQ=DAILY", { type: "daily", interval: 1 }],
    ["FREQ=DAILY;INTERVAL=3", { type: "daily", interval: 3 }],
    [
      "FREQ=WEEKLY",
      { type: "weekly", interval: 1, daysOfWeek: ["tuesday"], firstDayOfWeek: "sunday" },
    ],
    [
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH",
      {
        type: "weekly",
        interval: 2,
        daysOfWeek: ["tuesday", "thursday"],
        firstDayOfWeek: "sunday",
      },
    ],
    ["FREQ=MONTHLY", { type: "absoluteMonthly", interval: 1, dayOfMonth: 1 }],
    [
      "FREQ=MONTHLY;INTERVAL=3;BYSETPOS=BYDAY",
      { type: "relativeMonthly", interval: 3, daysOfWeek: ["tuesday"], index: "first" },
    ],
    ["FREQ=YEARLY", { type: "absoluteYearly", interval: 1, dayOfMonth: 1, month: 12 }],
  ])("%s", (line, pattern) => {
    expect(graphRecurrenceOf(series(line))).toEqual({ pattern, range: noEnd });
  });

  it("ends a series after a count, on a date, or never", () => {
    expect(graphRecurrenceOf(series("FREQ=WEEKLY;COUNT=12"))).toMatchObject({
      range: { type: "numbered", startDate: "2026-12-01", numberOfOccurrences: 12 },
    });
    expect(graphRecurrenceOf(series("FREQ=WEEKLY;UNTIL=20270301"))).toMatchObject({
      range: { type: "endDate", startDate: "2026-12-01", endDate: "2027-03-01" },
    });
    expect(graphRecurrenceOf(series("FREQ=WEEKLY"))).toMatchObject({ range: { type: "noEnd" } });
  });

  it("puts the rule on the event it sends", () => {
    expect(graphEventBody(series("FREQ=DAILY"))).toMatchObject({
      subject: "Status conference",
      recurrence: { pattern: { type: "daily", interval: 1 } },
    });
  });

  // Where the two calendars could put the series on different days, it is not sent at all.
  it.each([
    [
      "a weekly rule that leaves out the day the series starts on",
      "FREQ=WEEKLY;BYDAY=WE",
      "2026-12-01",
    ],
    ["a monthly rule on a day February does not have", "FREQ=MONTHLY", "2026-12-31"],
    ["a yearly rule on the 29th of February", "FREQ=YEARLY", "2028-02-29"],
    ["a monthly rule on a fifth weekday", "FREQ=MONTHLY;BYSETPOS=BYDAY", "2026-12-29"],
    ["a rule this platform cannot read", "FREQ=HOURLY", "2026-12-01"],
  ])("refuses %s, and asks Microsoft nothing", async (_name, line, startsOn) => {
    const event = series(line, startsOn);
    expect(graphRecurrenceOf(event)).toBeNull();
    const { http, sent } = serving({});
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.createEvent("cal-1", event, "txn-1")).toMatchObject({
      ok: false,
      problem: { category: "validation" },
    });
    expect(await port.updateEvent("evt-1", event)).toMatchObject({
      ok: false,
      problem: { category: "validation" },
    });
    expect(sent).toEqual([]);
  });

  it("takes a skipped day out of the series after writing it, and only that day", async () => {
    const event = {
      ...series("FREQ=WEEKLY"),
      repeats: { ...series("FREQ=WEEKLY").repeats!, skippedDays: ["2026-12-08"] },
    };
    const instances =
      "https://graph.microsoft.com/v1.0/me/events/evt-1/instances?startDateTime=2026-12-07T00:00:00" +
      "&endDateTime=2026-12-10T00:00:00&$select=id,changeKey,subject,location,isAllDay,start,end&$top=50";
    const sent: HttpRequest[] = [];
    const http: HttpClient = {
      request: (input) => {
        sent.push(input);
        const body =
          input.url === instances
            ? {
                value: [
                  // 09:30 in Chicago on the 8th, which is 15:30 UTC.
                  {
                    id: "occurrence-8th",
                    start: { dateTime: "2026-12-08T15:30:00.0000000", timeZone: "UTC" },
                    end: { dateTime: "2026-12-08T16:00:00.0000000", timeZone: "UTC" },
                  },
                  // A day the member moved to late evening: the 9th in UTC, still the 8th's
                  // neighbour and not the skipped day in Chicago.
                  {
                    id: "occurrence-9th",
                    start: { dateTime: "2026-12-09T15:30:00.0000000", timeZone: "UTC" },
                    end: { dateTime: "2026-12-09T16:00:00.0000000", timeZone: "UTC" },
                  },
                ],
              }
            : { id: "evt-1", changeKey: "v1" };
        return Promise.resolve({ status: 200, json: () => Promise.resolve(body) });
      },
    };
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    expect(await port.createEvent("cal-1", event, "txn-1")).toEqual({
      ok: true,
      value: { remoteId: "evt-1", versionTag: "v1" },
    });
    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://graph.microsoft.com/v1.0/me/calendars/cal-1/events",
      `GET ${instances}`,
      "DELETE https://graph.microsoft.com/v1.0/me/events/occurrence-8th",
    ]);

    sent.length = 0;
    expect(await port.updateEvent("evt-1", event)).toMatchObject({ ok: true });
    expect(sent.map((request) => request.method)).toEqual(["PATCH", "GET", "DELETE"]);
  });

  it("tells a copy that was a series it now happens once", async () => {
    const { http, sent } = serving({});
    const port = createMicrosoftCalendarAdapter({ http }).create({ credential });
    await port.updateEvent("evt-1", { ...series("FREQ=DAILY"), repeats: null });
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({ recurrence: null });
  });
});

describe("the watch on a member's calendar", () => {
  const subscriptions = "https://graph.microsoft.com/v1.0/subscriptions";
  const open = (pages: Record<string, { status: number; body: unknown }>) => {
    const { http, sent } = serving(pages);
    return { port: createMicrosoftCalendarAdapter({ http }).create({ credential }), sent };
  };

  it("subscribes to every change to the member's events, with the secret and one address for both kinds of notice", async () => {
    const { port, sent } = open({
      [subscriptions]: {
        status: 201,
        body: { id: "sub-1", expirationDateTime: "2026-11-13T11:59:00.000Z" },
      },
    });
    const begun = await port.watchChanges({
      address: "https://firm.example/notices",
      secret: "secret-1",
      expiresAt: "2026-11-13T12:00:00.000Z",
    });
    expect(begun).toEqual({
      ok: true,
      value: { watchId: "sub-1", expiresAt: "2026-11-13T11:59:00.000Z" },
    });
    expect(sent[0]?.method).toBe("POST");
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual({
      changeType: "created,updated,deleted",
      resource: "me/events",
      notificationUrl: "https://firm.example/notices",
      lifecycleNotificationUrl: "https://firm.example/notices",
      clientState: "secret-1",
      expirationDateTime: "2026-11-13T12:00:00.000Z",
    });
  });

  it("says so when Microsoft will not begin one", async () => {
    const { port } = open({ [subscriptions]: { status: 400, body: {} } });
    const begun = await port.watchChanges({
      address: "https://firm.example/notices",
      secret: "secret-1",
      expiresAt: "2026-11-13T12:00:00.000Z",
    });
    expect(begun.ok).toBe(false);
  });

  it("renews one, and answers null for one Microsoft no longer has", async () => {
    const { port, sent } = open({
      [`${subscriptions}/sub-1`]: {
        status: 200,
        body: { id: "sub-1", expirationDateTime: "2026-11-16T12:00:00.000Z" },
      },
    });
    expect(await port.renewWatch("sub-1", "2026-11-16T12:00:00.000Z")).toEqual({
      ok: true,
      value: { watchId: "sub-1", expiresAt: "2026-11-16T12:00:00.000Z" },
    });
    expect(sent[0]?.method).toBe("PATCH");
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual({
      expirationDateTime: "2026-11-16T12:00:00.000Z",
    });
    expect(await port.renewWatch("sub-gone", "2026-11-16T12:00:00.000Z")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("ends one, and counts one already gone as ended", async () => {
    const { port, sent } = open({ [`${subscriptions}/sub-1`]: { status: 204, body: {} } });
    expect(await port.stopWatch("sub-1")).toEqual({ ok: true, value: null });
    expect(sent[0]?.method).toBe("DELETE");
    expect(await port.stopWatch("sub-gone")).toEqual({ ok: true, value: null });
  });
});
