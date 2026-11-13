import { env, runInDurableObject } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type {
  FirmId,
  MagnusConversationId,
  MagnusTurnId,
  UserId,
} from "@magna-carta/identifiers/types";
import { startConversation } from "@magna-carta/magnus/conversation";
import { completeTurn, submitTurn } from "@magna-carta/magnus/turn";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { MagnusConversation } from "../src/magnus/magnus-conversation.ts";
import { magnusSubscribeRequestUrl } from "../src/magnus/magnus-sockets.ts";
import { MAX_CLIENT_FRAME_BYTES, PING_FRAME } from "../src/progress/job-progress-protocol.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// The conversation push surface. The scope note the shipped twins carry applies here too: the local
// test pool cannot evict a Durable Object, so the hibernate/wake cycle itself is not exercised — what
// IS exercised is that every fact a woken object would need lives where it would survive (the
// per-socket attachment), that the object stores nothing of its own, and that what a subscriber is
// pushed matches what the poll endpoint would have returned.

let firmId: FirmId;
let otherFirmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const USER = "user_magnusSocketTester00" as UserId;
const clock = { now: () => new Date().toISOString() };

// A push costs a round trip into the firm's own database object, and this suite shares the box with
// three other Workers runtimes, so a fixed number of macrotasks is not a wait — it is a guess that
// gets worse under load. Wait on real elapsed time for the condition instead.
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForFrames(subscription: Subscription, count: number): Promise<void> {
  await waitFor(() => subscription.frames.length >= count);
  expect(subscription.frames.length).toBeGreaterThanOrEqual(count);
}

function conversationStub(name: string) {
  return env.MAGNUS_CONVERSATION.get(env.MAGNUS_CONVERSATION.idFromName(name));
}

interface Subscription {
  readonly frames: Record<string, unknown>[];
  send(data: string | ArrayBuffer): void;
  closeCode(): number | null;
}

async function subscribe(
  stub: ReturnType<typeof conversationStub>,
  subscribedFirmId: string,
  conversationId: string,
): Promise<Subscription> {
  const response = await stub.fetch(
    new Request(magnusSubscribeRequestUrl(subscribedFirmId, conversationId), {
      headers: { Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no WebSocket on the 101");
  const frames: Record<string, unknown>[] = [];
  let closeCode: number | null = null;
  socket.accept();
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  // The connect frame is sent before the object returns its 101, but it still has to cross the pair
  // and reach this listener. Every caller asserts on it, so wait for it here rather than in each.
  await waitFor(() => frames.length > 0);
  return {
    frames,
    send: (data) => {
      socket.send(data as string);
    },
    closeCode: () => closeCode,
  };
}

// Composes a conversation with one submitted turn, leaving the Magnus turn pending.
async function conversationWithPendingTurn(): Promise<{
  conversationId: MagnusConversationId;
  magnusTurnId: MagnusTurnId;
}> {
  const context = { clock, actorUserId: USER };
  const started = startConversation(firmDatabase, context, {
    title: null,
    createdBy: USER,
    matterId: null,
  });
  await commitEffectBatch(firmDatabase, started.effect, { now: clock.now });
  const submission = submitTurn(firmDatabase, context, {
    conversationId: started.conversationId,
    content: "watch this answer arrive",
    nextSequence: 0,
    disclosureVersion: 1,
  });
  if (!submission.ok) throw new Error("submission refused");
  await commitEffectBatch(firmDatabase, submission.effect, { now: clock.now });
  return { conversationId: started.conversationId, magnusTurnId: submission.magnusTurnId };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Magnus Socket Firm" })).firmId;
  otherFirmId = (await seedFirm({ name: "Magnus Socket Other Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
});

describe("MagnusConversation push", () => {
  it("sends the current state on connect and the transition when the turn settles", async () => {
    const { conversationId, magnusTurnId } = await conversationWithPendingTurn();
    const stub = conversationStub(`${firmId}:${conversationId}`);
    const subscription = await subscribe(stub, firmId, conversationId);

    expect(subscription.frames[0]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { turnId: magnusTurnId, status: "pending" },
    });
    expect(subscription.closeCode()).toBeNull();

    const completion = completeTurn(
      firmDatabase,
      { clock, actorUserId: null },
      {
        conversationId,
        magnusTurnId,
        content: "an answer",
        modelId: "anthropic/claude-opus-5-5",
        snapshotId: "stub",
        inputTokens: 3,
        outputTokens: 4,
        contextTruncated: false,
        effort: null,
      },
    );
    expect(completion.ok).toBe(true);
    if (!completion.ok) return;
    await commitEffectBatch(firmDatabase, completion.effect, { now: clock.now });

    await stub.notifyTurnTransition();
    await waitForFrames(subscription, 2);

    expect(subscription.frames[1]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { turnId: magnusTurnId, status: "complete", content: "an answer" },
    });
    // A settled turn is pushed once and the socket then closes normally — the client already has
    // everything this turn will ever produce.
    await waitFor(() => subscription.closeCode() !== null);
    expect(subscription.closeCode()).toBe(1000);
  });

  it("re-sends the current state on resync", async () => {
    const { conversationId, magnusTurnId } = await conversationWithPendingTurn();
    const stub = conversationStub(`${firmId}:${conversationId}`);
    const subscription = await subscribe(stub, firmId, conversationId);

    subscription.send(JSON.stringify({ type: "resync" }));
    await waitForFrames(subscription, 2);
    expect(subscription.frames).toHaveLength(2);
    expect(subscription.frames[1]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { turnId: magnusTurnId, status: "pending" },
    });
  });

  it("answers a ping and refuses an oversized or binary frame without dropping the socket", async () => {
    const { conversationId } = await conversationWithPendingTurn();
    const stub = conversationStub(`${firmId}:${conversationId}`);
    const subscription = await subscribe(stub, firmId, conversationId);

    subscription.send(PING_FRAME);
    await waitForFrames(subscription, 2);
    expect(subscription.frames[1]).toEqual({ type: "pong" });

    subscription.send(
      JSON.stringify({ type: "resync", padding: "x".repeat(MAX_CLIENT_FRAME_BYTES) }),
    );
    await waitForFrames(subscription, 3);
    expect(subscription.frames[2]).toEqual({ type: "refused", reason: "frame-too-large" });

    subscription.send(new ArrayBuffer(8));
    await waitForFrames(subscription, 4);
    expect(subscription.frames[3]).toEqual({ type: "refused", reason: "binary-unsupported" });

    subscription.send("{not json");
    await waitForFrames(subscription, 5);
    expect(subscription.frames[4]).toEqual({ type: "refused", reason: "malformed-frame" });

    subscription.send(JSON.stringify({ type: "somethingElse" }));
    await waitForFrames(subscription, 6);
    expect(subscription.frames[5]).toEqual({ type: "refused", reason: "unknown-frame" });

    // The socket is still open and still working.
    expect(subscription.closeCode()).toBeNull();
  });

  it("a firm cannot address another firm's conversation object", async () => {
    const { conversationId } = await conversationWithPendingTurn();
    // The route builds the object name from the SESSION firm id, so another firm's session resolves
    // a DIFFERENT object — one that knows nothing about this conversation.
    const foreign = conversationStub(`${otherFirmId}:${conversationId}`);
    const subscription = await subscribe(foreign, otherFirmId, conversationId);
    expect(subscription.frames[0]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { turnId: "", status: "unknown" },
    });
  });

  it("stores nothing of its own — not before a subscription, not after one", async () => {
    const { conversationId } = await conversationWithPendingTurn();
    const stub = conversationStub(`${firmId}:${conversationId}`);
    const subscription = await subscribe(stub, firmId, conversationId);
    await stub.notifyTurnTransition();
    await waitForFrames(subscription, 2);

    await runInDurableObject(stub, async (_instance: MagnusConversation, state) => {
      const stored = await state.storage.list();
      expect([...stored.keys()]).toEqual([]);
    });
  });
});
