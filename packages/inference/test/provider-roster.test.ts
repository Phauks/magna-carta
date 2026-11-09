import type { HttpClient, HttpRequest } from "@magna-carta/integrations/http";
import { describe, expect, it } from "vitest";
import { reasoningEntries } from "../src/catalog.ts";
import {
  ANTHROPIC_API_VERSION,
  listAnthropicModels,
  reconcileProviderRoster,
  type ProviderRosterSnapshot,
} from "../src/provider-roster.ts";

function scriptedHttp(pages: ReadonlyArray<{ status: number; body?: unknown }>): {
  http: HttpClient;
  requests: HttpRequest[];
} {
  const requests: HttpRequest[] = [];
  let index = 0;
  return {
    requests,
    http: {
      async request(input) {
        requests.push(input);
        const page = pages[index] ?? { status: 500 };
        index += 1;
        return { status: page.status, json: async () => page.body };
      },
    },
  };
}

describe("listAnthropicModels", () => {
  it("reads every page, sending the key and API version, and maps the provider's fields", async () => {
    const { http, requests } = scriptedHttp([
      {
        status: 200,
        body: {
          data: [
            { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-09-22" },
          ],
          has_more: true,
          last_id: "claude-opus-5-5",
        },
      },
      {
        status: 200,
        body: {
          data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }],
          has_more: false,
          last_id: "claude-haiku-5-5",
        },
      },
    ]);
    const outcome = await listAnthropicModels({ http, apiKey: "key" });
    expect(outcome).toEqual({
      kind: "ok",
      models: [
        { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", createdAt: "2026-09-22" },
        { id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5", createdAt: null },
      ],
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers).toEqual({
      "x-api-key": "key",
      "anthropic-version": ANTHROPIC_API_VERSION,
    });
    expect(requests[1]?.url).toContain("after_id=claude-opus-5-5");
  });

  it("reports a non-200 as a failure carrying the status, never the body", async () => {
    const { http } = scriptedHttp([{ status: 401, body: { error: "secret detail" } }]);
    expect(await listAnthropicModels({ http, apiKey: "bad" })).toEqual({
      kind: "failed",
      reason: "status 401",
    });
  });

  it("reports a transport failure and an unexpected shape without throwing", async () => {
    const throwing: HttpClient = {
      request: async () => {
        throw new TypeError("network down");
      },
    };
    expect(await listAnthropicModels({ http: throwing, apiKey: "key" })).toEqual({
      kind: "failed",
      reason: "transport: TypeError",
    });
    const { http } = scriptedHttp([{ status: 200, body: { models: [] } }]);
    expect(await listAnthropicModels({ http, apiKey: "key" })).toEqual({
      kind: "failed",
      reason: "unexpected response shape",
    });
  });
});

describe("reconcileProviderRoster", () => {
  const entries = reasoningEntries();

  it("with no live list, says nothing about publication and lists nothing as awaiting", () => {
    const snapshot: ProviderRosterSnapshot = {
      status: "not-configured",
      checkedAt: null,
      models: [],
    };
    const result = reconcileProviderRoster(entries, snapshot);
    for (const entry of entries) expect(result.published.get(entry.modelId)).toBeNull();
    expect(result.awaitingVerification).toEqual([]);
  });

  it("marks curated models published or not, and reports uncurated ones newest first without offering them", () => {
    const snapshot: ProviderRosterSnapshot = {
      status: "live",
      checkedAt: "2026-11-09T00:00:00.000Z",
      models: [
        { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", createdAt: "2026-09-22" },
        { id: "claude-fable-5", displayName: "Claude Fable 5", createdAt: "2026-06-09" },
        { id: "claude-fable-5-1", displayName: "Claude Fable 5.1", createdAt: "2026-09-01" },
      ],
    };
    const result = reconcileProviderRoster(entries, snapshot);
    expect(result.published.get("anthropic/claude-opus-5-5")).toBe(true);
    // A curated model the live list omits is reported, never dropped from the roster.
    expect(result.published.get("anthropic/claude-sonnet-5-5")).toBe(false);
    expect(result.awaitingVerification.map((model) => model.id)).toEqual([
      "claude-fable-5-1",
      "claude-fable-5",
    ]);
    // The reconciliation returns information only: the curated roster is the same object list.
    expect(reasoningEntries()).toEqual(entries);
  });
});
