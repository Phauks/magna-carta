import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { BundleBuildCoordinator } from "../src/downloads/bundle-coordinator.ts";
import type { BundleBuildMessage } from "../src/downloads/bundle-types.ts";

// The single-flight build coordinator over real Miniflare Durable Object storage. Each test addresses
// its own DO name (firmId:manifestHash) so persisted state never leaks between cases. The DO enqueues
// onto BUNDLE_BUILD on the first request; the test swaps in a recording fake for that binding so it can
// assert the single-flight property (exactly one enqueue) without standing up a real consumer.

function message(hash: string): BundleBuildMessage {
  return {
    firmId: "firm_1",
    bucketName: "bucket",
    manifestHash: hash,
    entries: [{ r2Key: "files/f1/v1", path: "a.pdf" }],
  };
}

function coordinatorStub(name: string) {
  return env.BUNDLE_COORDINATOR.get(env.BUNDLE_COORDINATOR.idFromName(name));
}

// Replaces the instance's BUNDLE_BUILD binding with a send-recorder. Assigns a fresh env object to the
// instance only (not the shared pool env), so no other test sees the fake.
function recordSends(instance: BundleBuildCoordinator): BundleBuildMessage[] {
  const sends: BundleBuildMessage[] = [];
  const mutable = instance as unknown as { env: Record<string, unknown> };
  mutable.env = {
    ...mutable.env,
    BUNDLE_BUILD: {
      send: async (sent: BundleBuildMessage) => {
        sends.push(sent);
      },
    },
  };
  return sends;
}

describe("BundleBuildCoordinator", () => {
  it("first requestBundle builds and enqueues exactly once", async () => {
    const stub = coordinatorStub("firm_1:hash-first");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      const sends = recordSends(instance);
      const state = await instance.requestBundle(message("hash-first"));
      expect(state.status).toBe("building");
      expect(sends).toHaveLength(1);
    });
  });

  it("a second identical request before completion shares the build (no second enqueue)", async () => {
    const stub = coordinatorStub("firm_1:hash-single");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      const sends = recordSends(instance);
      await instance.requestBundle(message("hash-single"));
      const again = await instance.requestBundle(message("hash-single"));
      expect(again.status).toBe("building");
      expect(sends).toHaveLength(1);
    });
  });

  it("markReady transitions to ready with the artifact key", async () => {
    const stub = coordinatorStub("firm_1:hash-ready");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      recordSends(instance);
      await instance.requestBundle(message("hash-ready"));
      await instance.markReady("bundles/hash-ready.zip");
      const state = await instance.status();
      expect(state.status).toBe("ready");
      expect(state.r2Key).toBe("bundles/hash-ready.zip");
    });
  });

  it("the stuck alarm fails a build still in progress", async () => {
    const stub = coordinatorStub("firm_1:hash-alarm");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      recordSends(instance);
      await instance.requestBundle(message("hash-alarm"));
      await instance.alarm();
      const state = await instance.status();
      expect(state.status).toBe("failed");
      expect(state.error).toBe("build timed out");
    });
  });

  it("markFailed never clobbers a job that already reached ready (zombie attempt)", async () => {
    const stub = coordinatorStub("firm_1:hash-zombie");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      recordSends(instance);
      await instance.requestBundle(message("hash-zombie"));
      await instance.markReady("bundles/hash-zombie.zip");
      // A late zombie attempt (from a timed-out / retried prior build) reports failure — it must be
      // ignored so the completion the client may already have polled is not lost.
      await instance.markFailed("zombie build failed");
      const state = await instance.status();
      expect(state.status).toBe("ready");
      expect(state.r2Key).toBe("bundles/hash-zombie.zip");
    });
  });
});
