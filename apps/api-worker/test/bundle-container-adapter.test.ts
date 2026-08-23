import { describe, expect, it } from "vitest";
import {
  bundleContainerAdapter,
  type BundleServiceFetcher,
  type BuildResultVolume,
} from "../src/downloads/bundle-container-adapter.ts";
import type { BundleManifest } from "@magna-carta/file-manager/bundle-manifest";

// The adapter is exercised with a fake bundle service (no real binding, no container): each fake
// returns a canned BuildResponse JSON (or a streamed body / error), and the adapter must map it to
// the typed result or throw.

function fakeService(body: unknown, status = 200): BundleServiceFetcher {
  return {
    fetch: async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
}

function fakeStreamService(stream: ReadableStream<Uint8Array>, status = 200): BundleServiceFetcher {
  return {
    fetch: async () => new Response(stream, { status }),
  };
}

// A minimal manifest for exercising the adapter; the adapter passes it straight to JSON.stringify
// so the exact shape only matters for type-checking.
const sampleManifest: BundleManifest = {
  jobId: "job-abc123",
  format: "zip",
  compression: "store",
  encryption: null,
  split: null,
  entries: [
    {
      archivePath: "documents/file.pdf",
      mtimeEpochSecs: 1700000000,
      source: "r2",
      r2Key: "matters/m1/file.pdf",
    },
  ],
  outputKeyPrefix: "bundles/test-key",
};

const sampleVolumes: BuildResultVolume[] = [{ key: "bundles/test-key.zip", sizeBytes: 4096 }];

describe("bundleContainerAdapter — build", () => {
  it("returns the parsed volumes on a successful ok:true response", async () => {
    const adapter = bundleContainerAdapter(
      fakeService({ ok: true, volumes: sampleVolumes, error: null }),
    );
    const volumes = await adapter.build(sampleManifest);
    expect(volumes).toEqual(sampleVolumes);
  });

  it("returns multiple volumes (split bundle)", async () => {
    const multiVolumes: BuildResultVolume[] = [
      { key: "bundles/part-0.7z", sizeBytes: 10_485_760 },
      { key: "bundles/part-1.7z", sizeBytes: 8_388_608 },
    ];
    const adapter = bundleContainerAdapter(
      fakeService({ ok: true, volumes: multiVolumes, error: null }),
    );
    const volumes = await adapter.build(sampleManifest);
    expect(volumes).toEqual(multiVolumes);
  });

  it("throws when ok is false and surfaces the error message", async () => {
    const adapter = bundleContainerAdapter(
      fakeService({ ok: false, volumes: [], error: "archive write failed" }),
    );
    await expect(adapter.build(sampleManifest)).rejects.toThrow("archive write failed");
  });

  it("throws on a non-200 response", async () => {
    const adapter = bundleContainerAdapter(
      fakeService({ ok: false, volumes: [], error: "internal error" }, 500),
    );
    await expect(adapter.build(sampleManifest)).rejects.toThrow();
  });

  it("throws on a malformed body (missing required fields)", async () => {
    const adapter = bundleContainerAdapter(fakeService({ unexpected: true }));
    await expect(adapter.build(sampleManifest)).rejects.toThrow();
  });

  it("throws on a non-JSON body", async () => {
    const adapter = bundleContainerAdapter(fakeService("<html>not json</html>"));
    await expect(adapter.build(sampleManifest)).rejects.toThrow();
  });

  it("throws (never hangs) when the service wedges past the request timeout", async () => {
    // A wedged service: never resolves on its own but honors the request's AbortSignal. The adapter's
    // AbortSignal.timeout must fire and turn the hang into a retryable throw rather than a
    // request that hangs indefinitely. A small injected timeout (50 ms) drives the real abort
    // path without waiting out the production backstop.
    const wedged: BundleServiceFetcher = {
      fetch: (request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () =>
            reject(request.signal?.reason ?? new Error("aborted")),
          );
        }),
    };
    await expect(bundleContainerAdapter(wedged, 50).build(sampleManifest)).rejects.toThrow();
  });
});

describe("bundleContainerAdapter — buildStream", () => {
  it("returns the raw streaming Response on a 200", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("PK\x03\x04")); // ZIP local-file header magic
        controller.close();
      },
    });
    const adapter = bundleContainerAdapter(fakeStreamService(stream));
    const response = await adapter.buildStream(sampleManifest);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Confirm the magic bytes streamed through intact.
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
  });

  it("throws on a non-200 response", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    });
    const adapter = bundleContainerAdapter(fakeStreamService(stream, 500));
    await expect(adapter.buildStream(sampleManifest)).rejects.toThrow();
  });

  it("throws (never hangs) when the service wedges past the timeout", async () => {
    const wedged: BundleServiceFetcher = {
      fetch: (request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () =>
            reject(request.signal?.reason ?? new Error("aborted")),
          );
        }),
    };
    await expect(bundleContainerAdapter(wedged, 50).buildStream(sampleManifest)).rejects.toThrow();
  });
});
