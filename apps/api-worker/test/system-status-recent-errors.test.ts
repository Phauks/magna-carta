// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
/*
 * The recent-errors read: its four outcomes, the query it sends to Workers Logs, and the folding
 * of events into one row per kind of failure. The API is never called; a fake fetch stands in.
 */
import { describe, expect, it } from "vitest";
import { groupRecentErrors, readRecentErrors } from "../src/system-status/recent-errors.ts";

const CONFIGURED = { CLOUDFLARE_ACCOUNT_ID: "account", OBSERVABILITY_API_TOKEN: "token" };

function logEvent(overrides: {
  name?: string;
  timestamp: number;
  errorId?: string;
  route?: string;
  service?: string;
}): unknown {
  return {
    $metadata: { id: String(overrides.timestamp), service: overrides.service ?? "magna-carta" },
    dataset: "cloudflare-workers",
    timestamp: overrides.timestamp,
    source: {
      name: overrides.name ?? "error.captured",
      fields: {
        errorId: overrides.errorId ?? `error_${String(overrides.timestamp)}`,
        route: overrides.route ?? "/api/v1/matters",
        method: "GET",
        errorName: "TypeError",
        messageHead: "Cannot read properties of undefined",
      },
    },
  };
}

describe("readRecentErrors", () => {
  it("is not configured without both the account id and the token", async () => {
    expect(await readRecentErrors({ CLOUDFLARE_ACCOUNT_ID: "account" })).toEqual({
      state: "not-configured",
    });
    expect(await readRecentErrors({ OBSERVABILITY_API_TOKEN: "token" })).toEqual({
      state: "not-configured",
    });
  });

  it("a rejected token is refused", async () => {
    const report = await readRecentErrors(CONFIGURED, {
      fetchImplementation: () => Promise.resolve(new Response("", { status: 403 })),
    });
    expect(report).toEqual({ state: "refused" });
  });

  it("a fault or a throw is unreachable", async () => {
    expect(
      await readRecentErrors(CONFIGURED, {
        fetchImplementation: () => Promise.resolve(new Response("", { status: 502 })),
      }),
    ).toEqual({ state: "unreachable" });
    expect(
      await readRecentErrors(CONFIGURED, {
        fetchImplementation: () => Promise.reject(new Error("offline")),
      }),
    ).toEqual({ state: "unreachable" });
  });

  it("asks for the two failure events over the last day, with the token as a bearer", async () => {
    let sent: { url: string; init: RequestInit | undefined } | null = null;
    const now = Date.parse("2026-11-13T12:00:00Z");
    await readRecentErrors(CONFIGURED, {
      now,
      fetchImplementation: (input, init) => {
        sent = { url: String(input), init };
        return Promise.resolve(Response.json({ success: true, result: { events: { events: [] } } }));
      },
    });
    expect(sent).not.toBeNull();
    const request = sent as unknown as { url: string; init: RequestInit };
    expect(request.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
    );
    expect(new Headers(request.init.headers).get("authorization")).toBe("Bearer token");
    const body = JSON.parse(String(request.init.body)) as {
      timeframe: { from: number; to: number };
      view: string;
      parameters: { filters: { value: string }[]; filterCombination: string };
    };
    expect(body.view).toBe("events");
    expect(body.timeframe.to - body.timeframe.from).toBe(24 * 60 * 60 * 1000);
    expect(body.parameters.filters.map((filter) => filter.value)).toEqual([
      "error.captured",
      "operation.failed",
    ]);
    expect(body.parameters.filterCombination).toBe("or");
  });

  it("a read folds the events and counts them", async () => {
    const report = await readRecentErrors(CONFIGURED, {
      fetchImplementation: () =>
        Promise.resolve(
          Response.json({
            success: true,
            result: {
              events: { events: [logEvent({ timestamp: 1 }), logEvent({ timestamp: 2 })] },
            },
          }),
        ),
    });
    expect(report.state).toBe("read");
    if (report.state !== "read") return;
    expect(report.total).toBe(2);
    expect(report.truncated).toBe(false);
    expect(report.groups).toHaveLength(1);
  });
});

describe("groupRecentErrors", () => {
  it("folds one kind of failure into one row with its newest Error ID", () => {
    const groups = groupRecentErrors([
      logEvent({ timestamp: 1000, errorId: "error_old" }),
      logEvent({ timestamp: 3000, errorId: "error_new" }),
      logEvent({ timestamp: 2000, errorId: "error_middle" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      count: 3,
      latestErrorId: "error_new",
      where: "GET /api/v1/matters",
      service: "magna-carta",
      firstSeen: new Date(1000).toISOString(),
      lastSeen: new Date(3000).toISOString(),
    });
  });

  it("keeps different places and Workers apart, newest first", () => {
    const groups = groupRecentErrors([
      logEvent({ timestamp: 1000, route: "/api/v1/matters" }),
      logEvent({ timestamp: 5000, route: "/api/v1/tasks" }),
      logEvent({ timestamp: 3000, service: "magna-carta-scan" }),
    ]);
    expect(groups.map((group) => group.lastSeen)).toEqual([
      new Date(5000).toISOString(),
      new Date(3000).toISOString(),
      new Date(1000).toISOString(),
    ]);
  });

  it("a background failure is placed by its operation", () => {
    const [group] = groupRecentErrors([
      {
        timestamp: 1,
        source: {
          name: "operation.failed",
          fields: { operation: "digest-sweep", errorId: "error_x", errorName: "Error" },
        },
      },
    ]);
    expect(group?.where).toBe("digest-sweep");
  });

  it("ignores events that are not failures, or that it cannot read", () => {
    expect(
      groupRecentErrors([
        { timestamp: 1, source: { name: "email.sent", fields: {} } },
        { timestamp: 2, source: "a plain text line" },
        null,
      ]),
    ).toEqual([]);
  });
});
