// Listing a rar without extracting it: walk the block headers by ranged read, skipping each file's
// packed data.
//
// A rar is a chain of blocks. Every block is a header — a length, a type, and whatever fields that
// type carries — optionally followed by that block's data, and a file's header names it, sizes it,
// dates it and flags it without a byte of the packed data being touched. So listing one is header to
// header: read a header, add its own length and its data's length, read the next. That is one small
// ranged read per block rather than the archive, which is what makes listing a large rar cheap.
//
// LISTING ONLY, and that line is drawn deliberately. Nothing here decompresses and nothing here is
// derived from a decompressor: the fields below are the published container layout, which is where a
// name, a size and a date live. Taking a member OUT of a rar is not something this platform does
// (archive-format.ts is where that answer is recorded), and this file must not become the place it
// starts.
//
// TWO GENERATIONS, told apart by the signature at the front. RAR4 blocks are fixed-width
// little-endian fields. RAR5 rebuilt the same idea on variable-length integers, so nearly every
// field is a vint and its length is only known once it has been read — the two therefore need
// separate header readers over one shared walk.
//
// UNTRUSTED, like every container that arrived through the upload path. Every length in the file is
// a claim: the header size and the packed size together decide where the next header sits, so a
// lying pair is a walk that never terminates or that seeks off the end. Both are bounded here by an
// entry cap, a check of every computed position against the object's real size, a refusal to advance
// by anything that is not a positive step, and a cap on any single header read. A malformed block
// ends the walk with what was read so far marked truncated rather than throwing away the listing.
import { normalizeTarPath } from "./tar-listing.ts";
import { dosDateTimeToIso, type ArchiveSourceBucket } from "./zip-central-directory.ts";

/** One member, in the shape every archive reader on this platform answers with. */
export interface RarEntry {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly compressedSizeBytes: number;
  readonly uncompressedSizeBytes: number;
  readonly modifiedAt: string | null;
  /**
   * Whether this member's data is encrypted — true, false, or NULL where the header did not show.
   *
   * Null is a real answer and not a tidy default. A RAR4 password flag sits in the fixed header and
   * is therefore always known; a RAR5 member carries the fact in an extra area that can fall outside
   * the capped header read, and reporting `false` there would be a positive claim that the member is
   * NOT encrypted, made from bytes nobody looked at. The distinction matters because a reader who is
   * told a member is unencrypted and then cannot open it has been misled about their own archive.
   */
  readonly encrypted: boolean | null;
}

export interface RarListing {
  readonly entries: readonly RarEntry[];
  readonly truncated: boolean;
}

export interface RarListingLimits {
  readonly maxEntries: number;
}

/** "Rar!\x1a\x07\x00" — the older generation. */
const RAR4_SIGNATURE: readonly number[] = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
/** "Rar!\x1a\x07\x01\x00" — RAR5. Tested first, because RAR4's signature is its prefix. */
const RAR5_SIGNATURE: readonly number[] = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];

/**
 * The most bytes one header read fetches. A block header is small in both generations — RAR4 caps
 * its whole header at a 16-bit length and both cap a member name well below this — so the window
 * holds any real header with room to spare. A header claiming to need more than the window ends the
 * walk rather than growing the read, because the claim comes from the archive.
 */
const MAX_HEADER_READ_BYTES = 4096;

/** Below this a tail cannot hold a block header of either generation, so there is nothing to read. */
const MINIMUM_BLOCK_BYTES = 7;

/** Seven bits a byte, so ten bytes is the most that can carry a 64-bit value. */
const MAX_VARIABLE_INTEGER_BYTES = 10;

/** RAR4 base header: HEAD_CRC, HEAD_TYPE, HEAD_FLAGS, HEAD_SIZE. */
const RAR4_BASE_HEADER_BYTES = 7;

const RAR4_BLOCK_MAIN = 0x73;
const RAR4_BLOCK_FILE = 0x74;
const RAR4_BLOCK_END = 0x7b;

/** The block carries data after its header, whose length sits in ADD_SIZE. */
const RAR4_FLAG_LONG_BLOCK = 0x8000;
/** The member's data is encrypted. */
const RAR4_FLAG_PASSWORD = 0x0004;
/** The dictionary-size bits, all set, are how RAR4 spells "this member is a directory". */
const RAR4_DICTIONARY_MASK = 0x00e0;
const RAR4_DICTIONARY_DIRECTORY = 0x00e0;
/** Sizes past 4 GiB carry their high half in two extra header fields. */
const RAR4_FLAG_LARGE = 0x0100;
/** The name field holds a legacy name and an encoded wide name rather than one plain string. */
const RAR4_FLAG_UNICODE = 0x0200;
/** On the main header: the archive was packed with header encryption, so no header after it is readable. */
const RAR4_FLAG_ENCRYPTED_HEADERS = 0x0080;

const RAR5_BLOCK_FILE = 2;
const RAR5_BLOCK_ARCHIVE_ENCRYPTION = 4;
const RAR5_BLOCK_END = 5;

/** Common header flags: an extra area, and a data area, each adding a length field to the header. */
const RAR5_HEADER_FLAG_EXTRA_AREA = 0x0001;
const RAR5_HEADER_FLAG_DATA_AREA = 0x0002;

const RAR5_FILE_FLAG_DIRECTORY = 0x0001;
const RAR5_FILE_FLAG_MODIFIED_TIME = 0x0002;
const RAR5_FILE_FLAG_DATA_CRC32 = 0x0004;
/** The writer streamed the member and never went back to record how long it turned out to be. */
const RAR5_FILE_FLAG_UNKNOWN_UNPACKED_SIZE = 0x0008;

/** The extra-area record that says a member's data is encrypted. */
const RAR5_EXTRA_ENCRYPTION = 1;

const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * A bounded cursor over one header's bytes.
 *
 * Every read is range-checked against the window, and the first read that would run past it — or a
 * value too large to hold exactly — sets `malformed` and yields zero. That lets a header be read as
 * a straight run of fields with one check at the end, instead of a guard between every pair.
 */
class HeaderCursor {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  position: number;
  malformed = false;

  constructor(bytes: Uint8Array, position = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = position;
  }

  private has(length: number): boolean {
    if (this.position < 0 || this.position + length > this.bytes.byteLength) {
      this.malformed = true;
      return false;
    }
    return true;
  }

  /** Step over a field this listing does not read. Any overrun surfaces on the next actual read. */
  skip(length: number): void {
    this.position += length;
  }

  unsignedByte(): number {
    if (!this.has(1)) return 0;
    const value = this.view.getUint8(this.position);
    this.position += 1;
    return value;
  }

  unsigned16(): number {
    if (!this.has(2)) return 0;
    const value = this.view.getUint16(this.position, true);
    this.position += 2;
    return value;
  }

  unsigned32(): number {
    if (!this.has(4)) return 0;
    const value = this.view.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  /**
   * RAR5's variable-length integer: seven bits of value a byte, least significant group first, with
   * the high bit set on every byte but the last. A run that never clears the high bit is malformed
   * rather than infinite — the byte cap is what makes that true.
   */
  variableInteger(): number {
    let value = 0n;
    let shift = 0n;
    for (let index = 0; index < MAX_VARIABLE_INTEGER_BYTES; index += 1) {
      const byte = this.unsignedByte();
      if (this.malformed) return 0;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        const asNumber = Number(value);
        if (!Number.isSafeInteger(asNumber)) {
          this.malformed = true;
          return 0;
        }
        return asNumber;
      }
      shift += 7n;
    }
    this.malformed = true;
    return 0;
  }
}

/** A size split across a low and a high 32-bit field, or null when the pair cannot be held exactly. */
function combinedSize(low: number, high: number): number | null {
  const value = high * 0x1_0000_0000 + low;
  return Number.isSafeInteger(value) ? value : null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** What one parsed block tells the walk: how far to step, and the member it described if any. */
interface ParsedBlock {
  /** The block's whole footprint — its header and the data that follows it. */
  readonly blockLength: number;
  /** The member this block describes, or null for a block that describes none. */
  readonly entry: RarEntry | null;
  /** True for the block that marks the end of the archive. */
  readonly endsArchive: boolean;
}

/**
 * RAR4 names. Without the unicode flag the field is one plain string in the host's own encoding;
 * with it, the field holds a NUL-terminated legacy name followed by a rar-specific packing of the
 * wide name. The legacy half is exact for an ASCII path and only imperfect for anything else, and a
 * listing that showed a slightly wrong accent is worth more than one that refused the archive — so
 * everything here decodes as UTF-8 non-fatally and no second decoder is carried for the wide half.
 */
function decodeRar4Name(nameBytes: Uint8Array, flags: number): string {
  if ((flags & RAR4_FLAG_UNICODE) !== 0) {
    const separator = nameBytes.indexOf(0);
    if (separator !== -1) return decoder.decode(nameBytes.subarray(0, separator));
  }
  return decoder.decode(nameBytes);
}

function parseRar4FileBlock(
  window: Uint8Array,
  cursor: HeaderCursor,
  flags: number,
  headerSizeBytes: number,
): ParsedBlock | null {
  // The cursor sits just past the base header, on PACK_SIZE — which is both the member's packed
  // length and the ADD_SIZE that says how far the data reaches.
  const packedLow = cursor.unsigned32();
  const unpackedLow = cursor.unsigned32();
  cursor.skip(1); // HOST_OS
  cursor.skip(4); // FILE_CRC — the archive's claim about the unpacked bytes; only extraction could test it
  const dosDateTime = cursor.unsigned32();
  cursor.skip(2); // UNP_VER and METHOD — which decompressor a member would need, and there is none here
  const nameSizeBytes = cursor.unsigned16();
  cursor.skip(4); // ATTR — host-specific; the dictionary bits below are what name a directory
  let packedHigh = 0;
  let unpackedHigh = 0;
  if ((flags & RAR4_FLAG_LARGE) !== 0) {
    packedHigh = cursor.unsigned32();
    unpackedHigh = cursor.unsigned32();
  }
  if (cursor.malformed) return null;

  const packedSizeBytes = combinedSize(packedLow, packedHigh);
  const unpackedSizeBytes = combinedSize(unpackedLow, unpackedHigh);
  if (packedSizeBytes === null || unpackedSizeBytes === null) return null;

  const nameStart = cursor.position;
  // The name has to fit inside the header that claims to hold it, and inside the capped read.
  if (nameStart + nameSizeBytes > headerSizeBytes) return null;
  if (nameStart + nameSizeBytes > window.byteLength) return null;

  const blockLength = headerSizeBytes + packedSizeBytes;
  const path = normalizeTarPath(
    decodeRar4Name(window.subarray(nameStart, nameStart + nameSizeBytes), flags),
  );
  if (path === null) {
    // Empty, absolute or climbing — never presented, but the block's length is still known, so the
    // walk steps over it rather than ending on one bad name.
    return { blockLength, entry: null, endsArchive: false };
  }
  return {
    blockLength,
    entry: {
      path,
      isDirectory:
        (flags & RAR4_DICTIONARY_MASK) === RAR4_DICTIONARY_DIRECTORY || path.endsWith("/"),
      compressedSizeBytes: packedSizeBytes,
      uncompressedSizeBytes: unpackedSizeBytes,
      // FTIME packs the DOS time in its low half and the DOS date in its high half, the same
      // encoding a zip's central directory carries, and with the same absence of a zone.
      modifiedAt: dosDateTimeToIso(dosDateTime & 0xffff, dosDateTime >>> 16),
      encrypted: (flags & RAR4_FLAG_PASSWORD) !== 0,
    },
    endsArchive: false,
  };
}

function parseRar4Block(window: Uint8Array): ParsedBlock | null {
  const cursor = new HeaderCursor(window);
  // HEAD_CRC is not verified. Nothing is extracted here, and a header whose checksum has gone stale
  // — which a repaired or truncated archive is full of — still names its members truthfully; a
  // listing refused over a formality would be worth less than the imperfect one.
  cursor.skip(2);
  const blockType = cursor.unsignedByte();
  const flags = cursor.unsigned16();
  const headerSizeBytes = cursor.unsigned16();
  if (cursor.malformed) return null;
  // A header shorter than its own fixed part cannot be stepped over honestly.
  if (headerSizeBytes < RAR4_BASE_HEADER_BYTES) return null;

  if (blockType === RAR4_BLOCK_FILE) {
    return parseRar4FileBlock(window, cursor, flags, headerSizeBytes);
  }

  let dataSizeBytes = 0;
  if ((flags & RAR4_FLAG_LONG_BLOCK) !== 0) {
    dataSizeBytes = cursor.unsigned32();
    if (cursor.malformed) return null;
  }
  if (blockType === RAR4_BLOCK_MAIN && (flags & RAR4_FLAG_ENCRYPTED_HEADERS) !== 0) {
    // Every header after this one is ciphertext, so there are no names to read. Reporting the
    // listing as short is the only honest answer; parsing on would invent members.
    return null;
  }
  return {
    blockLength: headerSizeBytes + dataSizeBytes,
    entry: null,
    endsArchive: blockType === RAR4_BLOCK_END,
  };
}

/**
 * Whether a RAR5 header's extra area carries the record that marks the member encrypted. The area
 * is a chain of length-prefixed records, so the same rules as the block walk apply one level down:
 * bounded by the area's own end, and every step has to advance.
 */
function hasRar5EncryptionRecord(window: Uint8Array, start: number, end: number): boolean {
  let position = start;
  while (position < end) {
    if (position >= window.byteLength) return false;
    const cursor = new HeaderCursor(window, position);
    const recordSizeBytes = cursor.variableInteger();
    if (cursor.malformed || recordSizeBytes <= 0) return false;
    // A record's size counts from just after its own size field.
    const recordBodyStart = cursor.position;
    const recordType = cursor.variableInteger();
    if (cursor.malformed) return false;
    if (recordType === RAR5_EXTRA_ENCRYPTION) return true;
    const nextRecord = recordBodyStart + recordSizeBytes;
    if (nextRecord <= position || nextRecord > end) return false;
    position = nextRecord;
  }
  return false;
}

function parseRar5FileBlock(
  window: Uint8Array,
  cursor: HeaderCursor,
  headerEnd: number,
  extraAreaSizeBytes: number,
  dataSizeBytes: number,
  blockLength: number,
): ParsedBlock | null {
  const fileFlags = cursor.variableInteger();
  const unpackedSizeBytes = cursor.variableInteger();
  cursor.variableInteger(); // attributes — host-specific; the directory flag above is what this reads
  let modifiedAt: string | null = null;
  if ((fileFlags & RAR5_FILE_FLAG_MODIFIED_TIME) !== 0) {
    // RAR5 records the basic modification time as a plain 32-bit Unix instant. A higher-precision
    // time can also sit in the extra area; the basic field is the one every writer emits.
    const seconds = cursor.unsigned32();
    modifiedAt = seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
  }
  if ((fileFlags & RAR5_FILE_FLAG_DATA_CRC32) !== 0) cursor.skip(4);
  cursor.variableInteger(); // compression information — the method a member would be unpacked with
  cursor.variableInteger(); // host operating system
  const nameLengthBytes = cursor.variableInteger();
  if (cursor.malformed) return null;

  const extraAreaStart = headerEnd - extraAreaSizeBytes;
  const nameStart = cursor.position;
  // The name has to end before the extra area the header claims sits behind it, and be inside the
  // capped read.
  if (nameStart + nameLengthBytes > extraAreaStart) return null;
  if (nameStart + nameLengthBytes > window.byteLength) return null;

  // Names are UTF-8 by the format's own rule, decoded non-fatally so a damaged byte costs one
  // character rather than the listing.
  const path = normalizeTarPath(
    decoder.decode(window.subarray(nameStart, nameStart + nameLengthBytes)),
  );
  if (path === null) return { blockLength, entry: null, endsArchive: false };

  // An extra area that falls outside the capped read leaves the encryption record unseen, and that
  // is reported as unknown rather than as absent: the read was capped, so `false` here would be a
  // claim about bytes this walk never fetched.
  const sawExtraArea = headerEnd <= window.byteLength;
  const encrypted: boolean | null = !sawExtraArea
    ? null
    : extraAreaSizeBytes > 0 && hasRar5EncryptionRecord(window, extraAreaStart, headerEnd);

  return {
    blockLength,
    entry: {
      path,
      isDirectory: (fileFlags & RAR5_FILE_FLAG_DIRECTORY) !== 0 || path.endsWith("/"),
      // The packed length is the header's data area — the bytes this block is followed by.
      compressedSizeBytes: dataSizeBytes,
      // A member the writer streamed carries no unpacked size at all; zero says "not stated" rather
      // than inventing a length from the packed one.
      uncompressedSizeBytes:
        (fileFlags & RAR5_FILE_FLAG_UNKNOWN_UNPACKED_SIZE) !== 0 ? 0 : unpackedSizeBytes,
      modifiedAt,
      encrypted,
    },
    endsArchive: false,
  };
}

function parseRar5Block(window: Uint8Array): ParsedBlock | null {
  const cursor = new HeaderCursor(window);
  // The header's own CRC32, not verified — for the reason the rar4 reader records.
  cursor.skip(4);
  const headerSizeBytes = cursor.variableInteger();
  if (cursor.malformed || headerSizeBytes <= 0) return null;
  // The size counts everything after the size field itself, up to and including the extra area, so
  // the header ends this far past where the type begins.
  const headerEnd = cursor.position + headerSizeBytes;

  const blockType = cursor.variableInteger();
  const headerFlags = cursor.variableInteger();
  if (cursor.malformed) return null;
  let extraAreaSizeBytes = 0;
  if ((headerFlags & RAR5_HEADER_FLAG_EXTRA_AREA) !== 0) {
    extraAreaSizeBytes = cursor.variableInteger();
  }
  let dataSizeBytes = 0;
  if ((headerFlags & RAR5_HEADER_FLAG_DATA_AREA) !== 0) {
    dataSizeBytes = cursor.variableInteger();
  }
  if (cursor.malformed) return null;
  // An extra area larger than the header holding it is a lie about where the name ends.
  if (extraAreaSizeBytes > headerSizeBytes) return null;

  const blockLength = headerEnd + dataSizeBytes;
  if (blockType === RAR5_BLOCK_END) return { blockLength, entry: null, endsArchive: true };
  if (blockType === RAR5_BLOCK_ARCHIVE_ENCRYPTION) {
    // The archive was packed with its headers encrypted: every block after this one is ciphertext,
    // so there is no listing to give and none is guessed at.
    return null;
  }
  if (blockType !== RAR5_BLOCK_FILE) {
    // A service block — a comment, a recovery record, a quick-open index. It describes the archive
    // rather than a member, so it is stepped over.
    return { blockLength, entry: null, endsArchive: false };
  }
  return parseRar5FileBlock(
    window,
    cursor,
    headerEnd,
    extraAreaSizeBytes,
    dataSizeBytes,
    blockLength,
  );
}

/**
 * The shared walk. Reads one capped window per block, hands it to the generation's own parser, and
 * steps by whatever footprint that parser computed — so the packed data is skipped, never fetched.
 *
 * The entry cap is applied AFTER a block has been parsed rather than before: reading one block past
 * the cap costs a single bounded read and is what lets `truncated` mean "there was another member
 * you are not seeing" instead of "the archive happened to have exactly this many".
 */
async function walkRarBlocks(
  bucket: ArchiveSourceBucket,
  key: string,
  objectSizeBytes: number,
  startPosition: number,
  limits: RarListingLimits,
  parseBlock: (window: Uint8Array) => ParsedBlock | null,
): Promise<RarListing | null> {
  const entries: RarEntry[] = [];
  let position = startPosition;
  let truncated = false;

  while (position + MINIMUM_BLOCK_BYTES <= objectSizeBytes) {
    const windowLength = Math.min(MAX_HEADER_READ_BYTES, objectSizeBytes - position);
    const object = await bucket.get(key, { range: { offset: position, length: windowLength } });
    if (object === null) return null;
    const window = new Uint8Array(await object.arrayBuffer());
    if (window.byteLength < MINIMUM_BLOCK_BYTES) {
      truncated = true;
      break;
    }

    const block = parseBlock(window);
    if (block === null) {
      // The block that decides where the next one sits is unreadable, so the walk cannot continue
      // honestly. What was read stays, marked short.
      truncated = true;
      break;
    }
    if (block.endsArchive) break;

    const nextPosition = position + block.blockLength;
    // Any step that does not advance, or that leaves the object, ends the walk rather than looping.
    if (nextPosition <= position || nextPosition > objectSizeBytes) {
      truncated = true;
      break;
    }
    if (block.entry !== null) {
      if (entries.length >= limits.maxEntries) {
        truncated = true;
        break;
      }
      entries.push(block.entry);
    }
    position = nextPosition;
  }

  return { entries, truncated };
}

/**
 * Read a rar's member listing over ranged reads, or null when the object is gone.
 *
 * Never reads a member's packed data — only the block headers — so a multi-gigabyte archive lists
 * as cheaply as a small one. An object that begins with neither generation's signature comes back
 * as an empty listing marked truncated: it has no members to report, and saying so plainly would be
 * a claim about an archive this reader never read.
 */
export async function readRarListing(
  bucket: ArchiveSourceBucket,
  key: string,
  limits: RarListingLimits,
): Promise<RarListing | null> {
  const head = await bucket.head(key);
  if (head === null) return null;
  const objectSizeBytes = head.size;

  const signatureLength = Math.min(RAR5_SIGNATURE.length, objectSizeBytes);
  const signatureObject = await bucket.get(key, {
    range: { offset: 0, length: signatureLength },
  });
  if (signatureObject === null) return null;
  const signature = new Uint8Array(await signatureObject.arrayBuffer());

  if (startsWith(signature, RAR5_SIGNATURE)) {
    return walkRarBlocks(
      bucket,
      key,
      objectSizeBytes,
      RAR5_SIGNATURE.length,
      limits,
      parseRar5Block,
    );
  }
  if (startsWith(signature, RAR4_SIGNATURE)) {
    return walkRarBlocks(
      bucket,
      key,
      objectSizeBytes,
      RAR4_SIGNATURE.length,
      limits,
      parseRar4Block,
    );
  }
  return { entries: [], truncated: true };
}
