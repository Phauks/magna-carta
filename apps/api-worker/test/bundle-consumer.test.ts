import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import { bundleBuildQueue } from "../src/downloads/bundle-consumer.ts";
import type { BundleBuildCoordinator } from "../src/downloads/bundle-coordinator.ts";
import type { BundleBuildMessage } from "../src/downloads/bundle-types.ts";

// The bundle-build consumer streams each entry's R2 object body through client-zip into a single R2
// object at bundles/<manifestHash>.zip, then marks the coordinator ready. The happy path runs against
// real Miniflare R2 — which also confirms the open question: R2.put accepts an unknown-length zip
// stream (no content-length, no buffering). The failure path uses a fake env whose put throws.

function makeBatch(message: BundleBuildMessage) {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-bundle-build",
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
  } as unknown as MessageBatch<BundleBuildMessage>;
  return { batch, acks, retries };
}

describe("bundleBuildQueue", () => {
  it("streams entries into R2 as a real zip and marks the job ready", async () => {
    await env.R2.put("files/c1/v1", new TextEncoder().encode("hello"));
    await env.R2.put("files/c2/v1", new TextEncoder().encode("world"));
    const manifestHash = "consumerhappyhash";
    const message: BundleBuildMessage = {
      firmId: "firm_c",
      bucketName: "magna-carta-test-bucket",
      manifestHash,
      entries: [
        { r2Key: "files/c1/v1", path: "a.txt" },
        { r2Key: "files/c2/v1", path: "nested/b.txt" },
      ],
    };

    // Prime the coordinator so markReady has a building state to transition.
    const stub = env.BUNDLE_COORDINATOR.get(
      env.BUNDLE_COORDINATOR.idFromName(`${message.firmId}:${manifestHash}`),
    );
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      const mutable = instance as unknown as { env: Record<string, unknown> };
      mutable.env = { ...mutable.env, BUNDLE_BUILD: { send: async () => {} } };
      await instance.requestBundle(message);
    });

    const { batch, acks, retries } = makeBatch(message);
    await bundleBuildQueue(batch, env);

    // The artifact exists, is non-empty, and starts with the ZIP local-file-header magic "PK".
    const object = await env.R2.get(`bundles/${manifestHash}.zip`);
    expect(object).not.toBeNull();
    const bytes = new Uint8Array(await object!.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    // The job is marked ready with the artifact key; the message is acked, not retried.
    const state = await stub.status();
    expect(state.status).toBe("ready");
    expect(state.r2Key).toBe(`bundles/${manifestHash}.zip`);
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
  });

  it("marks the job failed and retries the message when the R2 put throws", async () => {
    const failures: string[] = [];
    const fakeEnv = {
      R2: {
        get: async () => null,
        createMultipartUpload: async () => {
          throw new Error("boom");
        },
      },
      BUNDLE_COORDINATOR: {
        idFromName: (name: string) => name,
        get: () => ({
          markReady: async () => {},
          markFailed: async (error: string) => {
            failures.push(error);
          },
        }),
      },
    } as unknown as Bindings;

    const message: BundleBuildMessage = {
      firmId: "firm_f",
      bucketName: "b",
      manifestHash: "failhash",
      entries: [{ r2Key: "files/x/v1", path: "x.txt" }],
    };
    const { batch, acks, retries } = makeBatch(message);
    await bundleBuildQueue(batch, fakeEnv);

    expect(failures).toEqual(["boom"]);
    expect(retries).toEqual(["msg-1"]);
    expect(acks).toEqual([]);
  });
});
