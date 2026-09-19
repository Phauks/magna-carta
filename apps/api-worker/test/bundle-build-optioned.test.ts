import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { BundleManifest } from "@magna-carta/file-manager/bundle-manifest";
import type { Bindings } from "../src/bindings.ts";
import type { BundleServiceFetcher } from "../src/downloads/bundle-container-adapter.ts";
import { bundleBuildQueue } from "../src/downloads/bundle-consumer.ts";
import type { BundleBuildCoordinator } from "../src/downloads/bundle-coordinator.ts";
import type { BundleBuildMessage } from "../src/downloads/bundle-types.ts";

// The bundle-build consumer branches on whether a message carries a prebuilt manifest. An optioned
// message (compression / 7z / split) hands the manifest to the bundle container (BUNDLE_SERVICE) and
// records the volumes it reports via markReadyVolumes; a plain message keeps the client-zip path
// (R2 multipart put + markReady). Both run against real Miniflare DO + R2; BUNDLE_SERVICE is a fake
// (no live bundle worker runs in the pool), injected by overriding the binding on a spread of env —
// the established pattern for swapping a single binding in a consumer test.

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

// Primes a coordinator DO to `building` without enqueuing a real build (its BUNDLE_BUILD send is a
// no-op for the priming call only), then returns the stub for the consumer + assertions to share.
async function primeBuilding(message: BundleBuildMessage) {
  const stub = env.BUNDLE_COORDINATOR.get(
    env.BUNDLE_COORDINATOR.idFromName(`${message.firmId}:${message.manifestHash}`),
  );
  await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, BUNDLE_BUILD: { send: async () => {} } };
    await instance.requestBundle(message);
  });
  return stub;
}

function manifestFor(cacheKey: string): BundleManifest {
  return {
    jobId: cacheKey,
    format: "sevenZip",
    compression: "normal",
    encryption: null,
    split: null,
    entries: [
      {
        archivePath: "a.txt",
        mtimeEpochSecs: null,
        source: "r2",
        r2Key: "files/o1/v1",
      },
    ],
    outputKeyPrefix: `bundles/${cacheKey}`,
  };
}

describe("bundleBuildQueue — lane branching", () => {
  it("optioned message: hands the manifest to BUNDLE_SERVICE and records the reported volumes", async () => {
    const cacheKey = "optionedbuildcachekey";
    const cannedVolumes = [
      { key: `bundles/${cacheKey}.7z.001`, sizeBytes: 10_485_760 },
      { key: `bundles/${cacheKey}.7z.002`, sizeBytes: 4096 },
    ];
    let serviceCalls = 0;
    const fakeService: BundleServiceFetcher = {
      fetch: async () => {
        serviceCalls += 1;
        return new Response(JSON.stringify({ ok: true, volumes: cannedVolumes, error: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };

    const message: BundleBuildMessage = {
      firmId: "firm_opt",
      bucketName: "R2",
      manifestHash: cacheKey,
      entries: [{ r2Key: "files/o1/v1", path: "a.txt" }],
      options: {
        format: "sevenZip",
        compression: "normal",
        encryption: null,
        split: null,
        outputName: "bundle.7z",
        wrapperFolder: null,
        layout: "preserveTree",
        manifest: false,
      },
      manifest: manifestFor(cacheKey),
    };

    const stub = await primeBuilding(message);
    const { batch, acks, retries } = makeBatch(message);
    await bundleBuildQueue(batch, { ...env, BUNDLE_SERVICE: fakeService } as unknown as Bindings);

    // The container was invoked, and the coordinator recorded exactly the volumes it reported.
    expect(serviceCalls).toBe(1);
    const state = await stub.status();
    expect(state.status).toBe("ready");
    expect(state.volumes).toEqual(cannedVolumes);
    // The optioned lane never writes the artifact itself (the container does, via outbound R2), so the
    // single-artifact r2Key stays null.
    expect(state.r2Key).toBeNull();
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
  });

  it("plain message (no manifest): keeps the client-zip path and never calls BUNDLE_SERVICE", async () => {
    await env.R2.put("files/p1/v1", new TextEncoder().encode("plain-bytes"));
    const manifestHash = "plainbuildcachekey";
    let serviceCalls = 0;
    const fakeService: BundleServiceFetcher = {
      fetch: async () => {
        serviceCalls += 1;
        return new Response("{}", { status: 200 });
      },
    };

    const message: BundleBuildMessage = {
      firmId: "firm_plain",
      bucketName: "R2",
      manifestHash,
      entries: [{ r2Key: "files/p1/v1", path: "p.txt" }],
      // no options, no manifest — the plain lane.
    };

    const stub = await primeBuilding(message);
    const { batch, acks, retries } = makeBatch(message);
    await bundleBuildQueue(batch, { ...env, BUNDLE_SERVICE: fakeService } as unknown as Bindings);

    // The client-zip artifact was written to R2 and the job marked ready with its single key; the
    // container binding was never touched.
    expect(serviceCalls).toBe(0);
    const object = await env.R2.get(`bundles/${manifestHash}.zip`);
    expect(object).not.toBeNull();
    const bytes = new Uint8Array(await object!.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    const state = await stub.status();
    expect(state.status).toBe("ready");
    expect(state.r2Key).toBe(`bundles/${manifestHash}.zip`);
    expect(state.volumes).toBeUndefined();
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
  });
});
