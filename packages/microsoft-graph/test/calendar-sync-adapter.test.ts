import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest } from "@magna-carta/integrations/http";
import { createMicrosoftCalendarAdapter, graphEventBody } from "../src/calendar-sync-adapter.ts";

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
