// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
/*
 * The System Status rows for Google and Microsoft: a deployment with no application is
 * "not-configured" with no request made, and each answer a provider can give lands in one state.
 */
import type { HttpClient } from "@magna-carta/integrations/http";
import { describe, expect, it } from "vitest";
import { probeCalendarProviders } from "../src/calendar-sync/provider-status.ts";
import { featureStatuses } from "../src/system-status/feature-roster.ts";

function answering(byHost: Record<string, { status: number; body: unknown }>): {
  http: HttpClient;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    http: {
      request: (input) => {
        const host = new URL(input.url).host;
        asked.push(host);
        const answer = byHost[host] ?? { status: 503, body: {} };
        return Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.body) });
      },
    },
  };
}

const google = { GOOGLE_CALENDAR_CLIENT_ID: "client", GOOGLE_CALENDAR_CLIENT_SECRET: "secret" };

describe("probeCalendarProviders", () => {
  it("asks nobody when no application is registered", async () => {
    const { http, asked } = answering({});
    expect(await probeCalendarProviders({}, http, 100)).toEqual([
      { id: "googleCalendar", state: "not-configured", latencyMilliseconds: null },
      { id: "microsoftCalendar", state: "not-configured", latencyMilliseconds: null },
    ]);
    expect(asked).toEqual([]);
  });

  it("reports connected when Google recognises the application", async () => {
    const { http, asked } = answering({
      "oauth2.googleapis.com": { status: 400, body: { error: "invalid_grant" } },
    });
    const rows = await probeCalendarProviders(google, http, 100);
    expect(rows[0]?.state).toBe("connected");
    expect(rows[1]?.state).toBe("not-configured");
    expect(asked).toEqual(["oauth2.googleapis.com"]);
  });

  it("reports refused on a wrong secret, and unreachable when there is no answer in time", async () => {
    const refused = answering({
      "oauth2.googleapis.com": { status: 401, body: { error: "invalid_client" } },
    });
    expect((await probeCalendarProviders(google, refused.http, 100))[0]?.state).toBe("refused");
    const silent: HttpClient = { request: () => new Promise(() => {}) };
    expect((await probeCalendarProviders(google, silent, 20))[0]?.state).toBe("unreachable");
  });
});

describe("the calendar features on System Status", () => {
  const probes = (state: "connected" | "refused") => ({
    workers: new Map(),
    connectedServices: new Map([["googleCalendar", state]]),
  });
  const stateOf = (state: "connected" | "refused") =>
    featureStatuses(google, probes(state)).find((feature) => feature.id === "googleCalendarSync")
      ?.state;

  it("is working only when Google accepts the keys, and a fault when it refuses them", () => {
    expect(stateOf("connected")).toBe("working");
    expect(stateOf("refused")).toBe("fault");
  });
});
