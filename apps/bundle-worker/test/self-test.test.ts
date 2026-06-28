import { describe, expect, it } from "vitest";
import { runSelfTest, selfTestAuthorized } from "../src/self-test.ts";

// A ZIP local-file-header magic ("PK\x03\x04") followed by filler — enough to pass the self-test's
// "is this a ZIP" check without running a real encoder.
function zipBytes(extra = 16): Uint8Array {
  const bytes = new Uint8Array(4 + extra);
  bytes.set([0x50, 0x4b, 0x03, 0x04]);
  return bytes;
}

// An in-memory R2 supporting the four operations the self-test uses: get / put / list / delete.
function makeR2(store: Map<string, Uint8Array>): R2Bucket {
  return {
    async get(key: string) {
      const data = store.get(key);
      if (data === undefined) return null;
      return {
        arrayBuffer: async () => data.buffer as ArrayBuffer,
      } as unknown as R2ObjectBody;
    },
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    ) {
      const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
      store.set(key, bytes);
      return {} as unknown as R2Object;
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? "";
      const objects = [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key }));
      return { objects, truncated: false } as unknown as R2Objects;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  } as unknown as R2Bucket;
}

// A well-behaved fake container that does what the real container would: serves /ready, writes the
// buffered build's volume(s) to the shared R2, streams back the encrypted lane WITHOUT persisting, and
// reports multiple volumes for a split request.
function goodContainer(
  store: Map<string, Uint8Array>,
  overrides: { persistOnStream?: boolean } = {},
): { fetch(req: Request): Promise<Response> } {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/ready") return new Response("ok", { status: 200 });
      if (url.pathname !== "/build") return new Response("Not Found", { status: 404 });

      const manifest = (await req.json()) as {
        outputKeyPrefix: string;
        split?: { maxPartBytes: number } | null;
      };

      if (url.searchParams.get("stream") === "1") {
        if (overrides.persistOnStream) store.set(manifest.outputKeyPrefix, zipBytes());
        return new Response(zipBytes(), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }
      if (manifest.split) {
        const volumes = [1, 2, 3].map(
          (n) => `${manifest.outputKeyPrefix}.${String(n).padStart(3, "0")}`,
        );
        for (const key of volumes) store.set(key, zipBytes(4));
        return Response.json({
          ok: true,
          volumes: volumes.map((key) => ({ key, sizeBytes: 8 })),
          error: null,
        });
      }
      const archive = zipBytes();
      store.set(manifest.outputKeyPrefix, archive);
      return Response.json({
        ok: true,
        volumes: [{ key: manifest.outputKeyPrefix, sizeBytes: archive.length }],
        error: null,
      });
    },
  };
}

describe("selfTestAuthorized", () => {
  it("denies when no key is configured", () => {
    expect(selfTestAuthorized(undefined, "anything")).toBe(false);
    expect(selfTestAuthorized("", "anything")).toBe(false);
  });
  it("denies a missing or wrong key", () => {
    expect(selfTestAuthorized("secret", null)).toBe(false);
    expect(selfTestAuthorized("secret", "wrong")).toBe(false);
    expect(selfTestAuthorized("secret", "secre")).toBe(false);
  });
  it("allows the exact key", () => {
    expect(selfTestAuthorized("secret", "secret")).toBe(true);
  });
});

describe("runSelfTest", () => {
  it("passes against a well-behaved container and cleans up every object it wrote", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(goodContainer(store), makeR2(store));
    expect(report.ok, JSON.stringify(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    // Cleanup removed everything under the run prefix.
    expect([...store.keys()].filter((k) => k.startsWith("selftest/"))).toEqual([]);
  });

  it("fails (and reports which check) when the streaming lane persists an object", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(
      goodContainer(store, { persistOnStream: true }),
      makeR2(store),
    );
    expect(report.ok).toBe(false);
    const persistCheck = report.checks.find((c) => c.name.includes("persists nothing"));
    expect(persistCheck?.ok).toBe(false);
    // Even on failure, cleanup runs.
    expect([...store.keys()].filter((k) => k.startsWith("selftest/"))).toEqual([]);
  });

  it("fails gracefully (no throw) when the container errors", async () => {
    const store = new Map<string, Uint8Array>();
    const container = {
      async fetch(): Promise<Response> {
        throw new Error("container unreachable");
      },
    };
    const report = await runSelfTest(container, makeR2(store));
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => !c.ok)).toBe(true);
  });
});
