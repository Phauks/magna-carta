import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { BundleBuildCoordinator } from "../src/downloads/bundle-coordinator.ts";
import type { BundleBuildMessage } from "../src/downloads/bundle-types.ts";
import { subscribeRequestUrl } from "../src/progress/job-progress-sockets.ts";

// Push progress on the bundle-build coordinator, against real Miniflare Durable Object storage and a
// real WebSocket pair.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. The local test pool cannot evict a Durable Object from memory
// on demand, so nothing here forces an actual hibernate/wake cycle — that behaviour is the runtime's
// and is not reproducible in-process. What IS exercised, and is the part this code has to get right,
// is everything hibernation depends on: the socket is accepted through `ctx.acceptWebSocket` (so the
// runtime, not a class property, owns the server end), the subscription context is written to the
// per-socket attachment (the only place it would survive an eviction), the keepalive auto-response is
// registered with the runtime rather than answered by a handler, and every pushed frame is resolved
// from durable storage plus that attachment — never from anything held on the instance. A regression
// that reintroduced instance state would show up here as a state read from the wrong place, not as a
// silent failure only production could find.

const BUCKET = "R2";

function message(hash: string): BundleBuildMessage {
  return {
    firmId: "firm_1",
    bucketName: BUCKET,
    manifestHash: hash,
    entries: [{ r2Key: "files/f1/v1", path: "a.pdf" }],
  };
}

function coordinatorStub(name: string) {
  return env.BUNDLE_COORDINATOR.get(env.BUNDLE_COORDINATOR.idFromName(name));
}

// Drives the coordinator to `building` without enqueuing a real build.
async function primeBuilding(stub: ReturnType<typeof coordinatorStub>, hash: string) {
  await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, BUNDLE_BUILD: { send: async () => {} } };
    await instance.requestBundle(message(hash));
  });
}

interface Subscription {
  readonly socket: WebSocket;
  readonly frames: Record<string, unknown>[];
  closeCode(): number | null;
}

async function subscribe(stub: ReturnType<typeof coordinatorStub>): Promise<Subscription> {
  const response = await stub.fetch(
    new Request(subscribeRequestUrl(BUCKET), { headers: { Upgrade: "websocket" } }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("the coordinator returned no WebSocket on the 101");
  const frames: Record<string, unknown>[] = [];
  let closeCode: number | null = null;
  socket.accept();
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string) as Record<string, unknown>);
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  await settle();
  return { socket, frames, closeCode: () => closeCode };
}

// Lets queued socket events reach their listeners. A frame the server produced during an awaited
// coordinator call is already on its way by the time that call returns, so one turn is enough.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// A frame the server sent in ANSWER to something the client sent is different: it takes a real round
// trip into the object and back, which a zero-delay turn does not wait for. Poll on a short real
// delay instead of guessing a fixed sleep.
async function frameAt(
  subscription: Subscription,
  index: number,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100 && subscription.frames.length <= index; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const frame = subscription.frames[index];
  if (frame === undefined) throw new Error(`no frame arrived at index ${index}`);
  return frame;
}

describe("BundleBuildCoordinator push progress", () => {
  it("refuses a plain request — the object's fetch serves subscriptions only", async () => {
    const stub = coordinatorStub("firm_1:socket-plain");
    const response = await stub.fetch(new Request(subscribeRequestUrl(BUCKET)));
    expect(response.status).toBe(426);
  });

  it("refuses an upgrade that names no resolved bucket", async () => {
    const stub = coordinatorStub("firm_1:socket-nobucket");
    const response = await stub.fetch(
      new Request("https://job-progress.invalid/subscribe", { headers: { Upgrade: "websocket" } }),
    );
    expect(response.status).toBe(400);
  });

  it("sends a job that is already settled once, then closes without ever holding the socket", async () => {
    // Subscribing to a hash nothing was ever built for: the coordinator reports the unknown job as
    // failed, which is terminal, so the subscriber is told once and the socket closes immediately.
    const stub = coordinatorStub("firm_1:socket-unknown");
    const subscription = await subscribe(stub);
    expect(subscription.frames).toEqual([
      { type: "state", protocolVersion: 1, state: { status: "failed" } },
    ]);
    expect(subscription.closeCode()).toBe(1000);
  });

  it("sends the current state on connect, so a subscriber never polls once first", async () => {
    const hash = "socket-initial";
    const stub = coordinatorStub(`firm_1:${hash}`);
    await primeBuilding(stub, hash);

    const subscription = await subscribe(stub);
    expect(subscription.frames).toEqual([
      { type: "state", protocolVersion: 1, state: { status: "building" } },
    ]);
  });

  it("pushes the ready transition with the signed URL, then closes", async () => {
    const hash = "socket-ready";
    await env.R2.put(`bundles/${hash}.zip`, "PK-fake-zip");
    const stub = coordinatorStub(`firm_1:${hash}`);
    await primeBuilding(stub, hash);
    const subscription = await subscribe(stub);

    await stub.markReady(`bundles/${hash}.zip`);
    await settle();

    expect(subscription.frames).toHaveLength(2);
    const pushed = subscription.frames[1] as {
      type: string;
      state: { status: string; url?: string };
    };
    expect(pushed.type).toBe("state");
    expect(pushed.state.status).toBe("ready");
    expect(pushed.state.url ?? "").toContain(`${BUCKET}/bundles/${hash}.zip`);
    // A settled job will never transition again, so the socket is closed rather than held open.
    expect(subscription.closeCode()).toBe(1000);
  });

  it("pushes the failed transition", async () => {
    const hash = "socket-failed";
    const stub = coordinatorStub(`firm_1:${hash}`);
    await primeBuilding(stub, hash);
    const subscription = await subscribe(stub);

    await stub.markFailed("engine unavailable");
    await settle();

    expect(subscription.frames[1]).toEqual({
      type: "state",
      protocolVersion: 1,
      // The pushed state is the poll body verbatim — which carries no error string, so a failure
      // reason is never leaked to a subscriber that the poll would not have given it.
      state: { status: "failed" },
    });
    expect(subscription.closeCode()).toBe(1000);
  });

  it("pushes a ready job whose artifact was reaped as expired, never a URL that 404s", async () => {
    const hash = "socket-reaped";
    const stub = coordinatorStub(`firm_1:${hash}`);
    await primeBuilding(stub, hash);
    const subscription = await subscribe(stub);

    // Ready in the coordinator, nothing in R2 — the `bundles/` lifecycle rule reaped it.
    await stub.markReady(`bundles/${hash}.zip`);
    await settle();

    expect(subscription.frames[1]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { status: "expired" },
    });
  });

  it("answers resync with the current state and refuses an unknown frame without dropping the socket", async () => {
    const hash = "socket-resync";
    const stub = coordinatorStub(`firm_1:${hash}`);
    await primeBuilding(stub, hash);
    const subscription = await subscribe(stub);

    subscription.socket.send('{"type":"resync"}');
    expect(await frameAt(subscription, 1)).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { status: "building" },
    });

    subscription.socket.send('{"type":"subscribe"}');
    expect(await frameAt(subscription, 2)).toEqual({ type: "refused", reason: "unknown-frame" });
    expect(subscription.closeCode()).toBeNull();
  });

  it("keeps the subscription in the hibernation-durable slots, never on the instance", async () => {
    const hash = "socket-hibernation";
    const stub = coordinatorStub(`firm_1:${hash}`);
    await primeBuilding(stub, hash);
    await subscribe(stub);

    await runInDurableObject(stub, async (_instance: BundleBuildCoordinator, state) => {
      // The runtime owns the server end (this is what `ctx.acceptWebSocket` buys) — a socket held in
      // a class property would not be here.
      const sockets = state.getWebSockets();
      expect(sockets).toHaveLength(1);
      // And the subscriber's context is on the socket, which is the only place it survives an
      // eviction. The bucket a signed URL is minted against is read from here, per socket.
      expect((sockets[0] as WebSocket).deserializeAttachment()).toEqual({
        protocolVersion: 1,
        bucketName: BUCKET,
      });
      // Keepalives are answered by the runtime, so an idle tab's heartbeat never wakes the object.
      const autoResponse = state.getWebSocketAutoResponse();
      expect(autoResponse?.request).toBe('{"type":"ping"}');
      expect(autoResponse?.response).toBe('{"type":"pong"}');
    });
  });

  it("still answers a ping that did not match the auto-response byte-for-byte", async () => {
    const hash = "socket-ping";
    const stub = coordinatorStub(`firm_1:${hash}`);
    await primeBuilding(stub, hash);
    const subscription = await subscribe(stub);

    subscription.socket.send('{ "type": "ping" }');
    expect(await frameAt(subscription, 1)).toEqual({ type: "pong" });
  });
});
