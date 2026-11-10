// @node-runtime
/*
 * The provider's change watch, decided from what the account remembers and the time. What is
 * pinned: a watch with time left costs the provider nothing; one running short is renewed with its
 * secret kept; one the provider lost, or said is gone, is begun again with a new secret; a
 * provider that cannot answer never loses a watch that still has time; and a notice is believed
 * only by its secret.
 */
import { describe, expect, it } from "vitest";
import type { CalendarSyncPort } from "@magna-carta/calendar/sync-port";
import { adapterError, ok } from "@magna-carta/integrations/dispatch";
import { integrationProblem } from "@magna-carta/integrations/problem";
import {
  keepWatch,
  readNotices,
  watchAddressFor,
  WATCH_LIFETIME_MS,
  type WatchState,
} from "../src/calendar-sync/change-watch.ts";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const ADDRESS =
  "https://magnacarta.example/api/v1/calendar-sync/provider-notices/microsoft/firm_1/connection_1";
const inHours = (hours: number): string =>
  new Date(NOW.getTime() + hours * 60 * 60 * 1000).toISOString();

type Call =
  | { op: "watch"; address: string; secret: string; expiresAt: string }
  | { op: "renew"; watchId: string; expiresAt: string }
  | { op: "stop"; watchId: string };

function provider(answers: { renew?: "gone" | "down"; watch?: "down" } = {}): {
  port: CalendarSyncPort;
  calls: Call[];
} {
  const calls: Call[] = [];
  const down = () => adapterError(integrationProblem("network", 503, "down"));
  const port = {
    watchChanges: (request: { address: string; secret: string; expiresAt: string }) => {
      calls.push({ op: "watch", ...request });
      if (answers.watch === "down") return Promise.resolve(down());
      // The provider gives a little less than it was asked for.
      return Promise.resolve(ok({ watchId: "watch-new", expiresAt: inHours(71) }));
    },
    renewWatch: (watchId: string, expiresAt: string) => {
      calls.push({ op: "renew", watchId, expiresAt });
      if (answers.renew === "down") return Promise.resolve(down());
      return Promise.resolve(ok(answers.renew === "gone" ? null : { watchId, expiresAt }));
    },
    stopWatch: (watchId: string) => {
      calls.push({ op: "stop", watchId });
      return Promise.resolve(ok(null));
    },
  } as unknown as CalendarSyncPort;
  return { port, calls };
}

const held = (overrides: Partial<WatchState> = {}): WatchState => ({
  watchId: "watch-1",
  secret: "secret-1",
  expiresAt: inHours(60),
  address: ADDRESS,
  ...overrides,
});

async function keep(
  current: WatchState | null,
  port: CalendarSyncPort,
  address: string | undefined = ADDRESS,
) {
  return await keepWatch({
    port,
    current,
    address,
    now: () => NOW,
    newSecret: () => "secret-new",
  });
}

describe("keeping the provider's change watch", () => {
  it("begins one where there is none, asking for three days", async () => {
    const { port, calls } = provider();
    expect(await keep(null, port)).toEqual({
      watchId: "watch-new",
      secret: "secret-new",
      expiresAt: inHours(71),
      address: ADDRESS,
    });
    expect(calls).toEqual([
      {
        op: "watch",
        address: ADDRESS,
        secret: "secret-new",
        expiresAt: new Date(NOW.getTime() + WATCH_LIFETIME_MS).toISOString(),
      },
    ]);
  });

  it("asks the provider nothing while a watch has time left", async () => {
    const { port, calls } = provider();
    const current = held();
    expect(await keep(current, port)).toBe(current);
    expect(calls).toEqual([]);
  });

  it("renews one running short, keeping its secret", async () => {
    const { port, calls } = provider();
    expect(await keep(held({ expiresAt: inHours(40) }), port)).toEqual(
      held({ expiresAt: inHours(72) }),
    );
    expect(calls.map((call) => call.op)).toEqual(["renew"]);
  });

  it("renews at once when the provider asked for it, and forgets that it asked", async () => {
    const { port, calls } = provider();
    const kept = await keep(held({ attention: "renew" }), port);
    expect(kept).toEqual(held({ expiresAt: inHours(72) }));
    expect(kept?.attention).toBeUndefined();
    expect(calls.map((call) => call.op)).toEqual(["renew"]);
  });

  it("begins again when the provider no longer has the watch", async () => {
    const { port, calls } = provider({ renew: "gone" });
    const kept = await keep(held({ expiresAt: inHours(10) }), port);
    expect(kept).toMatchObject({ watchId: "watch-new", secret: "secret-new" });
    expect(calls.map((call) => call.op)).toEqual(["renew", "watch"]);
  });

  it("begins again when the provider said the watch is gone", async () => {
    const { port, calls } = provider();
    const kept = await keep(held({ attention: "replace" }), port);
    expect(kept).toMatchObject({ watchId: "watch-new", secret: "secret-new" });
    expect(calls.map((call) => call.op)).toEqual(["stop", "watch"]);
  });

  it("begins again at a new address, ending the watch at the old one", async () => {
    const { port, calls } = provider();
    const kept = await keep(held({ address: "https://old.example/notices" }), port);
    expect(kept).toMatchObject({ watchId: "watch-new", address: ADDRESS });
    expect(calls.map((call) => call.op)).toEqual(["stop", "watch"]);
  });

  it("keeps a watch that still has time when the provider cannot answer a renewal", async () => {
    const { port } = provider({ renew: "down" });
    const current = held({ expiresAt: inHours(40) });
    expect(await keep(current, port)).toBe(current);
    expect(await keep(held({ expiresAt: inHours(-1) }), port)).toBeNull();
  });

  it("remembers nothing when a watch could not be begun", async () => {
    const { port } = provider({ watch: "down" });
    expect(await keep(null, port)).toBeNull();
  });

  it("ends the watch in a deployment with no public address", async () => {
    const { port, calls } = provider();
    expect(
      await keepWatch({
        port,
        current: held(),
        address: undefined,
        now: () => NOW,
        newSecret: () => "secret-new",
      }),
    ).toBeNull();
    expect(calls).toEqual([{ op: "stop", watchId: "watch-1" }]);
  });
});

describe("where a provider is told to send notices", () => {
  const identity = { firmId: "firm_1", connectionId: "connection_1", memberUserId: "user_1" };
  it("is this deployment's stated public address, and nothing when it has none", () => {
    expect(
      watchAddressFor({ APP_BASE_URL: "https://magnacarta.example/" }, identity as never),
    ).toBe(ADDRESS);
    expect(watchAddressFor({}, identity as never)).toBeUndefined();
    expect(
      watchAddressFor({ APP_BASE_URL: "http://localhost:8787" }, identity as never),
    ).toBeUndefined();
  });
});

describe("reading a batch of notices", () => {
  it("believes none that lacks the watch's secret", () => {
    expect(readNotices(held(), [])).toBeNull();
    expect(readNotices(held(), [{ secret: "secret-2" }, { secret: "" }])).toBeNull();
    expect(readNotices(held(), [{ secret: "secret-2", lifecycle: "replace" }])).toBeNull();
  });

  it("wants a pass for one that carries it, and changes nothing else", () => {
    const watch = held();
    expect(readNotices(watch, [{ secret: "wrong" }, { secret: "secret-1" }])?.watch).toBe(watch);
    expect(readNotices(watch, [{ secret: "secret-1", lifecycle: "missed" }])?.watch).toBe(watch);
  });

  it("marks the watch where the provider said it needs attention", () => {
    expect(readNotices(held(), [{ secret: "secret-1", lifecycle: "renew" }])?.watch).toEqual(
      held({ attention: "renew" }),
    );
    expect(
      readNotices(held(), [
        { secret: "secret-1", lifecycle: "renew" },
        { secret: "secret-1", lifecycle: "replace" },
      ])?.watch,
    ).toEqual(held({ attention: "replace" }));
  });
});
