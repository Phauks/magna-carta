import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { archiveFormatOf, ARCHIVE_SNIFF_BYTES } from "../src/archive-format.ts";
import { normalizeTarPath, readTarListing } from "../src/tar-listing.ts";
import type { ArchiveSourceBucket } from "../src/zip-central-directory.ts";

/*
 * Listing a tar without extracting it.
 *
 * The fixtures are REAL tars, written by the system's own `tar` — a POSIX/ustar one and a GNU one
 * carrying paths past the 100 characters the header field holds. A parser tested only against bytes
 * it was written alongside proves nothing about the archives a firm will actually be sent.
 */

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
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
      if (range === undefined) throw new Error("listing a tar must only issue ranged reads");
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

describe("readTarListing", () => {
  it("lists a real POSIX tar's members, with their sizes", async () => {
    const { bucket } = bucketOf(fixture("posix.tar"));
    const listing = await readTarListing(bucket, "k", LIMITS);
    expect(listing).not.toBeNull();
    if (listing === null) return;
    expect(listing.truncated).toBe(false);
    expect(listing.entries.map((entry) => entry.path).toSorted()).toEqual([
      "docs/",
      "docs/brief.txt",
      "readme.txt",
    ]);
    const brief = listing.entries.find((entry) => entry.path === "docs/brief.txt");
    expect(brief?.isDirectory).toBe(false);
    expect(brief?.uncompressedSizeBytes).toBe("In the matter of Renee Chase\n".length);
    // A tar stores its members whole, so the two sizes are the same fact.
    expect(brief?.compressedSizeBytes).toBe(brief?.uncompressedSizeBytes);
    expect(brief?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("marks a directory member as one", async () => {
    const { bucket } = bucketOf(fixture("posix.tar"));
    const listing = await readTarListing(bucket, "k", LIMITS);
    const directory = listing?.entries.find((entry) => entry.path === "docs/");
    expect(directory?.isDirectory).toBe(true);
  });

  it("reads a GNU long name, which no header field is wide enough to hold", async () => {
    const { bucket } = bucketOf(fixture("gnu-long.tar"));
    const listing = await readTarListing(bucket, "k", LIMITS);
    expect(listing).not.toBeNull();
    if (listing === null) return;
    const deep = listing.entries.find((entry) => entry.path.endsWith("final/deep.txt"));
    expect(deep).toBeDefined();
    // Past the 100 characters the name field holds, which is the whole point of the fixture.
    expect((deep?.path.length ?? 0) > 100).toBe(true);
    expect(deep?.uncompressedSizeBytes).toBe("deep\n".length);
  });

  it("walks header to header, never reading a member's content", async () => {
    const archive = fixture("posix.tar");
    const { bucket, reads } = bucketOf(archive);
    await readTarListing(bucket, "k", LIMITS);
    // Every read is one header block, except the long-name reads this fixture does not contain.
    expect(reads.every((read) => read.length === 512)).toBe(true);
    expect(reads.every((read) => read.length < archive.byteLength)).toBe(true);
  });

  it("stops at the entry cap and says the listing is short", async () => {
    const { bucket } = bucketOf(fixture("posix.tar"));
    const listing = await readTarListing(bucket, "k", { maxEntries: 1 });
    expect(listing?.entries).toHaveLength(1);
    expect(listing?.truncated).toBe(true);
  });

  it("is null when the object is gone", async () => {
    const { bucket } = bucketOf(null);
    expect(await readTarListing(bucket, "k", LIMITS)).toBeNull();
  });

  it("ends the walk rather than looping when a size field is unreadable", async () => {
    // A size that is not octal makes the position of the next header unknowable. The walk must end
    // with what it has rather than spin or seek at random.
    const archive = fixture("posix.tar").slice();
    archive.set(new TextEncoder().encode("99XXXXXXXXX\0"), 124);
    const { bucket } = bucketOf(archive);
    const listing = await readTarListing(bucket, "k", LIMITS);
    expect(listing?.truncated).toBe(true);
    expect(listing?.entries).toHaveLength(0);
  });

  it("ends the walk when a size would seek past the end of the object", async () => {
    const archive = fixture("posix.tar").slice();
    // An enormous octal size: the next header would sit far beyond the object.
    archive.set(new TextEncoder().encode("77777777777\0"), 124);
    const { bucket } = bucketOf(archive);
    const listing = await readTarListing(bucket, "k", LIMITS);
    expect(listing?.truncated).toBe(true);
  });
});

describe("normalizeTarPath", () => {
  it("presents a member path the way the zip listing does", () => {
    expect(normalizeTarPath("docs/brief.txt")).toBe("docs/brief.txt");
    expect(normalizeTarPath("./docs/brief.txt")).toBe("./docs/brief.txt");
    expect(normalizeTarPath("/etc/passwd")).toBe("etc/passwd");
    expect(normalizeTarPath("docs\\brief.txt")).toBe("docs/brief.txt");
  });

  it("refuses a path that climbs, so no archive presents somewhere else", () => {
    expect(normalizeTarPath("../../etc/passwd")).toBeNull();
    expect(normalizeTarPath("docs/../../etc/passwd")).toBeNull();
    expect(normalizeTarPath("")).toBeNull();
    expect(normalizeTarPath("/")).toBeNull();
  });
});

describe("archiveFormatOf", () => {
  it("knows a real tar by the magic at offset 257, not by its name", () => {
    expect(archiveFormatOf(fixture("posix.tar").subarray(0, ARCHIVE_SNIFF_BYTES))).toBe("tar");
    expect(archiveFormatOf(fixture("gnu-long.tar").subarray(0, ARCHIVE_SNIFF_BYTES))).toBe("tar");
  });

  it("knows a real zip", () => {
    const archive = zipSync({ "a.txt": strToU8("body") });
    expect(archiveFormatOf(archive.subarray(0, ARCHIVE_SNIFF_BYTES))).toBe("zip");
  });

  it("knows 7z and both rar generations by their signatures", () => {
    const sevenZip = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]);
    expect(archiveFormatOf(sevenZip)).toBe("sevenZip");
    const rar5 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    expect(archiveFormatOf(rar5)).toBe("rar");
    const rar4 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
    expect(archiveFormatOf(rar4)).toBe("rar");
  });

  it("names nothing for bytes that are not an archive it reads", () => {
    expect(archiveFormatOf(new TextEncoder().encode("%PDF-1.7\n"))).toBeNull();
    expect(archiveFormatOf(new Uint8Array(0))).toBeNull();
    expect(archiveFormatOf(new Uint8Array(300))).toBeNull();
  });
});
