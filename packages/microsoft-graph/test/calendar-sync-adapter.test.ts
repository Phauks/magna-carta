import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest } from "@magna-carta/integrations/http";
import { createMicrosoftCalendarAdapter } from "../src/calendar-sync-adapter.ts";

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
