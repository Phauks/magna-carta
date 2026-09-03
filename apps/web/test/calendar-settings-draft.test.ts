/*
 * The firm's calendar settings draft: what it reads, what it stages, and what it sends. The page
 * renders these answers through the shared settings rows and footer and decides none of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarContext } from "$lib/calendar/calendar-context.svelte.ts";
import {
  CalendarSettingsDraft,
  WEEK_STARTS_ON_DEFINITION,
  weekStartsOnFromValue,
} from "$lib/calendar/calendar-settings-draft.svelte.ts";

interface Seen {
  method: string;
  url: string;
  idempotencyKey: string | null;
  body: unknown;
}

function fakeServer(initial: 0 | 1, patchStatus = 200) {
  let weekStartsOn: 0 | 1 = initial;
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    seen.push({ method, url, idempotencyKey: headers.get("Idempotency-Key"), body });
    if (method === "PATCH") {
      if (patchStatus !== 200) {
        return new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Refused",
            status: patchStatus,
            detail: "no",
          }),
          { status: patchStatus, headers: { "content-type": "application/problem+json" } },
        );
      }
      if (body?.weekStartsOn !== undefined) weekStartsOn = body.weekStartsOn;
    }
    return new Response(JSON.stringify({ weekStartsOn }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, seen };
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => `key-${Math.random().toString(36).slice(2)}` });
});
afterEach(() => {
  vi.unstubAllGlobals();
  calendarContext.noteWeekStartsOn(0);
});

describe("the calendar settings draft", () => {
  it("answers from the firm's own read, and is not loaded before it", async () => {
    const server = fakeServer(1);
    const draft = new CalendarSettingsDraft(server.fetch);
    expect(draft.loaded).toBe(false);
    await draft.load();
    expect(draft.loaded).toBe(true);
    expect(server.seen[0]).toMatchObject({ method: "GET", url: "/api/v1/calendar/settings" });
    expect(draft.value(WEEK_STARTS_ON_DEFINITION)).toBe("1");
    expect(draft.stagedValue(WEEK_STARTS_ON_DEFINITION)).toBe("1");
    expect(draft.stagedCount).toBe(0);
  });

  it("stages a different day as one change, and the same day as none", async () => {
    const draft = new CalendarSettingsDraft(fakeServer(0).fetch);
    await draft.load();
    draft.stage(WEEK_STARTS_ON_DEFINITION, "1");
    expect(draft.isStaged(WEEK_STARTS_ON_DEFINITION)).toBe(true);
    expect(draft.stagedCount).toBe(1);
    expect(draft.stagedEntries).toEqual([
      { definition: WEEK_STARTS_ON_DEFINITION, from: "0", to: "1" },
    ]);
    expect(draft.stagedValue(WEEK_STARTS_ON_DEFINITION)).toBe("1");
    expect(draft.value(WEEK_STARTS_ON_DEFINITION)).toBe("0");

    draft.stage(WEEK_STARTS_ON_DEFINITION, "0");
    expect(draft.stagedCount).toBe(0);

    // A day the vocabulary does not carry never reaches the wire.
    draft.stage(WEEK_STARTS_ON_DEFINITION, "3");
    expect(draft.stagedCount).toBe(0);
    expect(weekStartsOnFromValue("3")).toBeNull();
  });

  it("sends one PATCH under an idempotency key, takes the server's answer, and tells the calendar", async () => {
    const server = fakeServer(0);
    const draft = new CalendarSettingsDraft(server.fetch);
    await draft.load();
    draft.stage(WEEK_STARTS_ON_DEFINITION, "1");
    await draft.commit();
    const patch = server.seen.find((request) => request.method === "PATCH");
    expect(patch).toMatchObject({
      url: "/api/v1/calendar/settings",
      body: { weekStartsOn: 1 },
    });
    expect(patch?.idempotencyKey).toMatch(/^key-/);
    expect(draft.committed).toEqual({ weekStartsOn: 1 });
    expect(draft.stagedCount).toBe(0);
    expect(draft.saveFailure).toBeNull();
    expect(calendarContext.weekStartsOn).toBe(1);
  });

  it("keeps the stage when the save is refused, and retries under a new key", async () => {
    const server = fakeServer(0, 403);
    const draft = new CalendarSettingsDraft(server.fetch);
    await draft.load();
    draft.stage(WEEK_STARTS_ON_DEFINITION, "1");
    await draft.commit();
    expect(draft.saveFailure).not.toBeNull();
    expect(draft.stagedCount).toBe(1);
    expect(draft.committed).toEqual({ weekStartsOn: 0 });
    expect(calendarContext.weekStartsOn).toBe(0);

    await draft.commit();
    const keys = server.seen
      .filter((request) => request.method === "PATCH")
      .map((request) => request.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);

    draft.discard();
    expect(draft.stagedCount).toBe(0);
    expect(draft.saveFailure).toBeNull();
  });

  it("saves nothing when nothing is staged", async () => {
    const server = fakeServer(0);
    const draft = new CalendarSettingsDraft(server.fetch);
    await draft.load();
    await draft.commit();
    expect(server.seen.filter((request) => request.method === "PATCH")).toHaveLength(0);
  });
});
