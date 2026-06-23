import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { converted, engineNotImplemented, type ConversionPort } from "@magna-carta/conversion/port";
import { conversionQueue } from "../src/conversions/conversion-consumer.ts";
import type { ConversionJob } from "../src/conversions/conversion-coordinator.ts";
import type { ConversionMessage } from "../src/conversions/conversion-types.ts";

// The CONVERSION queue consumer over real Miniflare bindings (R2 + ConversionJob DO). A fake
// resolvePort is injected in place of the Container-backed port so the test exercises the consumer
// logic without needing the libvips Container to be running. Format IDs are registry keys ("png",
// "webp") — not media types — so pathfinding resolves the png→webp edge registered in the graph.

function makeBatch(message: ConversionMessage) {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-conversion",
    messages: [
      {
        id: "msg-1",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push("msg-1"),
        retry: () => retries.push("msg-1"),
      },
    ],
  } as unknown as MessageBatch<ConversionMessage>;
  return { batch, acks, retries };
}

function stubFor(firmId: string, jobId: string) {
  return env.CONVERSION_JOB.get(env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`));
}

async function seedJob(message: ConversionMessage) {
  const stub = stubFor(message.firmId, message.jobId);
  // Prime the DO so markRunning/markDone/markFailed have a state to transition.
  await runInDurableObject(stub, async (instance: ConversionJob) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = {
      ...mutable.env,
      CONVERSION: { send: async () => {} },
    };
    await instance.start(message);
  });
  return stub;
}

describe("conversionQueue", () => {
  it("success: stores result in R2, marks DO done, acks the message", async () => {
    const firmId = "firm_conv_ok";
    const jobId = "job_conv_ok_1";
    const sourceKey = `conversions/${firmId}/${jobId}/source`;
    const resultKey = `conversions/${firmId}/${jobId}/result`;
    const sourceBytes = new TextEncoder().encode("fake-png-source");
    const resultBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // fake webp bytes

    const message: ConversionMessage = {
      firmId,
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "webp",
    };

    await env.R2.put(sourceKey, sourceBytes);
    const stub = await seedJob(message);

    const fakePort: ConversionPort = {
      convert: async () => converted(resultBytes, "image/webp"),
    };

    const { batch, acks, retries } = makeBatch(message);
    await conversionQueue(batch, env, () => fakePort);

    // The result R2 object exists with the right bytes and content type.
    const result = await env.R2.get(resultKey);
    expect(result).not.toBeNull();
    const storedBytes = new Uint8Array(await result!.arrayBuffer());
    expect(storedBytes).toEqual(resultBytes);
    expect(result!.httpMetadata?.contentType).toBe("image/webp");

    // The DO is marked done with the result key.
    const state = await stub.status();
    expect(state.status).toBe("done");
    expect(state.resultKey).toBe(resultKey);
    expect(state.mediaType).toBe("image/webp");

    // The message is acked, not retried.
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
  });

  it("typed failure: marks DO failed with reason, acks the message (not retried)", async () => {
    const firmId = "firm_conv_fail";
    const jobId = "job_conv_fail_1";
    const sourceKey = `conversions/${firmId}/${jobId}/source`;
    const resultKey = `conversions/${firmId}/${jobId}/result`;
    const sourceBytes = new TextEncoder().encode("fake-source");

    const message: ConversionMessage = {
      firmId,
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "webp",
    };

    await env.R2.put(sourceKey, sourceBytes);
    const stub = await seedJob(message);

    const fakePort: ConversionPort = {
      convert: async () => engineNotImplemented(),
    };

    const { batch, acks, retries } = makeBatch(message);
    await conversionQueue(batch, env, () => fakePort);

    // The DO is marked failed with the typed reason.
    const state = await stub.status();
    expect(state.status).toBe("failed");
    expect(state.reason).toBe("engine-not-implemented");

    // Typed failures are terminal — acked, not retried.
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
  });

  it("thrown/transport error: marks DO failed, retries the message", async () => {
    const firmId = "firm_conv_throw";
    const jobId = "job_conv_throw_1";
    const sourceKey = `conversions/${firmId}/${jobId}/source`;
    const resultKey = `conversions/${firmId}/${jobId}/result`;
    const sourceBytes = new TextEncoder().encode("fake-source");

    const message: ConversionMessage = {
      firmId,
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "webp",
    };

    await env.R2.put(sourceKey, sourceBytes);
    const stub = await seedJob(message);

    const fakePort: ConversionPort = {
      convert: async () => {
        throw new Error("container unreachable");
      },
    };

    const { batch, acks, retries } = makeBatch(message);
    await conversionQueue(batch, env, () => fakePort);

    // The DO is marked failed with the transport error message.
    const state = await stub.status();
    expect(state.status).toBe("failed");
    expect(state.reason).toBe("container unreachable");

    // Thrown/transport errors are retried.
    expect(retries).toEqual(["msg-1"]);
    expect(acks).toEqual([]);
  });
});
