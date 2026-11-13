// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
/*
 * The Build Information panel's Realtime row: each answer the routing service can give lands in one
 * state, and a deployment with no credentials is "not-configured" without a request being made.
 */
import { afterEach, describe, expect, it } from "vitest";
import { probeRealtimeService } from "../src/meetings/sfu/realtime-status.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";

afterEach(() => setSfuFetchForTests(null));

describe("probeRealtimeService", () => {
  it("reports not-configured, unasked, when a credential is missing", async () => {
    const status = await probeRealtimeService({ REALTIME_SFU_APP_ID: "app" }, 100);
    expect(status).toEqual({ id: "realtime", state: "not-configured", latencyMilliseconds: null });
  });

  it("reports connected when a session opens", async () => {
    setSfuFetchForTests(() => Promise.resolve(Response.json({ sessionId: "probe" })));
    expect((await probeRealtimeService({}, 100)).state).toBe("connected");
  });

  it.each([401, 403, 404])("reports refused on %i", async (status) => {
    setSfuFetchForTests(() => Promise.resolve(new Response("no", { status })));
    expect((await probeRealtimeService({}, 100)).state).toBe("refused");
  });

  it("reports unreachable on a fault, a throw, or a body with no session", async () => {
    setSfuFetchForTests(() => Promise.resolve(new Response("down", { status: 503 })));
    expect((await probeRealtimeService({}, 100)).state).toBe("unreachable");
    setSfuFetchForTests(() => Promise.reject(new Error("offline")));
    expect((await probeRealtimeService({}, 100)).state).toBe("unreachable");
    setSfuFetchForTests(() => Promise.resolve(Response.json({})));
    expect((await probeRealtimeService({}, 100)).state).toBe("unreachable");
  });
});
