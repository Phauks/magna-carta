import { describe, expect, it } from "vitest";
import { archiveFormatOf, ARCHIVE_SNIFF_BYTES } from "../src/archive-format.ts";
import { readRarListing } from "../src/rar-listing.ts";
import type { ArchiveSourceBucket } from "../src/zip-central-directory.ts";

/*
 * Listing a rar without extracting it.
 *
 * THE FIXTURES ARE HAND-BUILT, and that limit is worth stating plainly. No rar writer exists in this
 * environment — `rar`, `unrar`, `7z` and `bsdtar` are all absent and cannot be installed — so the
 * archives below are assembled byte by byte from the published container layouts: RAR4's fixed-width
 * block headers and RAR5's vint-encoded ones, down to the real header checksums. That makes these a
 * test of the parser AGAINST THE SPECIFICATION, not against a vendor's output. It is the weaker of
 * the two, and the tar listing beside this one shows the stronger form: fixtures written by the
 * system's own tar. If a rar writer ever becomes available here, these fixtures should be replaced
 * with real archives rather than kept alongside them.
 */

const encoder = new TextEncoder();

function unsigned16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function unsigned32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** RAR5's variable-length integer: seven bits a byte, low group first, high bit set to continue. */
function variableInteger(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const group = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(remaining > 0 ? group | 0x80 : group);
  } while (remaining > 0);
  return bytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ (CRC_TABLE[(value ^ byte) & 0xff] ?? 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  return joined;
}

const EMPTY = new Uint8Array(0);

/** Big enough that a reader which fetched a member's data instead of skipping it would show up. */
const PACKED_BYTES = 40_000;
function packedData(fill: number): Uint8Array {
  return new Uint8Array(PACKED_BYTES).fill(fill);
}

// ---------------------------------------------------------------------------------------------
// RAR4: a 7-byte marker, then blocks of {HEAD_CRC, HEAD_TYPE, HEAD_FLAGS, HEAD_SIZE} and their
// type's own fixed fields.
// ---------------------------------------------------------------------------------------------

const RAR4_MARKER = Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const RAR4_BASE_HEADER_BYTES = 7;
const RAR4_LONG_BLOCK = 0x8000;
const RAR4_PASSWORD = 0x0004;
const RAR4_DIRECTORY = 0x00e0;

function rar4Block(
  type: number,
  flags: number,
  body: number[],
  data: Uint8Array = EMPTY,
): Uint8Array {
  const headerSize = RAR4_BASE_HEADER_BYTES + body.length;
  const afterCrc = [type, ...unsigned16(flags), ...unsigned16(headerSize), ...body];
  // HEAD_CRC covers the header from just past itself to the end of the header.
  const crc = crc32(Uint8Array.from(afterCrc)) & 0xffff;
  return concat(Uint8Array.from([...unsigned16(crc), ...afterCrc]), data);
}

function rar4MainHeader(flags = 0): Uint8Array {
  // HighPosAv and PosAv — the authenticity-verification position, unused by a listing.
  return rar4Block(0x73, flags, [...unsigned16(0), ...unsigned32(0)]);
}

function rar4EndHeader(): Uint8Array {
  return rar4Block(0x7b, 0x4000, []);
}

interface Rar4FileOptions {
  readonly name: string;
  readonly unpackedSize: number;
  readonly flags?: number;
  readonly dosDateTime?: number;
  readonly data?: Uint8Array;
  readonly packedSize?: number;
  readonly type?: number;
}

function rar4FileBlock(options: Rar4FileOptions): Uint8Array {
  const nameBytes = encoder.encode(options.name);
  const data = options.data ?? EMPTY;
  const packedSize = options.packedSize ?? data.byteLength;
  const body = [
    ...unsigned32(packedSize), // PACK_SIZE, which is also the block's ADD_SIZE
    ...unsigned32(options.unpackedSize),
    0x03, // HOST_OS — Unix
    ...unsigned32(0), // FILE_CRC
    ...unsigned32(options.dosDateTime ?? 0),
    20, // UNP_VER
    0x30, // METHOD — stored
    ...unsigned16(nameBytes.length),
    ...unsigned32(0), // ATTR
    ...nameBytes,
  ];
  return rar4Block(options.type ?? 0x74, RAR4_LONG_BLOCK | (options.flags ?? 0), body, data);
}

// ---------------------------------------------------------------------------------------------
// RAR5: an 8-byte signature, then blocks of {CRC32, HeaderSize, HeaderType, HeaderFlags, ...} with
// vints everywhere but the two fixed 32-bit fields.
// ---------------------------------------------------------------------------------------------

const RAR5_SIGNATURE = Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);

function rar5Block(body: number[], data: Uint8Array = EMPTY): Uint8Array {
  const header = Uint8Array.from([...variableInteger(body.length), ...body]);
  // The block CRC32 covers the header size field through the end of the extra area.
  return concat(Uint8Array.from(unsigned32(crc32(header))), header, data);
}

function rar5MainHeader(): Uint8Array {
  return rar5Block([...variableInteger(1), ...variableInteger(0), ...variableInteger(0)]);
}

function rar5EndHeader(): Uint8Array {
  return rar5Block([...variableInteger(5), ...variableInteger(0), ...variableInteger(0)]);
}

/** A file-encryption record for a header's extra area: type 1, then its key-derivation material. */
function rar5EncryptionRecord(): number[] {
  return [
    ...variableInteger(1), // record type — encryption
    ...variableInteger(0), // encryption version
    ...variableInteger(0), // encryption flags
    15, // key-derivation count
    ...Array.from({ length: 16 }, () => 0xa5), // salt
    ...Array.from({ length: 16 }, () => 0x5a), // initialization vector
  ];
}

interface Rar5FileOptions {
  readonly name: string;
  readonly unpackedSize: number;
  readonly fileFlags?: number;
  readonly modifiedSeconds?: number;
  readonly data?: Uint8Array;
  readonly extraRecords?: readonly number[][];
  readonly blockType?: number;
}

function rar5FileBlock(options: Rar5FileOptions): Uint8Array {
  const nameBytes = encoder.encode(options.name);
  const data = options.data ?? EMPTY;
  const extraArea: number[] = [];
  for (const record of options.extraRecords ?? []) {
    // A record's size counts from just past its own size field.
    extraArea.push(...variableInteger(record.length), ...record);
  }
  const fileFlags = (options.fileFlags ?? 0) | (options.modifiedSeconds === undefined ? 0 : 0x0002);
  const headerFlags = (extraArea.length > 0 ? 0x0001 : 0) | (data.byteLength > 0 ? 0x0002 : 0);
  const body = [
    ...variableInteger(options.blockType ?? 2),
    ...variableInteger(headerFlags),
    ...(extraArea.length > 0 ? variableInteger(extraArea.length) : []),
    ...(data.byteLength > 0 ? variableInteger(data.byteLength) : []),
    ...variableInteger(fileFlags),
    ...variableInteger(options.unpackedSize),
    ...variableInteger(0), // attributes
    ...(options.modifiedSeconds === undefined ? [] : unsigned32(options.modifiedSeconds)),
    ...variableInteger(0), // compression information
    ...variableInteger(3), // host operating system — Unix
    ...variableInteger(nameBytes.length),
    ...nameBytes,
    ...extraArea,
  ];
  return rar5Block(body, data);
}

// ---------------------------------------------------------------------------------------------

const DOS_DATE = ((2026 - 1980) << 9) | (3 << 5) | 4;
const DOS_TIME = (9 << 11) | (15 << 5) | (30 / 2);
const DOS_DATE_TIME = DOS_DATE * 0x1_0000 + DOS_TIME;
const MODIFIED_SECONDS = Math.floor(Date.parse("2026-03-04T09:15:30Z") / 1000);
const MODIFIED_ISO = "2026-03-04T09:15:30.000Z";

/** A packed size that differs from the unpacked one, so a reader cannot pass by conflating them. */
const UNPACKED_BRIEF_BYTES = 61_000;
const UNPACKED_NOTES_BYTES = 12_345;

const RAR4_ARCHIVE = concat(
  RAR4_MARKER,
  rar4MainHeader(),
  rar4FileBlock({
    name: "matters/renee-chase/brief.txt",
    unpackedSize: UNPACKED_BRIEF_BYTES,
    dosDateTime: DOS_DATE_TIME,
    data: packedData(0x41),
  }),
  rar4FileBlock({
    name: "matters/renee-chase",
    unpackedSize: 0,
    flags: RAR4_DIRECTORY,
    dosDateTime: DOS_DATE_TIME,
  }),
  // A subheader — recovery data, an archive comment — which describes the archive rather than a
  // member, and which the walk has to step over without listing.
  rar4FileBlock({
    name: "CMT",
    type: 0x7a,
    unpackedSize: 100,
    data: new Uint8Array(100).fill(0x20),
  }),
  rar4FileBlock({
    name: "notes.txt",
    unpackedSize: UNPACKED_NOTES_BYTES,
    flags: RAR4_PASSWORD,
    dosDateTime: DOS_DATE_TIME,
    data: packedData(0x42),
  }),
  rar4EndHeader(),
);

const RAR5_ARCHIVE = concat(
  RAR5_SIGNATURE,
  rar5MainHeader(),
  rar5FileBlock({
    name: "matters/renee-chase/brief.txt",
    unpackedSize: UNPACKED_BRIEF_BYTES,
    modifiedSeconds: MODIFIED_SECONDS,
    data: packedData(0x41),
  }),
  rar5FileBlock({
    name: "matters/renee-chase",
    unpackedSize: 0,
    fileFlags: 0x0001,
    modifiedSeconds: MODIFIED_SECONDS,
  }),
  // A service block (type 3), which carries the same field layout as a file but describes the
  // archive — here its comment.
  rar5FileBlock({
    name: "CMT",
    blockType: 3,
    unpackedSize: 100,
    data: new Uint8Array(100).fill(0x20),
  }),
  rar5FileBlock({
    name: "notes.txt",
    unpackedSize: UNPACKED_NOTES_BYTES,
    modifiedSeconds: MODIFIED_SECONDS,
    data: packedData(0x42),
    extraRecords: [rar5EncryptionRecord()],
  }),
  rar5EndHeader(),
);

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
      if (range === undefined) throw new Error("listing a rar must only issue ranged reads");
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

describe("readRarListing, RAR4", () => {
  it("lists the members, with the packed and unpacked sizes kept apart", async () => {
    const { bucket } = bucketOf(RAR4_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing).not.toBeNull();
    if (listing === null) return;
    expect(listing.truncated).toBe(false);
    expect(listing.entries.map((entry) => entry.path).toSorted()).toEqual([
      "matters/renee-chase",
      "matters/renee-chase/brief.txt",
      "notes.txt",
    ]);
    const brief = listing.entries.find((entry) => entry.path === "matters/renee-chase/brief.txt");
    expect(brief?.isDirectory).toBe(false);
    expect(brief?.compressedSizeBytes).toBe(PACKED_BYTES);
    expect(brief?.uncompressedSizeBytes).toBe(UNPACKED_BRIEF_BYTES);
    expect(brief?.encrypted).toBe(false);
  });

  it("reads the DOS date and time the file header carries", async () => {
    const { bucket } = bucketOf(RAR4_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    const brief = listing?.entries.find((entry) => entry.path === "matters/renee-chase/brief.txt");
    expect(brief?.modifiedAt).toBe(MODIFIED_ISO);
  });

  it("marks a directory member as one, from the dictionary bits that spell it", async () => {
    const { bucket } = bucketOf(RAR4_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    const directory = listing?.entries.find((entry) => entry.path === "matters/renee-chase");
    expect(directory?.isDirectory).toBe(true);
  });

  it("reports a member packed with a password as encrypted", async () => {
    const { bucket } = bucketOf(RAR4_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    const notes = listing?.entries.find((entry) => entry.path === "notes.txt");
    expect(notes?.encrypted).toBe(true);
    // The name and the sizes are outside the encryption, which is exactly why listing sees them.
    expect(notes?.uncompressedSizeBytes).toBe(UNPACKED_NOTES_BYTES);
  });

  it("steps over a subheader instead of listing it as a member", async () => {
    const { bucket } = bucketOf(RAR4_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.entries.some((entry) => entry.path === "CMT")).toBe(false);
    // The member after the subheader still arrives, so the skip landed on the right byte.
    expect(listing?.entries.some((entry) => entry.path === "notes.txt")).toBe(true);
  });

  it("walks header to header, never reading a member's packed data", async () => {
    const { bucket, reads } = bucketOf(RAR4_ARCHIVE);
    await readRarListing(bucket, "k", LIMITS);
    expect(reads.every((read) => read.length <= 4096)).toBe(true);
    const bytesRead = reads.reduce((sum, read) => sum + read.length, 0);
    expect(bytesRead).toBeLessThan(RAR4_ARCHIVE.byteLength / 2);
  });

  it("stops at the entry cap and says the listing is short", async () => {
    const { bucket } = bucketOf(RAR4_ARCHIVE);
    const listing = await readRarListing(bucket, "k", { maxEntries: 2 });
    expect(listing?.entries).toHaveLength(2);
    expect(listing?.truncated).toBe(true);
  });

  it("does not call a full listing short when the cap is exactly the member count", async () => {
    const { bucket } = bucketOf(RAR4_ARCHIVE);
    const listing = await readRarListing(bucket, "k", { maxEntries: 3 });
    expect(listing?.entries).toHaveLength(3);
    expect(listing?.truncated).toBe(false);
  });

  it("ends the walk when a packed size would seek past the end of the object", async () => {
    const archive = concat(
      RAR4_MARKER,
      rar4MainHeader(),
      rar4FileBlock({ name: "first.txt", unpackedSize: 4, data: Uint8Array.from([1, 2, 3, 4]) }),
      // A block claiming far more packed data than the object holds: the next header would sit
      // beyond the end, so the walk has nowhere honest to go.
      rar4FileBlock({ name: "liar.txt", unpackedSize: 4, packedSize: 0xffff_0000 }),
      rar4EndHeader(),
    );
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.truncated).toBe(true);
    expect(listing?.entries.map((entry) => entry.path)).toEqual(["first.txt"]);
  });

  it("ends the walk rather than looping when a block claims no length", async () => {
    // HEAD_SIZE below the base header would make every step land back on this block.
    const stuck = Uint8Array.from([0, 0, 0x74, 0, 0, 0, 0]);
    const archive = concat(RAR4_MARKER, rar4MainHeader(), stuck, new Uint8Array(64));
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.truncated).toBe(true);
    expect(listing?.entries).toHaveLength(0);
  });

  it("gives no listing for an archive whose headers are themselves encrypted", async () => {
    const archive = concat(
      RAR4_MARKER,
      // The main header's password flag: every header after it is ciphertext.
      rar4MainHeader(0x0080),
      rar4FileBlock({ name: "brief.txt", unpackedSize: 4, data: Uint8Array.from([1, 2, 3, 4]) }),
    );
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.entries).toHaveLength(0);
    expect(listing?.truncated).toBe(true);
  });

  it("never presents a member whose path climbs out of the archive", async () => {
    const archive = concat(
      RAR4_MARKER,
      rar4MainHeader(),
      rar4FileBlock({
        name: "../../etc/passwd",
        unpackedSize: 4,
        data: Uint8Array.from([1, 2, 3, 4]),
      }),
      rar4FileBlock({
        name: "/absolute.txt",
        unpackedSize: 4,
        data: Uint8Array.from([1, 2, 3, 4]),
      }),
      rar4FileBlock({
        name: "windows\\notes.txt",
        unpackedSize: 4,
        data: Uint8Array.from([1, 2, 3, 4]),
      }),
      rar4EndHeader(),
    );
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", LIMITS);
    // The climbing name is dropped; the absolute one loses its root; the backslash separator is
    // normalized the way every other archive listing here presents one.
    expect(listing?.entries.map((entry) => entry.path)).toEqual([
      "absolute.txt",
      "windows/notes.txt",
    ]);
    expect(listing?.truncated).toBe(false);
  });
});

describe("readRarListing, RAR5", () => {
  it("lists the members through vint-encoded headers", async () => {
    const { bucket } = bucketOf(RAR5_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing).not.toBeNull();
    if (listing === null) return;
    expect(listing.truncated).toBe(false);
    expect(listing.entries.map((entry) => entry.path).toSorted()).toEqual([
      "matters/renee-chase",
      "matters/renee-chase/brief.txt",
      "notes.txt",
    ]);
    const brief = listing.entries.find((entry) => entry.path === "matters/renee-chase/brief.txt");
    expect(brief?.isDirectory).toBe(false);
    // Both sizes need more than one vint byte, which is the part of RAR5 a fixed-width reader fails.
    expect(brief?.compressedSizeBytes).toBe(PACKED_BYTES);
    expect(brief?.uncompressedSizeBytes).toBe(UNPACKED_BRIEF_BYTES);
    expect(brief?.modifiedAt).toBe(MODIFIED_ISO);
    expect(brief?.encrypted).toBe(false);
  });

  it("marks a directory member as one, from the file flag that says so", async () => {
    const { bucket } = bucketOf(RAR5_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    const directory = listing?.entries.find((entry) => entry.path === "matters/renee-chase");
    expect(directory?.isDirectory).toBe(true);
    expect(directory?.compressedSizeBytes).toBe(0);
  });

  it("reports a member as encrypted from the record in its extra area", async () => {
    const { bucket } = bucketOf(RAR5_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    const notes = listing?.entries.find((entry) => entry.path === "notes.txt");
    expect(notes?.encrypted).toBe(true);
    expect(notes?.uncompressedSizeBytes).toBe(UNPACKED_NOTES_BYTES);
  });

  it("steps over a service block instead of listing it as a member", async () => {
    const { bucket } = bucketOf(RAR5_ARCHIVE);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.entries.some((entry) => entry.path === "CMT")).toBe(false);
    expect(listing?.entries.some((entry) => entry.path === "notes.txt")).toBe(true);
  });

  it("walks header to header, never reading a member's packed data", async () => {
    const { bucket, reads } = bucketOf(RAR5_ARCHIVE);
    await readRarListing(bucket, "k", LIMITS);
    expect(reads.every((read) => read.length <= 4096)).toBe(true);
    const bytesRead = reads.reduce((sum, read) => sum + read.length, 0);
    expect(bytesRead).toBeLessThan(RAR5_ARCHIVE.byteLength / 2);
  });

  it("stops at the entry cap and says the listing is short", async () => {
    const { bucket } = bucketOf(RAR5_ARCHIVE);
    const listing = await readRarListing(bucket, "k", { maxEntries: 1 });
    expect(listing?.entries).toHaveLength(1);
    expect(listing?.truncated).toBe(true);
  });

  it("ends the walk when a data size would seek past the end of the object", async () => {
    const archive = concat(
      RAR5_SIGNATURE,
      rar5MainHeader(),
      rar5FileBlock({ name: "first.txt", unpackedSize: 4, data: Uint8Array.from([1, 2, 3, 4]) }),
      // The header claims a data area far larger than the object.
      rar5Block([
        ...variableInteger(2),
        ...variableInteger(0x0002),
        ...variableInteger(0xffff_0000),
        ...variableInteger(0),
        ...variableInteger(4),
        ...variableInteger(0),
        ...variableInteger(0),
        ...variableInteger(3),
        ...variableInteger("liar.txt".length),
        ...encoder.encode("liar.txt"),
      ]),
      rar5EndHeader(),
    );
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.truncated).toBe(true);
    expect(listing?.entries.map((entry) => entry.path)).toEqual(["first.txt"]);
  });

  it("ends the walk rather than looping on a header that claims no length", async () => {
    // A header size of zero: the next block would be this one, forever.
    const stuck = Uint8Array.from([...unsigned32(0), 0]);
    const archive = concat(RAR5_SIGNATURE, rar5MainHeader(), stuck, new Uint8Array(64));
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.truncated).toBe(true);
    expect(listing?.entries).toHaveLength(0);
  });

  it("gives no listing for an archive whose headers are themselves encrypted", async () => {
    const archive = concat(
      RAR5_SIGNATURE,
      // The archive-encryption block: everything after it is ciphertext.
      rar5Block([
        ...variableInteger(4), // header type — archive encryption
        ...variableInteger(0), // header flags
        ...variableInteger(0), // encryption version
        ...variableInteger(0), // encryption flags
        15, // key-derivation count
        ...Array.from({ length: 16 }, () => 0xa5), // salt
      ]),
      rar5FileBlock({ name: "brief.txt", unpackedSize: 4, data: Uint8Array.from([1, 2, 3, 4]) }),
    );
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.entries).toHaveLength(0);
    expect(listing?.truncated).toBe(true);
  });
});

describe("what a capped header read cannot see", () => {
  it("reports encryption as unknown, not as absent, when the extra area is past the window", async () => {
    // The header read is capped, so a member whose name alone runs past the cap leaves its extra
    // area unfetched. `false` there would be a claim about bytes nobody looked at, and a reader
    // told a member is unencrypted and then unable to open it has been misled about their archive.
    const archive = concat(
      RAR5_SIGNATURE,
      rar5MainHeader(),
      rar5FileBlock({
        name: "a".repeat(5000),
        unpackedSize: 10,
        extraRecords: [rar5EncryptionRecord()],
      }),
      rar5EndHeader(),
    );
    const { bucket } = bucketOf(archive);
    const listing = await readRarListing(bucket, "k", { maxEntries: 100 });
    // Either the header is too large for the capped read to parse at all, or it parses and cannot
    // answer the question. What must never happen is a confident `false`.
    for (const entry of listing?.entries ?? []) expect(entry.encrypted).not.toBe(false);
  });
});

describe("readRarListing, whatever it is handed", () => {
  it("is null when the object is gone", async () => {
    const { bucket } = bucketOf(null);
    expect(await readRarListing(bucket, "k", LIMITS)).toBeNull();
  });

  it("gives an empty short listing for bytes that are not a rar at all", async () => {
    const { bucket } = bucketOf(encoder.encode("%PDF-1.7\nnot an archive"));
    const listing = await readRarListing(bucket, "k", LIMITS);
    // Not "an archive with no members" — nothing was read, and truncated is what says so.
    expect(listing?.entries).toHaveLength(0);
    expect(listing?.truncated).toBe(true);
  });

  it("does not present a signature with nothing behind it as an empty archive", async () => {
    // A real rar ends with its own end block. Bytes that carry the signature and then run out were
    // never read to the end of anything, and reporting them as a complete listing of zero members
    // would be a claim about an archive rather than about how far the reading got.
    const { bucket } = bucketOf(concat(RAR5_SIGNATURE, new Uint8Array(4)));
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.entries).toHaveLength(0);
    expect(listing?.truncated).toBe(true);
  });

  it("gives an empty short listing for an object too small to hold a signature", async () => {
    const { bucket } = bucketOf(Uint8Array.from([0x52, 0x61, 0x72]));
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.entries).toHaveLength(0);
    expect(listing?.truncated).toBe(true);
  });

  it("lists an archive holding nothing but its own end block", async () => {
    const { bucket } = bucketOf(concat(RAR5_SIGNATURE, rar5MainHeader(), rar5EndHeader()));
    const listing = await readRarListing(bucket, "k", LIMITS);
    expect(listing?.entries).toHaveLength(0);
    expect(listing?.truncated).toBe(false);
  });
});

describe("archiveFormatOf", () => {
  it("knows both generations of the hand-built fixtures by their signatures", () => {
    expect(archiveFormatOf(RAR4_ARCHIVE.subarray(0, ARCHIVE_SNIFF_BYTES))).toBe("rar");
    expect(archiveFormatOf(RAR5_ARCHIVE.subarray(0, ARCHIVE_SNIFF_BYTES))).toBe("rar");
  });
});
