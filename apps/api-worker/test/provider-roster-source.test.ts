import type { HttpClient } from "@magna-carta/integrations/http";
import type { Logger } from "@magna-carta/telemetry/logger";
import { describe, expect, it } from "vitest";
import { readProviderRoster } from "../src/inference/provider-roster-source.ts";

// The composition root for the provider's live model list: an absent key is a supported state, a
// listing is cached, and a failure is logged once and degrades to the curated roster.

function memoryCache(): Cache {
  const store = new Map<string, string>();
  return {
    async match(request: RequestInfo | URL) {
      const body = store.get(String(request));
      return body === undefined ? undefined : new Response(body);
    },
    async put(request: RequestInfo | URL, response: Response) {
      store.set(String(request), await response.text());
    },
    async delete() {
      return false;
    },
  } as unknown as Cache;
}

function countingHttp(status: number, body: unknown): { http: HttpClient; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    http: {
      async request() {
        calls += 1;
        return { status, json: async () => body };
      },
    },
  };
}

function recordingLogger(): { logger: Logger; events: unknown[] } {
  const events: unknown[] = [];
  return { events, logger: { log: (event: unknown) => events.push(event) } as unknown as Logger };
}

describe("readProviderRoster", () => {
  it("without a key, never calls out and reports not-configured", async () => {
    const { http, calls } = countingHttp(200, { data: [] });
    const snapshot = await readProviderRoster({ apiKey: undefined, http, cache: memoryCache() });
    expect(snapshot).toEqual({ status: "not-configured", checkedAt: null, models: [] });
    expect(calls()).toBe(0);
  });

  it("reads the provider once and serves the cached list after", async () => {
    const cache = memoryCache();
    const { http, calls } = countingHttp(200, {
      data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }],
      has_more: false,
    });
    const now = () => "2026-11-09T12:00:00.000Z";
    const first = await readProviderRoster({ apiKey: "key", http, cache, now });
    const second = await readProviderRoster({ apiKey: "key", http, cache, now });
    expect(first.status).toBe("live");
    expect(second).toEqual(first);
    expect(calls()).toBe(1);
  });

  it("logs a failure once, without the credential, and degrades to unreachable", async () => {
    const { http } = countingHttp(503, undefined);
    const { logger, events } = recordingLogger();
    const snapshot = await readProviderRoster({
      apiKey: "secret-key-value",
      http,
      cache: memoryCache(),
      logger,
    });
    expect(snapshot.status).toBe("unreachable");
    expect(snapshot.models).toEqual([]);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("secret-key-value");
  });
});
