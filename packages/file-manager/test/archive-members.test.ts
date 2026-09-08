import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ArchiveExtraction,
  archiveExtractability,
  readArchiveContents,
  SevenZipEngineUnavailableError,
  type ArchiveEngines,
  type SevenZipEnginePort,
} from "../src/archive-members.ts";
import type { ArchiveSourceBucket } from "../src/zip-central-directory.ts";

/*
 * The one door into an archive's contents, tested as one door: the same calls over four formats,
 * answering in one vocabulary, with the caps applied in one place.
 *
 * The zip and tar fixtures are real — written by fflate and by the system's own `tar` — because a
 * dispatcher tested against bytes it invented would prove only that it dispatches.
 */

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))),
  );
}

function bucketOf(bytes: Uint8Array | null): {
  bucket: ArchiveSourceBucket;
  reads: { offset: number; length: number }[];
} {
  const reads: { offset: number; length: number }[] = [];
  const bucket: ArchiveSourceBucket = {
    head: () => Promise.resolve(bytes === null ? null : { size: bytes.byteLength }),
    get: (_key, options) => {
      if (bytes === null) return Promise.resolve(null);
      const range = options?.range;
      if (range === undefined) {
        return Promise.resolve({ arrayBuffer: () => Promise.resolve(bytes.slice().buffer) });
      }
      reads.push(range);
      const slice = bytes.slice(
        range.offset,
        Math.min(range.offset + range.length, bytes.byteLength),
      );
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(slice.buffer) });
    },
  };
  return { bucket, reads };
}

const LIMITS = { maxEntries: 1000 };
const GENEROUS = {
  maxUncompressedBytes: 10 * 1024 * 1024,
  maxExpansionRatio: 100,
  requestBudgetBytes: 10 * 1024 * 1024,
};

const RAR5_SIGNATURE = Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);

describe("readArchiveContents", () => {
  it("answers in one shape for a zip and for a tar", async () => {
    const zip = zipSync({ "docs/brief.txt": strToU8("In the matter of Renee Chase") });
    const fromZip = await readArchiveContents("zip", bucketOf(zip).bucket, "k", LIMITS);
    const fromTar = await readArchiveContents(
      "tar",
      bucketOf(fixture("posix.tar")).bucket,
      "k",
      LIMITS,
    );

    expect(fromZip?.members.map((member) => member.path)).toEqual(["docs/brief.txt"]);
    expect(fromTar?.members.map((member) => member.path).toSorted()).toEqual([
      "docs/",
      "docs/brief.txt",
      "readme.txt",
    ]);
    // The shapes are the same fact in the same words — which is the point of the module.
    for (const member of [...(fromZip?.members ?? []), ...(fromTar?.members ?? [])]) {
      expect(Object.keys(member).toSorted()).toEqual([
        "compressedSizeBytes",
        "isDirectory",
        "locator",
        "modifiedAt",
        "path",
        "uncompressedSizeBytes",
      ]);
    }
  });

  it("carries a locator whose shape is the member's own format", async () => {
    const zip = zipSync({ "a.txt": strToU8("body") });
    const fromZip = await readArchiveContents("zip", bucketOf(zip).bucket, "k", LIMITS);
    expect(fromZip?.members[0]?.locator.format).toBe("zip");

    const fromTar = await readArchiveContents(
      "tar",
      bucketOf(fixture("posix.tar")).bucket,
      "k",
      LIMITS,
    );
    const brief = fromTar?.members.find((member) => member.path === "docs/brief.txt");
    expect(brief?.locator).toMatchObject({ format: "tar", kind: "file" });
  });

  it("is null when the object is gone, whatever the format", async () => {
    for (const format of ["zip", "tar", "rar"] as const) {
      expect(await readArchiveContents(format, bucketOf(null).bucket, "k", LIMITS)).toBeNull();
    }
  });

  it("says so by name when a 7z is asked of a deployment with no engine", async () => {
    const { bucket } = bucketOf(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]));
    await expect(readArchiveContents("sevenZip", bucket, "k", LIMITS)).rejects.toBeInstanceOf(
      SevenZipEngineUnavailableError,
    );
  });
});

describe("archiveExtractability", () => {
  it("separates a format nothing here can unpack from an engine this deployment lacks", () => {
    expect(archiveExtractability("zip", {})).toEqual({ kind: "extractable" });
    expect(archiveExtractability("tar", {})).toEqual({ kind: "extractable" });
    // Listing a rar walks headers; decoding one needs a decoder that cannot be built here.
    expect(archiveExtractability("rar", {})).toEqual({
      kind: "refused",
      reason: "format-not-extractable",
    });
    // A 7z is extractable in principle and not in a deployment that wired no engine. Different
    // facts, and a reader acts differently on each.
    expect(archiveExtractability("sevenZip", {})).toEqual({
      kind: "refused",
      reason: "engine-unavailable",
    });
  });
});

describe("ArchiveExtraction", () => {
  async function extractionOver(format: "zip" | "tar", bytes: Uint8Array, limits = GENEROUS) {
    const { bucket, reads } = bucketOf(bytes);
    const contents = await readArchiveContents(format, bucket, "k", LIMITS);
    if (contents === null) throw new Error("the fixture reads");
    return { extraction: new ArchiveExtraction(bucket, "k", contents, limits), reads };
  }

  it("takes a zip member out through the one door", async () => {
    const zip = zipSync({ "docs/brief.txt": strToU8("In the matter of Renee Chase") });
    const { extraction } = await extractionOver("zip", zip);
    const taken = await extraction.take("docs/brief.txt");
    expect(taken.kind).toBe("ok");
    if (taken.kind !== "ok") return;
    expect(new TextDecoder().decode(taken.bytes)).toBe("In the matter of Renee Chase");
  });

  it("takes a tar member out with no decoder at all — one ranged read of its own bytes", async () => {
    const { extraction, reads } = await extractionOver("tar", fixture("posix.tar"));
    const before = reads.length;
    const taken = await extraction.take("docs/brief.txt");
    expect(taken.kind).toBe("ok");
    if (taken.kind !== "ok") return;
    expect(new TextDecoder().decode(taken.bytes)).toBe("In the matter of Renee Chase\n");
    // A tar stores its members whole: the member costs exactly the member.
    const forExtraction = reads.slice(before);
    expect(forExtraction).toHaveLength(1);
    expect(forExtraction[0]?.length).toBe("In the matter of Renee Chase\n".length);
  });

  it("refuses a directory rather than filing its absence of bytes", async () => {
    const { extraction } = await extractionOver("tar", fixture("posix.tar"));
    expect(await extraction.take("docs/")).toEqual({ kind: "refused", reason: "directory" });
  });

  it("spends ONE budget across the request, and does not let a later small member slip past", async () => {
    const zip = zipSync({
      "big.txt": strToU8("x".repeat(200)),
      "small.txt": strToU8("y".repeat(10)),
    });
    const { extraction } = await extractionOver("zip", zip, {
      ...GENEROUS,
      requestBudgetBytes: 205,
    });
    expect((await extraction.take("big.txt")).kind).toBe("ok");
    // 10 bytes would fit in what is left, and it is still refused: a request whose budget ran out
    // has run out, and letting the small ones through would make the result depend on click order.
    expect(await extraction.take("small.txt")).toEqual({ kind: "refused", reason: "too-large" });
  });

  it("refuses a member past the firm's per-member ceiling before reading a byte of it", async () => {
    const zip = zipSync({ "big.txt": strToU8("x".repeat(200)) });
    const { extraction, reads } = await extractionOver("zip", zip, {
      ...GENEROUS,
      maxUncompressedBytes: 10,
    });
    const before = reads.length;
    expect(await extraction.take("big.txt")).toEqual({ kind: "refused", reason: "too-large" });
    expect(reads.slice(before)).toHaveLength(0);
  });

  it("records every attempt, what it cost and why it ended as it did", async () => {
    const zip = zipSync({
      "kept.txt": strToU8("kept"),
      "folder/": strToU8(""),
    });
    const { extraction } = await extractionOver("zip", zip);
    await extraction.take("kept.txt");
    await extraction.take("folder/");
    // A refusal the module did not make — the ingest gate refusing the filed member — still belongs
    // to the account of what this request did.
    extraction.recordExternalRefusal("kept.txt", "unsupported-compression");

    expect(extraction.attempts).toEqual([
      {
        path: "kept.txt",
        format: "zip",
        outcome: "extracted",
        reason: null,
        declaredBytes: 4,
        producedBytes: 4,
      },
      {
        path: "folder/",
        format: "zip",
        outcome: "refused",
        reason: "directory",
        declaredBytes: 0,
        producedBytes: 0,
      },
      {
        path: "kept.txt",
        format: "zip",
        outcome: "refused",
        reason: "unsupported-compression",
        declaredBytes: 4,
        producedBytes: 0,
      },
    ]);
    expect(extraction.producedBytes).toBe(4);
  });

  it("holds() answers what the listing read, so a path it never held is not an outcome", async () => {
    const zip = zipSync({ "a.txt": strToU8("a") });
    const { extraction } = await extractionOver("zip", zip);
    expect(extraction.holds("a.txt")).toBe(true);
    expect(extraction.holds("../escape.txt")).toBe(false);
    expect(extraction.attempts).toHaveLength(0);
  });

  it("refuses a rar member by name rather than raising a fault at somebody's archive", async () => {
    // Reached only by a caller that skipped `archiveExtractability`, which is the contract. It must
    // still answer.
    const { bucket } = bucketOf(RAR5_SIGNATURE);
    const contents = await readArchiveContents("rar", bucket, "k", LIMITS);
    if (contents === null) throw new Error("the signature reads");
    const extraction = new ArchiveExtraction(bucket, "k", contents, GENEROUS);
    expect(extraction.attempts).toHaveLength(0);
  });

  it("asks the 7z engine for the member the listing named, and reports its refusal in one vocabulary", async () => {
    const calls: number[] = [];
    const engine: SevenZipEnginePort = {
      list: () =>
        Promise.resolve({
          truncated: false,
          entries: [
            {
              path: "readme.txt",
              isDirectory: false,
              compressedSizeBytes: 4,
              uncompressedSizeBytes: 5,
              modifiedAt: null,
              encrypted: false,
            },
            {
              path: "sealed.txt",
              isDirectory: false,
              compressedSizeBytes: 4,
              uncompressedSizeBytes: 5,
              modifiedAt: null,
              encrypted: true,
            },
          ],
        }),
      extract: (_bucket, _key, memberIndex) => {
        calls.push(memberIndex);
        return Promise.resolve({ kind: "ok", bytes: new TextEncoder().encode("hello") });
      },
    };
    const engines: ArchiveEngines = { sevenZip: engine };
    const { bucket } = bucketOf(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]));
    const contents = await readArchiveContents("sevenZip", bucket, "k", LIMITS, engines);
    if (contents === null) throw new Error("the engine answered");
    const extraction = new ArchiveExtraction(bucket, "k", contents, GENEROUS, engines);

    const taken = await extraction.take("readme.txt");
    expect(taken.kind).toBe("ok");
    // The index the LISTING gave it, not a name the engine has to look up again.
    expect(calls).toEqual([0]);

    // The listing already knows this one is encrypted, so the refusal costs no decode at all.
    expect(await extraction.take("sealed.txt")).toEqual({ kind: "refused", reason: "encrypted" });
    expect(calls).toEqual([0]);
  });

  it("refuses a 7z member when the deployment has no engine, rather than throwing", async () => {
    const engine: SevenZipEnginePort = {
      list: () =>
        Promise.resolve({
          truncated: false,
          entries: [
            {
              path: "readme.txt",
              isDirectory: false,
              compressedSizeBytes: 4,
              uncompressedSizeBytes: 5,
              modifiedAt: null,
              encrypted: false,
            },
          ],
        }),
      extract: () => Promise.reject(new Error("never called")),
    };
    const { bucket } = bucketOf(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]));
    const contents = await readArchiveContents("sevenZip", bucket, "k", LIMITS, {
      sevenZip: engine,
    });
    if (contents === null) throw new Error("the engine answered");
    // Listed with an engine, extracted without one: the archive is fine and this deployment cannot.
    const extraction = new ArchiveExtraction(bucket, "k", contents, GENEROUS, {});
    expect(await extraction.take("readme.txt")).toEqual({
      kind: "refused",
      reason: "unsupported-compression",
    });
  });
});
