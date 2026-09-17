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

  it("a ready job whose artifact was reaped rebuilds instead of reporting a dead bundle", async () => {
    const stub = coordinatorStub("firm_1:hash-reaped");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      const sends = recordSends(instance);
      await instance.requestBundle(message("hash-reaped"));
      // Completed, then the `bundles/` lifecycle rule expires the object: the DO state survives, the
      // artifact does not. Nothing is ever written to R2 under this key, which is exactly that state.
      await instance.markReady("bundles/hash-reaped.zip");
      const state = await instance.requestBundle(message("hash-reaped"));
      expect(state.status).toBe("building");
      expect(sends).toHaveLength(2);
    });
  });

  // The single-flight property this object exists for, asked on the one path that can lose it. Every
  // other decision here is read-then-write across STORAGE awaits, and workerd holds the input gate
  // across those — a second call is not delivered until the first has written, so it sees the state
  // and shares. The reaped-artifact path is different: deciding whether to rebuild means a HEAD
  // against R2, which is not storage, so the gate opens mid-decision and a second request is
  // delivered while the first is still deciding. Both then read `ready`, both find the object gone,
  // and both enqueue — a duplicated build of a bundle that can be large.
  //
  // Driven through the STUB rather than by calling the method twice on the instance: direct calls
  // interleave at every await including storage, which is more interleaving than production has, so a
  // failure there would not prove a reachable race. Two RPCs are gated exactly as two requests are.
  it("two requests racing on a reaped artifact enqueue one rebuild, not two", async () => {
    const stub = coordinatorStub("firm_1:hash-reaped-race");
    const sends = await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      const recorded = recordSends(instance);
      await instance.requestBundle(message("hash-reaped-race"));
      // Completed, then the lifecycle rule expired the object: state survives, artifact does not.
      await instance.markReady("bundles/hash-reaped-race.zip");
      recorded.length = 0;
      return recorded;
    });

    const [first, second] = await runInDurableObject(
      stub,
      async (instance: BundleBuildCoordinator) =>
        await Promise.all([
          instance.requestBundle(message("hash-reaped-race")),
          instance.requestBundle(message("hash-reaped-race")),
        ]),
    );

    expect(first.status).toBe("building");
    expect(second.status).toBe("building");
    expect(sends).toHaveLength(1);
  });

  it("a ready job whose artifact is still present is shared (no rebuild)", async () => {
    await env.R2.put("bundles/hash-present.zip", "zip bytes");
    const stub = coordinatorStub("firm_1:hash-present");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      const sends = recordSends(instance);
      await instance.requestBundle(message("hash-present"));
      await instance.markReady("bundles/hash-present.zip");
      const state = await instance.requestBundle(message("hash-present"));
      expect(state.status).toBe("ready");
      expect(state.r2Key).toBe("bundles/hash-present.zip");
      expect(sends).toHaveLength(1);
    });
  });

  it("a ready split bundle rebuilds when any one of its volumes is gone", async () => {
    await env.R2.put("bundles/hash-split/part1", "volume one");
    const stub = coordinatorStub("firm_1:hash-split");
    await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
      const sends = recordSends(instance);
      await instance.requestBundle(message("hash-split"));
      // The second volume was never written (reaped): a split archive missing one volume is unusable,
      // so the whole bundle rebuilds.
      await instance.markReadyVolumes([
        { key: "bundles/hash-split/part1", sizeBytes: 10 },
        { key: "bundles/hash-split/part2", sizeBytes: 10 },
      ]);
      const state = await instance.requestBundle(message("hash-split"));
      expect(state.status).toBe("building");
      expect(sends).toHaveLength(2);
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
