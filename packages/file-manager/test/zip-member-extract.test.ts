import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readZipCentralDirectory, type ArchiveSourceBucket } from "../src/zip-central-directory.ts";
import {
  crc32Of,
  extractZipMember,
  type ZipMemberExtractLimits,
} from "../src/zip-member-extract.ts";

/*
 * Taking a member out of a real zip, and refusing every member that should not come out.
 *
 * The fixtures are written by fflate — a real zip writer — so the extractor is held to what actual
 * archives contain rather than to bytes shaped to suit it. The hostile cases are hand-edited copies
 * of those archives, because no honest writer emits them and they are exactly what the guards exist
 * for.
 */

// The whole object, served by ranged read. Unlike the listing's seam this one allows a `head`,
// because extraction genuinely needs the object's size to bound a member against it.
function bucketOf(bytes: Uint8Array | null): ArchiveSourceBucket {
  return {
    head: () => Promise.resolve(bytes === null ? null : { size: bytes.byteLength }),
    get: (_key, options) => {
      if (bytes === null) return Promise.resolve(null);
      const range = options?.range;
      const slice =
        range === undefined
          ? bytes.slice()
          : bytes.slice(range.offset, Math.min(range.offset + range.length, bytes.byteLength));
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(slice.buffer) });
    },
  };
}

const GENEROUS: ZipMemberExtractLimits = {
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxExpansionRatio: 1000,
};

async function entriesOf(archive: Uint8Array) {
  const listing = await readZipCentralDirectory(bucketOf(archive), "k", { maxEntries: 1000 });
  if (listing === null) throw new Error("the fixture did not parse");
  return listing.entries;
}

function entry(entries: Awaited<ReturnType<typeof entriesOf>>, path: string) {
  const found = entries.find((candidate) => candidate.path === path);
  if (found === undefined) throw new Error(`the fixture has no entry at ${path}`);
  return found;
}

const BRIEF = "In the matter of Renée Chase, a brief that is long enough to actually deflate. ";
const LONG_BRIEF = BRIEF.repeat(50);

describe("extractZipMember", () => {
  it("takes a deflated member out and returns exactly its bytes", async () => {
    const archive = zipSync({ "docs/brief.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    const target = entry(entries, "docs/brief.txt");
    // The fixture must genuinely be compressed, or this test proves nothing about inflation.
    expect(target.compressionMethod).toBe(8);
    expect(target.compressedSizeBytes).toBeLessThan(target.uncompressedSizeBytes);

    const result = await extractZipMember(bucketOf(archive), "k", target, GENEROUS);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(new TextDecoder().decode(result.bytes)).toBe(LONG_BRIEF);
  });

  it("takes a stored member out, which never touches the decompressor", async () => {
    const archive = zipSync({ "readme.txt": [strToU8("short"), { level: 0 }] });
    const entries = await entriesOf(archive);
    const target = entry(entries, "readme.txt");
    expect(target.compressionMethod).toBe(0);

    const result = await extractZipMember(bucketOf(archive), "k", target, GENEROUS);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(new TextDecoder().decode(result.bytes)).toBe("short");
  });

  it("finds the right member in an archive of several", async () => {
    const archive = zipSync({
      "a.txt": strToU8("aaaa"),
      "b/deep.txt": strToU8(LONG_BRIEF),
      "c.txt": strToU8("cccc"),
    });
    const entries = await entriesOf(archive);
    const result = await extractZipMember(
      bucketOf(archive),
      "k",
      entry(entries, "b/deep.txt"),
      GENEROUS,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(new TextDecoder().decode(result.bytes)).toBe(LONG_BRIEF);
  });

  it("reads only the member, never the whole archive", async () => {
    const archive = zipSync({ "big.txt": strToU8(LONG_BRIEF), "small.txt": strToU8("x") });
    const entries = await entriesOf(archive);
    const target = entry(entries, "small.txt");
    const reads: { offset: number; length: number }[] = [];
    const watched: ArchiveSourceBucket = {
      head: () => Promise.resolve({ size: archive.byteLength }),
      get: (_key, options) => {
        const range = options?.range;
        if (range === undefined) throw new Error("extraction must not fetch the whole archive");
        reads.push(range);
        const slice = archive.slice(range.offset, range.offset + range.length);
        return Promise.resolve({ arrayBuffer: () => Promise.resolve(slice.buffer) });
      },
    };
    const result = await extractZipMember(watched, "k", target, GENEROUS);
    expect(result.kind).toBe("ok");
    // The local header, then the member's own compressed bytes. Nothing approaching the archive.
    expect(reads.every((read) => read.length < archive.byteLength)).toBe(true);
  });

  it("refuses a directory, which has no bytes to take", async () => {
    const archive = zipSync({ "docs/": strToU8(""), "docs/brief.txt": strToU8("body") });
    const entries = await entriesOf(archive);
    const directory = entries.find((candidate) => candidate.isDirectory);
    expect(directory).toBeDefined();
    if (directory === undefined) return;
    expect(await extractZipMember(bucketOf(archive), "k", directory, GENEROUS)).toEqual({
      kind: "refused",
      reason: "directory",
    });
  });

  it("refuses an encrypted member rather than filing its ciphertext", async () => {
    const archive = zipSync({ "secret.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    const encrypted = { ...entry(entries, "secret.txt"), generalPurposeFlags: 0x0001 };
    expect(await extractZipMember(bucketOf(archive), "k", encrypted, GENEROUS)).toEqual({
      kind: "refused",
      reason: "encrypted",
    });
  });

  it("refuses a compression method it does not inflate, by name", async () => {
    const archive = zipSync({ "odd.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    // 14 is LZMA: a real zip method, and not one this platform inflates.
    const lzma = { ...entry(entries, "odd.txt"), compressionMethod: 14 };
    expect(await extractZipMember(bucketOf(archive), "k", lzma, GENEROUS)).toEqual({
      kind: "refused",
      reason: "unsupported-compression",
    });
  });

  it("refuses a member past the firm's size ceiling before reading a byte of it", async () => {
    const archive = zipSync({ "big.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    const refusing: ArchiveSourceBucket = {
      head: () => {
        throw new Error("the size ceiling must be decided before the object is touched");
      },
      get: () => {
        throw new Error("the size ceiling must be decided before the object is touched");
      },
    };
    expect(
      await extractZipMember(refusing, "k", entry(entries, "big.txt"), {
        maxUncompressedBytes: 10,
        maxExpansionRatio: 1000,
      }),
    ).toEqual({ kind: "refused", reason: "too-large" });
  });

  it("refuses a member whose claimed ratio is a decompression bomb", async () => {
    const archive = zipSync({ "bomb.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    const target = entry(entries, "bomb.txt");
    expect(target.uncompressedSizeBytes / target.compressedSizeBytes).toBeGreaterThan(2);
    expect(
      await extractZipMember(bucketOf(archive), "k", target, {
        maxUncompressedBytes: 64 * 1024 * 1024,
        maxExpansionRatio: 2,
      }),
    ).toEqual({ kind: "refused", reason: "expansion-ratio" });
  });

  it("refuses a member whose bytes disagree with the checksum the archive recorded", async () => {
    const archive = zipSync({ "tampered.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    // The archive is intact and the member inflates; only its recorded CRC is wrong. That is the
    // shape of a member somebody swapped, and it must not become a file on a matter.
    const wrongCrc = { ...entry(entries, "tampered.txt"), crc32: 0x12345678 };
    expect(await extractZipMember(bucketOf(archive), "k", wrongCrc, GENEROUS)).toEqual({
      kind: "refused",
      reason: "corrupt",
    });
  });

  it("refuses a member whose local header is not where the directory says", async () => {
    const archive = zipSync({ "moved.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    const moved = { ...entry(entries, "moved.txt"), localHeaderOffset: 3 };
    expect(await extractZipMember(bucketOf(archive), "k", moved, GENEROUS)).toEqual({
      kind: "refused",
      reason: "malformed",
    });
  });

  it("refuses a member pointing past the end of the object", async () => {
    const archive = zipSync({ "over.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    const past = { ...entry(entries, "over.txt"), localHeaderOffset: archive.byteLength + 100 };
    expect(await extractZipMember(bucketOf(archive), "k", past, GENEROUS)).toEqual({
      kind: "refused",
      reason: "malformed",
    });
  });

  it("says so when the archive object is gone", async () => {
    const archive = zipSync({ "gone.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    expect(await extractZipMember(bucketOf(null), "k", entry(entries, "gone.txt"), GENEROUS)).toEqual(
      { kind: "refused", reason: "archive-missing" },
    );
  });

  it("takes an empty member out, which is a file and not a bomb", async () => {
    const archive = zipSync({ "empty.txt": strToU8("") });
    const entries = await entriesOf(archive);
    const result = await extractZipMember(
      bucketOf(archive),
      "k",
      entry(entries, "empty.txt"),
      // A ratio of zero would divide by zero on an empty member; it must still come out.
      { maxUncompressedBytes: 1024, maxExpansionRatio: 1 },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.bytes.byteLength).toBe(0);
  });
});

describe("crc32Of", () => {
  it("computes the standard checksum, so a member can be held to its archive's own claim", () => {
    // The published check value for "123456789".
    expect(crc32Of(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32Of(new Uint8Array(0))).toBe(0);
  });

  it("agrees with what a real zip writer recorded", async () => {
    const archive = zipSync({ "brief.txt": strToU8(LONG_BRIEF) });
    const entries = await entriesOf(archive);
    expect(entry(entries, "brief.txt").crc32).toBe(crc32Of(strToU8(LONG_BRIEF)));
  });
});
