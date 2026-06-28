import { describe, expect, it } from "vitest";
import { runSelfTest, selfTestAuthorized } from "../src/self-test.ts";

const ZIP_HEADER = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EOCD = [0x50, 0x4b, 0x05, 0x06, ...Array.from({ length: 18 }, () => 0)];
const SEVEN_Z = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// A complete ZIP (header + EOCD) optionally embedding `content` verbatim (store lane) — or filler bytes
// (encrypted lane) that must NOT contain the seeded marker.
function makeZip(content: Uint8Array, embedContent: boolean): Uint8Array {
  const middle = embedContent ? content : new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  return concat([new Uint8Array(ZIP_HEADER), middle, new Uint8Array(ZIP_EOCD)]);
}

interface ContainerOverrides {
  ready500?: boolean;
  build500?: boolean;
  stream500?: boolean;
  missingOutput?: boolean;
  corruptBufferedOutput?: boolean;
  dropBufferedContent?: boolean;
  sizeMismatch?: boolean;
  plaintextStream?: boolean;
  persistOnStream?: boolean;
  singleVolumeSplit?: boolean;
  missingSplitVolume?: boolean;
  corruptSevenZ?: boolean;
}

// A well-behaved fake container that does what the real container would, reading the seeded R2 content so
// the buffered archive truly embeds it. Overrides inject specific regressions for the negative tests.
// NOTE: this fake is a HAND-MAINTAINED mirror of the container's wire contract (containers/bundle/src/
// contract.rs + build.rs). It proves runSelfTest's logic, not the live wire shape — keep it in lockstep
// if the contract changes.
function fakeContainer(
  store: Map<string, Uint8Array>,
  overrides: ContainerOverrides = {},
): { fetch(req: Request): Promise<Response> } {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/ready") {
        return new Response("ok", { status: overrides.ready500 ? 500 : 200 });
      }
      if (url.pathname !== "/build") return new Response("Not Found", { status: 404 });

      const manifest = (await req.json()) as {
        jobId?: string;
        format?: string;
        compression?: string;
        outputKeyPrefix?: string;
        split?: { maxPartBytes: number } | null;
        entries?: { source: string; r2Key?: string }[];
      };
      // Lock the wire contract: a real container 422s on a malformed manifest, so the fake does too.
      for (const field of [
        "jobId",
        "format",
        "compression",
        "outputKeyPrefix",
        "entries",
      ] as const) {
        if (manifest[field] === undefined) {
          return Response.json(
            { ok: false, volumes: [], error: `missing ${field}` },
            { status: 422 },
          );
        }
      }
      const r2Entry = (manifest.entries ?? []).find((e) => e.source === "r2");
      const seeded = (r2Entry?.r2Key && store.get(r2Entry.r2Key)) || new Uint8Array();
      const prefix = manifest.outputKeyPrefix ?? "";

      if (url.searchParams.get("stream") === "1") {
        if (overrides.stream500) return new Response("boom", { status: 500 });
        if (overrides.persistOnStream) store.set(prefix, makeZip(seeded, false));
        // Encrypted lane: the archive must NOT contain the plaintext (unless plaintextStream regresses it).
        return new Response(makeZip(seeded, overrides.plaintextStream === true), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }

      if (overrides.build500) return new Response("boom", { status: 500 });

      if (manifest.split) {
        const count = overrides.singleVolumeSplit ? 1 : 3;
        const keys = Array.from(
          { length: count },
          (_, i) => `${prefix}.${String(i + 1).padStart(3, "0")}`,
        );
        const written = overrides.missingSplitVolume ? keys.slice(0, count - 1) : keys;
        keys.forEach((key, i) => {
          if (!written.includes(key)) return;
          // First volume carries the 7z signature so the reassembly check can verify it (unless
          // corruptSevenZ regresses it to non-signature bytes).
          const firstVolume = overrides.corruptSevenZ
            ? new Uint8Array([9, 9, 9, 9, 9, 9])
            : new Uint8Array(SEVEN_Z);
          store.set(key, i === 0 ? firstVolume : new Uint8Array([0, 1, 2, 3]));
        });
        return Response.json({
          ok: true,
          volumes: keys.map((key, i) => ({ key, sizeBytes: i === 0 ? SEVEN_Z.length : 4 })),
          error: null,
        });
      }

      // Normal: a complete ZIP embedding the seeded content. corruptBufferedOutput → not a ZIP at all;
      // dropBufferedContent → a complete ZIP but WITHOUT the seeded bytes.
      const archive = overrides.corruptBufferedOutput
        ? new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])
        : makeZip(seeded, !overrides.dropBufferedContent);
      if (!overrides.missingOutput) store.set(prefix, archive);
      return Response.json({
        ok: true,
        volumes: [
          { key: prefix, sizeBytes: overrides.sizeMismatch ? archive.length + 1 : archive.length },
        ],
        error: null,
      });
    },
  };
}

function makeR2(
  store: Map<string, Uint8Array>,
  opts: { throwOnDelete?: boolean; pageSize?: number } = {},
): R2Bucket {
  return {
    async get(key: string) {
      const data = store.get(key);
      if (data === undefined) return null;
      return { arrayBuffer: async () => data.buffer as ArrayBuffer } as unknown as R2ObjectBody;
    },
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    ) {
      store.set(key, new Uint8Array(await new Response(value as BodyInit).arrayBuffer()));
      return {} as unknown as R2Object;
    },
    // Paginates when pageSize is set, so the cursor-following loop in listKeys is genuinely exercised.
    async list(options?: { prefix?: string; cursor?: string }) {
      const prefix = options?.prefix ?? "";
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key }));
      const pageSize = opts.pageSize ?? all.length;
      const startIndex = options?.cursor ? Number(options.cursor) : 0;
      const page = all.slice(startIndex, startIndex + Math.max(pageSize, 1));
      const nextIndex = startIndex + page.length;
      const truncated = nextIndex < all.length;
      return {
        objects: page,
        truncated,
        cursor: truncated ? String(nextIndex) : undefined,
      } as unknown as R2Objects;
    },
    async delete(keys: string | string[]) {
      if (opts.throwOnDelete) throw new Error("r2 delete failed");
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  } as unknown as R2Bucket;
}

const leftover = (store: Map<string, Uint8Array>) =>
  [...store.keys()].filter((k) => k.startsWith("selftest/"));
const check = (r: { checks: { name: string; ok: boolean }[] }, fragment: string) =>
  r.checks.find((c) => c.name.includes(fragment));

describe("selfTestAuthorized", () => {
  it("denies when no key is configured", async () => {
    expect(await selfTestAuthorized(undefined, "anything")).toBe(false);
    expect(await selfTestAuthorized("", "anything")).toBe(false);
  });
  it("denies a missing or wrong key (including a length mismatch)", async () => {
    expect(await selfTestAuthorized("secret", null)).toBe(false);
    expect(await selfTestAuthorized("secret", "wrong")).toBe(false);
    expect(await selfTestAuthorized("secret", "secre")).toBe(false);
    expect(await selfTestAuthorized("secret", "secrets")).toBe(false);
  });
  it("denies a SAME-LENGTH wrong key (the real content comparison, not just length)", async () => {
    expect(await selfTestAuthorized("secret", "sicret")).toBe(false);
    const a = "a".repeat(32);
    expect(await selfTestAuthorized(a, `${"a".repeat(31)}b`)).toBe(false);
  });
  it("allows the exact key", async () => {
    expect(await selfTestAuthorized("secret", "secret")).toBe(true);
  });
});

describe("runSelfTest", () => {
  it("passes against a well-behaved container and cleans up everything it wrote", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store), makeR2(store));
    expect(report.ok, JSON.stringify(report.checks)).toBe(true);
    // Pin the exact check count so a silently DROPPED check (not just a failing one) is caught.
    expect(report.checks.length).toBe(12);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(leftover(store)).toEqual([]);
  });

  it("paginates the cleanup listing (cursor-following) and still removes everything", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store), makeR2(store, { pageSize: 1 }));
    expect(report.ok, JSON.stringify(report.checks)).toBe(true);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when /ready does not return 200", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store, { ready500: true }), makeR2(store));
    expect(report.ok).toBe(false);
    expect(check(report, "container /ready responds 200")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the buffered build returns non-200", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store, { build500: true }), makeR2(store));
    expect(report.ok).toBe(false);
    expect(check(report, "buffered build returns ok")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the buffered output is missing from R2", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store, { missingOutput: true }), makeR2(store));
    expect(report.ok).toBe(false);
    expect(check(report, "buffered output is a complete ZIP")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the reported size does not match the stored object", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store, { sizeMismatch: true }), makeR2(store));
    expect(report.ok).toBe(false);
    expect(check(report, "reported volume size matches")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the encrypted lane returns plaintext (encryption regression)", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(
      fakeContainer(store, { plaintextStream: true }),
      makeR2(store),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "does NOT contain the plaintext")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the streaming lane persists an object", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(
      fakeContainer(store, { persistOnStream: true }),
      makeR2(store),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "persists nothing")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when 7z split reports only a single volume", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(
      fakeContainer(store, { singleVolumeSplit: true }),
      makeR2(store),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "multiple .NNN volumes")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when a reported 7z volume is missing from R2", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(
      fakeContainer(store, { missingSplitVolume: true }),
      makeR2(store),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "every reported 7z volume exists")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the buffered output is not a complete ZIP", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(
      fakeContainer(store, { corruptBufferedOutput: true }),
      makeR2(store),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "buffered output is a complete ZIP")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the buffered (store) archive omits the seeded content", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(
      fakeContainer(store, { dropBufferedContent: true }),
      makeR2(store),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "contains the seeded content")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the streaming lane returns a non-200", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store, { stream500: true }), makeR2(store));
    expect(report.ok).toBe(false);
    expect(check(report, "streaming lane returns a complete ZIP")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("fails when the reassembled 7z volumes do not start with the 7z signature", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store, { corruptSevenZ: true }), makeR2(store));
    expect(report.ok).toBe(false);
    expect(check(report, "start with the 7z signature")?.ok).toBe(false);
    expect(leftover(store)).toEqual([]);
  });

  it("reports a failed cleanup check when R2 delete throws", async () => {
    const store = new Map<string, Uint8Array>();
    const report = await runSelfTest(fakeContainer(store), makeR2(store, { throwOnDelete: true }));
    expect(report.ok).toBe(false);
    expect(check(report, "cleanup removed all")?.ok).toBe(false);
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
