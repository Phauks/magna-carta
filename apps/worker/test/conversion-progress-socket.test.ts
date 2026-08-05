import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ConversionJob } from "../src/conversions/conversion-coordinator.ts";
import type { ConversionMessage } from "../src/conversions/conversion-types.ts";
import { subscribeRequestUrl } from "../src/progress/job-progress-sockets.ts";

// Push progress on the conversion-job coordinator. The same scope note as the bundle twin applies: the
// local test pool cannot evict a Durable Object, so the hibernate/wake cycle itself is not exercised —
// what is exercised is that every fact a woken object would need lives where it would survive
// (durable storage plus the per-socket attachment), and that the transition sequence a subscriber sees
// matches what the poll endpoint would have reported.
//
// The interesting difference from the bundle build is `running`: a conversion has a non-terminal
// transition in the middle, so this is where a subscriber sees the job stop waiting.

const BUCKET = "R2";

function message(jobId: string): ConversionMessage {
  return {
    firmId: "firm_1",
    bucketName: BUCKET,
    jobId,
    sourceKey: `conversions/firm_1/${jobId}/source`,
    resultKey: `conversions/firm_1/${jobId}/result`,
    from: "png",
    to: "jpeg",
  };
}

function coordinatorStub(name: string) {
  return env.CONVERSION_JOB.get(env.CONVERSION_JOB.idFromName(name));
}

async function primeQueued(stub: ReturnType<typeof coordinatorStub>, jobId: string) {
  await runInDurableObject(stub, async (instance: ConversionJob) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, CONVERSION: { send: async () => {} } };
    await instance.start(message(jobId));
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Subscription {
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
  return { frames, closeCode: () => closeCode };
}

describe("ConversionJob push progress", () => {
  it("refuses a plain request — the object's fetch serves subscriptions only", async () => {
    const stub = coordinatorStub("firm_1:conversion-plain");
    const response = await stub.fetch(new Request(subscribeRequestUrl(BUCKET)));
    expect(response.status).toBe(426);
  });

  it("pushes queued -> running -> done, with the signed URL and media type on done", async () => {
    const jobId = "conversion-lifecycle";
    await env.R2.put(`conversions/firm_1/${jobId}/result`, "converted bytes");
    const stub = coordinatorStub(`firm_1:${jobId}`);
    await primeQueued(stub, jobId);
    const subscription = await subscribe(stub);

    expect(subscription.frames[0]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { status: "queued" },
    });

    await stub.markRunning();
    await settle();
    expect(subscription.frames[1]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { status: "running" },
    });
    // `running` is not terminal — the socket stays open for the outcome.
    expect(subscription.closeCode()).toBeNull();

    await stub.markDone(`conversions/firm_1/${jobId}/result`, "image/jpeg");
    await settle();
    const done = subscription.frames[2] as {
      state: { status: string; url?: string; mediaType?: string };
    };
    expect(done.state.status).toBe("done");
    expect(done.state.mediaType).toBe("image/jpeg");
    expect(done.state.url ?? "").toContain(`${BUCKET}/conversions/firm_1/${jobId}/result`);
    expect(subscription.closeCode()).toBe(1000);
  });

  it("pushes the failure reason, matching what the poll endpoint reports", async () => {
    const jobId = "conversion-failed";
    const stub = coordinatorStub(`firm_1:${jobId}`);
    await primeQueued(stub, jobId);
    const subscription = await subscribe(stub);

    await stub.markFailed("engine-not-implemented");
    await settle();
    expect(subscription.frames[1]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { status: "failed", reason: "engine-not-implemented" },
    });
    expect(subscription.closeCode()).toBe(1000);
  });

  it("pushes a done job whose result was reaped as expired, never a URL that 404s", async () => {
    const jobId = "conversion-reaped";
    const stub = coordinatorStub(`firm_1:${jobId}`);
    await primeQueued(stub, jobId);
    const subscription = await subscribe(stub);

    await stub.markDone(`conversions/firm_1/${jobId}/result`, "image/jpeg");
    await settle();
    expect(subscription.frames[1]).toEqual({
      type: "state",
      protocolVersion: 1,
      state: { status: "expired" },
    });
  });

  it("keeps the subscription in the hibernation-durable slots, never on the instance", async () => {
    const jobId = "conversion-hibernation";
    const stub = coordinatorStub(`firm_1:${jobId}`);
    await primeQueued(stub, jobId);
    await subscribe(stub);

    await runInDurableObject(stub, async (_instance: ConversionJob, state) => {
      const sockets = state.getWebSockets();
      expect(sockets).toHaveLength(1);
      expect((sockets[0] as WebSocket).deserializeAttachment()).toEqual({
        protocolVersion: 1,
        bucketName: BUCKET,
      });
      expect(state.getWebSocketAutoResponse()?.request).toBe('{"type":"ping"}');
    });
  });
});
