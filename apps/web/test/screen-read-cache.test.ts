/*
 * THE READS A SCREEN WAITS ON BEFORE IT CAN DRAW, answered from the one query cache.
 *
 * The session and the matter record are each read by every screen of their kind before that screen
 * has anything to show, so each used to be a full round trip in series in front of the screen's own
 * data — which is what the loading shape was standing in for. These cases pin the two halves of the
 * cache's bargain: an answer the app already holds is not asked for again, and an answer the app has
 * reason to doubt is.
 *
 * Pure node, with a counting fetch handed to each read and the cache emptied between cases.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { forgetSession, readSession } from "../src/lib/matters/matters-api.ts";
import { forgetMatterRecord, readMatterRecord } from "../src/lib/matters/matter-record.ts";
import { load as appLayoutLoad } from "../src/routes/(app)/+layout.ts";

const SESSION = {
  user: { id: "usr_1", name: "Ada Member", email: "ada@example.com" },
  firm: { id: "firm_1", name: "Goldsmith and Associates" },
  permissions: ["matters:read"],
  channel: "stable",
  flags: {},
  membership: { state: "active" },
};

const MATTER = {
  id: "mat_live_1",
  matterNumber: "2026-0001",
  title: "Estate of Hollis",
  status: "open",
};

/** A fetch that answers every request with `body` and counts what it was asked. */
function countingFetch(status: number, body: unknown): typeof fetch & { readonly asked: string[] } {
  const asked: string[] = [];
  const stub = ((input: RequestInfo | URL) => {
    asked.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch & { asked: string[] };
  stub.asked = asked;
  return stub;
}

beforeEach(() => {
  queryClient.clear();
});

afterEach(() => {
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the session read", () => {
  it("asks the server once, and answers the second caller from the cache", async () => {
    const fetchImpl = countingFetch(200, SESSION);
    const first = await readSession(fetchImpl);
    const second = await readSession(fetchImpl);
    expect(first).toEqual({ kind: "ok", value: SESSION });
    expect(second).toEqual({ kind: "ok", value: SESSION });
    expect(fetchImpl.asked).toEqual(["/api/v1/me"]);
  });

  it("answers from what the (app) guard already read on the way in", async () => {
    // The guard reads through the generated client; a screen reads through `readSession`. Both are
    // one cache entry, which is the whole saving: the screen's read costs nothing.
    const guardFetch = countingFetch(200, SESSION);
    client.setConfig({ baseUrl: "https://app.example", fetch: guardFetch });
    await appLayoutLoad({ url: new URL("https://app.example/time") } as never);
    expect(guardFetch.asked).toHaveLength(1);

    const screenFetch = countingFetch(200, SESSION);
    const outcome = await readSession(screenFetch);
    expect(outcome.kind).toBe("ok");
    expect(screenFetch.asked).toEqual([]);
  });

  it("asks the server when told the session has just changed", async () => {
    const fetchImpl = countingFetch(200, SESSION);
    await readSession(fetchImpl);
    await readSession(fetchImpl, { fresh: true });
    expect(fetchImpl.asked).toEqual(["/api/v1/me", "/api/v1/me"]);
  });

  it("asks again after it is forgotten", async () => {
    const fetchImpl = countingFetch(200, SESSION);
    await readSession(fetchImpl);
    forgetSession();
    await readSession(fetchImpl);
    expect(fetchImpl.asked).toHaveLength(2);
  });

  it("reports a refusal in the shape callers branch on, and does not keep it", async () => {
    const refusing = countingFetch(403, {
      type: "about:blank",
      title: "Forbidden",
      status: 403,
    });
    const outcome = await readSession(refusing);
    expect(outcome.kind).toBe("problem");

    const answering = countingFetch(200, SESSION);
    expect(await readSession(answering)).toEqual({ kind: "ok", value: SESSION });
    expect(answering.asked).toEqual(["/api/v1/me"]);
  });

  it("is forgotten when the guard sends somebody to the joining screen", async () => {
    // Otherwise the guard would judge their return — with a firm, now — against the cached "no firm
    // yet", and send them straight back.
    const firmless = countingFetch(200, { ...SESSION, firm: null });
    client.setConfig({ baseUrl: "https://app.example", fetch: firmless });
    await expect(
      Promise.resolve(appLayoutLoad({ url: new URL("https://app.example/home") } as never)),
    ).rejects.toMatchObject({ status: 307, location: "/welcome" });

    const joined = countingFetch(200, SESSION);
    client.setConfig({ baseUrl: "https://app.example", fetch: joined });
    await expect(
      Promise.resolve(appLayoutLoad({ url: new URL("https://app.example/home") } as never)),
    ).resolves.toEqual({});
    expect(joined.asked).toHaveLength(1);
  });
});

describe("the matter record read", () => {
  it("answers an arrival from the cache", async () => {
    const fetchImpl = countingFetch(200, MATTER);
    const first = await readMatterRecord(fetchImpl, MATTER.id, false);
    const second = await readMatterRecord(fetchImpl, MATTER.id, false);
    expect(first?.title).toBe(MATTER.title);
    expect(second).toEqual(first);
    expect(fetchImpl.asked).toEqual([`/api/v1/matters/${MATTER.id}`]);
  });

  it("goes to the server when the matter on screen is being re-read", async () => {
    // A re-run for the matter already on screen is an invalidation: a status change or a renumbering
    // asking what the server now holds. The cache must not answer it.
    const fetchImpl = countingFetch(200, MATTER);
    await readMatterRecord(fetchImpl, MATTER.id, false);
    await readMatterRecord(fetchImpl, MATTER.id, true);
    expect(fetchImpl.asked).toHaveLength(2);
  });

  it("asks again after it is forgotten", async () => {
    const fetchImpl = countingFetch(200, MATTER);
    await readMatterRecord(fetchImpl, MATTER.id, false);
    forgetMatterRecord(MATTER.id);
    await readMatterRecord(fetchImpl, MATTER.id, false);
    expect(fetchImpl.asked).toHaveLength(2);
  });

  it("never keeps an absence", async () => {
    const missing = countingFetch(404, { type: "about:blank", title: "Not Found", status: 404 });
    expect(await readMatterRecord(missing, MATTER.id, false)).toBeUndefined();

    const found = countingFetch(200, MATTER);
    expect((await readMatterRecord(found, MATTER.id, false))?.title).toBe(MATTER.title);
    expect(found.asked).toHaveLength(1);
  });
});
