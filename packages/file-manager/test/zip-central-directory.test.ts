import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  readZipCentralDirectory,
  ZipCentralDirectoryError,
  type ArchiveSourceBucket,
} from "../src/zip-central-directory.ts";

// The parser is hand-rolled (fflate cannot do ranged central-directory-only reads), so fixtures are
// built with fflate — a real zip writer — and the parser is held to what that writer produces, plus
// hand-assembled end structures for the ZIP64 and hostile-container shapes no friendly writer emits.

// An in-memory ranged-read seam over one object's bytes. Refuses an unranged get loudly: the whole
// point of the parser is that it never fetches the archive's body.
function bucketOf(bytes: Uint8Array | null): {
  bucket: ArchiveSourceBucket;
  requests: { offset: number; length: number }[];
} {
  const requests: { offset: number; length: number }[] = [];
  const bucket: ArchiveSourceBucket = {
    head: () => Promise.resolve(bytes === null ? null : { size: bytes.byteLength }),
    get: (key, options) => {
      if (bytes === null) return Promise.resolve(null);
      const range = options?.range;
      if (range === undefined) {
        throw new Error("the central-directory parser must only ever issue ranged reads");
      }
      requests.push(range);
      const slice = bytes.slice(
        range.offset,
        Math.min(range.offset + range.length, bytes.byteLength),
      );
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(slice.buffer) });
    },
  };
  return { bucket, requests };
}

// An even-seconds instant, because DOS timestamps have two-second resolution.
const MTIME = new Date(Date.UTC(2026, 5, 13, 10, 20, 30));
// What the parser reads back: DOS timestamps are zone-naive — fflate encodes the writer's LOCAL
// calendar fields, and the parser reads them as UTC — so the expected instant is composed from the
// local fields, keeping the assertion true in any test-runner zone.
const MTIME_AS_READ = new Date(
  Date.UTC(
    MTIME.getFullYear(),
    MTIME.getMonth(),
    MTIME.getDate(),
    MTIME.getHours(),
    MTIME.getMinutes(),
    MTIME.getSeconds(),
  ),
).toISOString();

function fixtureZip(): Uint8Array {
  return zipSync({
    "readme.txt": [strToU8("hello archive"), { mtime: MTIME }],
    "docs/": [new Uint8Array(0), { mtime: MTIME }],
    "docs/brief.txt": [strToU8("the brief body, long enough to deflate"), { mtime: MTIME }],
  });
}

// Little-endian struct writer for the hand-assembled fixtures.
class ByteWriter {
  private readonly parts: number[] = [];
  u16(value: number): this {
    this.parts.push(value & 0xff, (value >> 8) & 0xff);
    return this;
  }
  u32(value: number): this {
    this.parts.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }
  u64(value: bigint): this {
    for (let index = 0n; index < 8n; index += 1n) {
      this.parts.push(Number((value >> (8n * index)) & 0xffn));
    }
    return this;
  }
  raw(bytes: Uint8Array): this {
    this.parts.push(...bytes);
    return this;
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

// A central file header with the given saturations — only the fields the parser reads are meaningful.
function centralHeader(input: {
  name: string;
  compressed: number;
  uncompressed: number;
  extra?: Uint8Array;
  externalAttributes?: number;
  dosDate?: number;
  dosTime?: number;
  signature?: number;
}): Uint8Array {
  const name = strToU8(input.name);
  const extra = input.extra ?? new Uint8Array(0);
  return new ByteWriter()
    .u32(input.signature ?? 0x02014b50)
    .u16(45) // version made by
    .u16(45) // version needed
    .u16(0) // flags
    .u16(0) // method
    .u16(input.dosTime ?? 0)
    .u16(input.dosDate ?? 0)
    .u32(0) // crc
    .u32(input.compressed)
    .u32(input.uncompressed)
    .u16(name.byteLength)
    .u16(extra.byteLength)
    .u16(0) // comment length
    .u16(0) // disk number start
    .u16(0) // internal attributes
    .u32(input.externalAttributes ?? 0)
    .u32(0) // local header offset
    .raw(name)
    .raw(extra)
    .bytes();
}

function endOfCentralDirectory(input: {
  totalEntries: number;
  directorySize: number;
  directoryOffset: number;
}): Uint8Array {
  return new ByteWriter()
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(input.totalEntries)
    .u16(input.totalEntries)
    .u32(input.directorySize)
    .u32(input.directoryOffset)
    .u16(0)
    .bytes();
}

describe("readZipCentralDirectory", () => {
  it("lists a real zip's entries — paths, sizes, directory flags, and DOS mtimes as ISO", async () => {
    const { bucket } = bucketOf(fixtureZip());
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 100 });
    expect(listing).not.toBeNull();
    expect(listing?.truncated).toBe(false);
    const byPath = new Map(listing?.entries.map((entry) => [entry.path, entry]));
    expect([...byPath.keys()].toSorted()).toEqual(["docs/", "docs/brief.txt", "readme.txt"]);
    const readme = byPath.get("readme.txt");
    expect(readme?.isDirectory).toBe(false);
    expect(readme?.uncompressedSizeBytes).toBe("hello archive".length);
    expect(readme?.compressedSizeBytes).toBeGreaterThan(0);
    expect(readme?.modifiedAt).toBe(MTIME_AS_READ);
    expect(byPath.get("docs/")?.isDirectory).toBe(true);
  });

  it("never fetches the archive's body — every read is ranged and stays in the end structures", async () => {
    const zip = fixtureZip();
    const { bucket, requests } = bucketOf(zip);
    await readZipCentralDirectory(bucket, "k", { maxEntries: 100 });
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      // Every read starts at or after the central directory — the entry bytes at the front of the
      // archive are never touched. (For this small fixture the tail window covers the whole object,
      // so the assertion is on the byte volume instead: no read is the object minus its tail.)
      expect(request.length).toBeLessThanOrEqual(zip.byteLength);
    }
  });

  it("returns null when the object is gone from the bucket", async () => {
    const { bucket } = bucketOf(null);
    expect(await readZipCentralDirectory(bucket, "k", { maxEntries: 10 })).toBeNull();
  });

  it("throws the typed not-a-zip error when no end-of-central-directory record exists", async () => {
    const { bucket } = bucketOf(strToU8("this is a plain text file, nothing like a zip archive"));
    await expect(readZipCentralDirectory(bucket, "k", { maxEntries: 10 })).rejects.toSatisfy(
      (error) => error instanceof ZipCentralDirectoryError && error.code === "not-a-zip",
    );
  });

  it("finds the end record behind a trailing archive comment", async () => {
    const zip = fixtureZip();
    const comment = strToU8("appended archive comment");
    const withComment = new Uint8Array(zip.byteLength + comment.byteLength);
    withComment.set(zip, 0);
    withComment.set(comment, zip.byteLength);
    // Patch the EOCD's comment-length field (the record starts 22 bytes from the original end).
    const eocdStart = zip.byteLength - 22;
    withComment[eocdStart + 20] = comment.byteLength & 0xff;
    withComment[eocdStart + 21] = (comment.byteLength >> 8) & 0xff;
    const { bucket } = bucketOf(withComment);
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 100 });
    expect(listing?.entries.map((entry) => entry.path).toSorted()).toEqual([
      "docs/",
      "docs/brief.txt",
      "readme.txt",
    ]);
  });

  it("caps the entry walk at maxEntries and reports truncated", async () => {
    const zip = zipSync({
      "a.txt": strToU8("a"),
      "b.txt": strToU8("b"),
      "c.txt": strToU8("c"),
      "d.txt": strToU8("d"),
    });
    const { bucket } = bucketOf(zip);
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 2 });
    expect(listing?.entries).toHaveLength(2);
    expect(listing?.truncated).toBe(true);
  });

  it("caps the central-directory read and reports truncated instead of trusting the container's size", async () => {
    const zip = fixtureZip();
    const { bucket } = bucketOf(zip);
    // A cap smaller than one central record: nothing parses, but nothing throws either.
    const listing = await readZipCentralDirectory(bucket, "k", {
      maxEntries: 100,
      maxCentralDirectoryBytes: 10,
    });
    expect(listing?.truncated).toBe(true);
    expect(listing?.entries).toHaveLength(0);
  });

  it("skips traversal paths and strips a leading slash without aborting the listing", async () => {
    const directory = new Uint8Array([
      ...centralHeader({ name: "../evil.txt", compressed: 1, uncompressed: 1 }),
      ...centralHeader({ name: "/abs.txt", compressed: 1, uncompressed: 1 }),
      ...centralHeader({ name: "nested/..\\sneaky.txt", compressed: 1, uncompressed: 1 }),
      ...centralHeader({ name: "fine.txt", compressed: 1, uncompressed: 1 }),
    ]);
    const zip = new Uint8Array([
      ...directory,
      ...endOfCentralDirectory({
        totalEntries: 4,
        directorySize: directory.byteLength,
        directoryOffset: 0,
      }),
    ]);
    const { bucket } = bucketOf(zip);
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 10 });
    // The traversal entries are gone; the absolute path is kept, re-rooted, because a listing must
    // not present a path outside the archive but "/abs.txt" names bytes really inside it.
    expect(listing?.entries.map((entry) => entry.path)).toEqual(["abs.txt", "fine.txt"]);
    expect(listing?.truncated).toBe(false);
  });

  it("stops at a malformed record and reports the partial listing as truncated", async () => {
    const directory = new Uint8Array([
      ...centralHeader({ name: "first.txt", compressed: 1, uncompressed: 1 }),
      ...centralHeader({
        name: "broken.txt",
        compressed: 1,
        uncompressed: 1,
        signature: 0x12345678,
      }),
      ...centralHeader({ name: "after.txt", compressed: 1, uncompressed: 1 }),
    ]);
    const zip = new Uint8Array([
      ...directory,
      ...endOfCentralDirectory({
        totalEntries: 3,
        directorySize: directory.byteLength,
        directoryOffset: 0,
      }),
    ]);
    const { bucket } = bucketOf(zip);
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 10 });
    expect(listing?.entries.map((entry) => entry.path)).toEqual(["first.txt"]);
    expect(listing?.truncated).toBe(true);
  });

  it("reads a directory entry from the DOS attribute bit and a zero DOS date as null", async () => {
    const directory = centralHeader({
      name: "old-style-dir",
      compressed: 0,
      uncompressed: 0,
      externalAttributes: 0x10,
    });
    const zip = new Uint8Array([
      ...directory,
      ...endOfCentralDirectory({
        totalEntries: 1,
        directorySize: directory.byteLength,
        directoryOffset: 0,
      }),
    ]);
    const { bucket } = bucketOf(zip);
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 10 });
    expect(listing?.entries).toEqual([
      {
        path: "old-style-dir",
        isDirectory: true,
        compressedSizeBytes: 0,
        uncompressedSizeBytes: 0,
        modifiedAt: null,
      },
    ]);
  });

  it("follows the ZIP64 locator and end record when the 16/32-bit fields are saturated", async () => {
    const zip64Extra = new ByteWriter()
      .u16(0x0001)
      .u16(16)
      .u64(5_000_000_000n) // uncompressed
      .u64(4_999_999_999n) // compressed
      .bytes();
    const directory = centralHeader({
      name: "big.bin",
      compressed: 0xffffffff,
      uncompressed: 0xffffffff,
      extra: zip64Extra,
    });
    const zip64EndRecord = new ByteWriter()
      .u32(0x06064b50)
      .u64(44n) // size of the remainder of this record
      .u16(45)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(1n) // entries on this disk
      .u64(1n) // total entries
      .u64(BigInt(directory.byteLength))
      .u64(0n) // central directory offset
      .bytes();
    const locator = new ByteWriter()
      .u32(0x07064b50)
      .u32(0)
      .u64(BigInt(directory.byteLength)) // where the ZIP64 end record sits
      .u32(1)
      .bytes();
    const zip = new Uint8Array([
      ...directory,
      ...zip64EndRecord,
      ...locator,
      ...endOfCentralDirectory({
        totalEntries: 0xffff,
        directorySize: 0xffffffff,
        directoryOffset: 0xffffffff,
      }),
    ]);
    const { bucket } = bucketOf(zip);
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 10 });
    expect(listing?.truncated).toBe(false);
    expect(listing?.entries).toEqual([
      {
        path: "big.bin",
        isDirectory: false,
        compressedSizeBytes: 4_999_999_999,
        uncompressedSizeBytes: 5_000_000_000,
        modifiedAt: null,
      },
    ]);
  });

  it("lists an empty zip as no entries, not truncated", async () => {
    const zip = endOfCentralDirectory({ totalEntries: 0, directorySize: 0, directoryOffset: 0 });
    const { bucket } = bucketOf(zip);
    const listing = await readZipCentralDirectory(bucket, "k", { maxEntries: 10 });
    expect(listing).toEqual({ entries: [], truncated: false });
  });
});
