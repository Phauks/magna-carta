/*
 * The address a calendar provider posts its notices to, through the real chokepoint, and the
 * account's object behind it. What is pinned: the provider's validation token is answered back as
 * plain text; a notice carrying the account's secret brings its pass forward to a second away; a
 * notice without it, or to an account that has no watch, changes nothing and is answered exactly
 * the same; and a pass takes the mark of the request that asked for it as it starts.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { WatchState } from "../src/calendar-sync/change-watch.ts";
import { createApp } from "../src/http/app.ts";

const ORIGIN = "https://example.com";
const NOTICES = `${ORIGIN}/api/v1/calendar-sync/provider-notices/microsoft`;
const app = createApp();

const WATCH: WatchState = {
  watchId: "sub-1",
  secret: "a".repeat(64),
  expiresAt: "2026-11-13T12:00:00.000Z",
  address: `${NOTICES}/firm_notice01/connection_notice01`,
};

function account(name: string) {
  return env.CONNECTION_SYNC.get(env.CONNECTION_SYNC.idFromName(name));
}

async function post(path: string, body: unknown): Promise<Response> {
  return await app.request(
    `${NOTICES}/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
}

describe("a provider's notice that a calendar changed", () => {
  it("answers the provider's validation token back as plain text", async () => {
    const response = await app.request(
      `${NOTICES}/firm_notice01/connection_notice01?validationToken=${encodeURIComponent("Validation: Testing <b> 1+2")}`,
      { method: "POST", headers: { "content-type": "text/plain; charset=utf-8" } },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("Validation: Testing <b> 1+2");
  });

  it("brings the account's pass forward when the notice carries its secret", async () => {
    const stub = account("firm_notice01:connection_notice01");
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("watch", WATCH);
      await state.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
    });
    const before = Date.now();
    const response = await post("firm_notice01/connection_notice01", {
      value: [
        {
          subscriptionId: "sub-1",
          clientState: WATCH.secret,
          changeType: "updated",
          resource: "Users/u/Events/e",
          resourceData: { id: "e" },
        },
      ],
    });
    expect(response.status).toBe(202);
    const armed = await runInDurableObject(stub, async (_instance, state) => ({
      alarm: await state.storage.getAlarm(),
      asked: await state.storage.get<number>("asked"),
    }));
    expect(armed.asked).toBe(1000);
    expect(armed.alarm).not.toBeNull();
    expect((armed.alarm ?? 0) - before).toBeLessThan(5000);
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAll();
      await state.storage.deleteAlarm();
    });
  });

  it("marks the watch for replacing when the provider says it removed it", async () => {
    const stub = account("firm_notice02:connection_notice02");
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("watch", WATCH);
    });
    const response = await post("firm_notice02/connection_notice02", {
      value: [
        {
          subscriptionId: "sub-1",
          clientState: WATCH.secret,
          lifecycleEvent: "subscriptionRemoved",
        },
      ],
    });
    expect(response.status).toBe(202);
    const stored = await runInDurableObject(stub, async (_instance, state) => {
      const watch = await state.storage.get<WatchState>("watch");
      await state.storage.deleteAll();
      await state.storage.deleteAlarm();
      return watch;
    });
    expect(stored?.attention).toBe("replace");
  });

  it("changes nothing for a notice without the secret, and answers it the same", async () => {
    const stub = account("firm_notice03:connection_notice03");
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("watch", WATCH);
    });
    for (const body of [
      { value: [{ subscriptionId: "sub-1", clientState: "b".repeat(64), changeType: "updated" }] },
      { value: [{ subscriptionId: "sub-1", changeType: "updated" }] },
      { anything: "else" },
      "not json at all",
    ]) {
      expect((await post("firm_notice03/connection_notice03", body)).status).toBe(202);
    }
    const after = await runInDurableObject(stub, async (_instance, state) => {
      const found = {
        alarm: await state.storage.getAlarm(),
        asked: await state.storage.get("asked"),
      };
      await state.storage.deleteAll();
      return found;
    });
    expect(after).toEqual({ alarm: null, asked: undefined });
  });

  it("changes nothing for an account that has no watch", async () => {
    const response = await post("firm_notice04/connection_notice04", {
      value: [{ subscriptionId: "sub-1", clientState: WATCH.secret, changeType: "updated" }],
    });
    expect(response.status).toBe(202);
    const stored = await runInDurableObject(
      account("firm_notice04:connection_notice04"),
      async (_instance, state) => ({
        alarm: await state.storage.getAlarm(),
        keys: [...(await state.storage.list()).keys()],
      }),
    );
    expect(stored).toEqual({ alarm: null, keys: [] });
  });

  it("refuses an address no account could have", async () => {
    const response = await post("firm%3Anotice/connection", { value: [] });
    expect(response.status).toBe(422);
  });
});

describe("Google's notice that a calendar changed", () => {
  const GOOGLE_NOTICES = `${ORIGIN}/api/v1/calendar-sync/provider-notices/google`;

  async function postGoogle(path: string, headers: Record<string, string>): Promise<Response> {
    return await app.request(`${GOOGLE_NOTICES}/${path}`, { method: "POST", headers }, env);
  }

  it("brings the account's pass forward when the token header carries its secret", async () => {
    const stub = account("firm_notice06:connection_notice06");
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("watch", WATCH);
    });
    const response = await postGoogle("firm_notice06/connection_notice06", {
      "X-Goog-Channel-ID": "channel-1",
      "X-Goog-Channel-Token": WATCH.secret,
      "X-Goog-Resource-State": "exists",
    });
    expect(response.status).toBe(202);
    const armed = await runInDurableObject(stub, async (_instance, state) => {
      const found = {
        alarm: await state.storage.getAlarm(),
        asked: await state.storage.get<number>("asked"),
      };
      await state.storage.deleteAll();
      await state.storage.deleteAlarm();
      return found;
    });
    expect(armed.asked).toBe(1000);
    expect(armed.alarm).not.toBeNull();
  });

  it("changes nothing for the greeting, a wrong token or no token, and answers each the same", async () => {
    const stub = account("firm_notice07:connection_notice07");
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("watch", WATCH);
    });
    const attempts: Record<string, string>[] = [
      { "X-Goog-Channel-Token": WATCH.secret, "X-Goog-Resource-State": "sync" },
      { "X-Goog-Channel-Token": "b".repeat(64), "X-Goog-Resource-State": "exists" },
      { "X-Goog-Resource-State": "exists" },
    ];
    for (const headers of attempts) {
      expect((await postGoogle("firm_notice07/connection_notice07", headers)).status).toBe(202);
    }
    const after = await runInDurableObject(stub, async (_instance, state) => {
      const found = {
        alarm: await state.storage.getAlarm(),
        asked: await state.storage.get("asked"),
      };
      await state.storage.deleteAll();
      return found;
    });
    expect(after).toEqual({ alarm: null, asked: undefined });
  });
});

describe("the mark a request for a pass leaves", () => {
  it("is taken at the start of the pass, so only a later request leaves one for its end", async () => {
    const stub = account("firm_notice05:connection_notice05");
    const armed = await runInDurableObject(stub, async (instance, state) => {
      // A deployment with no Microsoft application: the pass itself does nothing and settles
      // nothing, which leaves the alarm bookkeeping as the only thing under test.
      await state.storage.put("identity", {
        firmId: "firm_notice05",
        connectionId: "connection_notice05",
        memberUserId: "user_notice05",
      });
      await state.storage.put("asked", 5000);
      await instance.alarm();
      const asked = await state.storage.get("asked");
      await state.storage.deleteAll();
      await state.storage.deleteAlarm();
      return asked;
    });
    // The mark is taken at the start of a pass, so one that began after the request owes nothing.
    expect(armed).toBeUndefined();
  });
});
