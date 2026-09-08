// Browse Inside a zip without extracting it: read ONLY the archive's end-of-central-directory
// structures and its central directory from ranged reads, and return the entry listing. Extraction
// stays unbuilt on purpose — a listing needs the central directory's few kilobytes, never the
// archive's bytes, so a multi-gigabyte zip lists as cheaply as a small one.
//
// The container is UNTRUSTED input (it arrived through the upload path), so every field read from it
// is treated as a claim to verify, never a fact: offsets and lengths are clamped to the object's real
// size, the central-directory read is capped, the entry walk is capped, and a malformed individual
// record is skipped rather than trusted or thrown on. Only "this is not a zip at all" (no EOCD) is an
// error the caller must hear about.

// The minimal R2 read seam this needs — ranged gets plus a size probe. The Worker passes its real R2
// binding, which is structurally a superset; modelling only `get`/`head` keeps this package free of
// @cloudflare/workers-types, like zip-entries-from-r2.ts and its other seams.
export interface ArchiveSourceBucket {
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<{ readonly size: number } | null>;
}

export interface ZipCentralDirectoryEntry {
  // Normalized archive path: forward slashes, no leading "/". Entries carrying a ".." segment are
  // skipped upstream, so a listing never presents a traversal path.
  readonly path: string;
  readonly isDirectory: boolean;
  readonly compressedSizeBytes: number;
  readonly uncompressedSizeBytes: number;
  // DOS date/time converted to an ISO instant (the zip format records no zone; read as UTC). Null
  // when the record carries no date at all.
  readonly modifiedAt: string | null;
  // How the member's bytes are stored: 0 is stored verbatim, 8 is raw deflate. Any other value is a
  // method this platform does not inflate, and extraction refuses it by name rather than guessing.
  readonly compressionMethod: number;
  // The general-purpose bit flag, verbatim. Bit 0 set means the member is encrypted, which the
  // listing still shows (its name and size are in the clear) and extraction refuses.
  readonly generalPurposeFlags: number;
  // The member's own CRC-32, as the archive recorded it. Extraction recomputes it over the inflated
  // bytes and refuses a mismatch: it is the archive's own claim about what it holds, and checking it
  // is what makes an extracted member's provenance worth anything.
  readonly crc32: number;
  // Where this member's LOCAL header begins in the object. The listing does not use it; extraction
  // seeks to it, because a member's own bytes can only be found from here.
  readonly localHeaderOffset: number;
}

export interface ZipCentralDirectoryListing {
  readonly entries: readonly ZipCentralDirectoryEntry[];
  // True when a cap bit — the entry cap or the central-directory byte cap — so the caller can say
  // "and more" honestly instead of presenting a partial listing as the whole archive.
  readonly truncated: boolean;
}

export interface ZipCentralDirectoryLimits {
  // The most entries to return — the firm's archive-expansion entry cap; past it the walk stops and
  // reports truncated rather than throwing, because a huge archive is a fact, not a fault.
  readonly maxEntries: number;
  // The most central-directory bytes to fetch and walk. The directory's size field comes from the
  // container itself, so an absurd claim must bound the read, not size it.
  readonly maxCentralDirectoryBytes?: number;
}

// Thrown when the object is not a zip archive at all (no end-of-central-directory record), or its
// end structures are too damaged to locate the central directory. Individual bad entries never
// throw — they are skipped — so this only fires when there is no listing to give.
export class ZipCentralDirectoryError extends Error {
  readonly code: "not-a-zip" | "malformed-end-structures";
  constructor(code: "not-a-zip" | "malformed-end-structures", message: string) {
    super(message);
    this.name = "ZipCentralDirectoryError";
    this.code = code;
  }
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_RECORD_SIGNATURE = 0x06064b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;

const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP64_END_LOCATOR_BYTES = 20;
const ZIP64_END_RECORD_BYTES = 56;
const CENTRAL_FILE_HEADER_BYTES = 46;
// The EOCD's trailing comment length is a 16-bit field, so the record starts at most this far from
// the object's end.
const END_STRUCTURE_TAIL_BYTES = END_OF_CENTRAL_DIRECTORY_BYTES + 0xffff;

const DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;

// The DOS directory attribute bit in the external-attributes low byte.
const DOS_DIRECTORY_ATTRIBUTE = 0x10;

async function readRange(
  bucket: ArchiveSourceBucket,
  key: string,
  offset: number,
  length: number,
): Promise<DataView | null> {
  const object = await bucket.get(key, { range: { offset, length } });
  if (object === null) return null;
  return new DataView(await object.arrayBuffer());
}

// DOS date/time (two 16-bit words) to an ISO instant, read as UTC because the format records no
// zone. A zero date names "day 0 of month 0", which is no date — the caller renders null. Exported
// because a RAR4 file header carries the same two words in one 32-bit field (rar-listing.ts), and
// two readings of one encoding would eventually disagree.
export function dosDateTimeToIso(dosTime: number, dosDate: number): string | null {
  if (dosDate === 0) return null;
  const year = 1980 + ((dosDate >> 9) & 0x7f);
  const month = (dosDate >> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hours = (dosTime >> 11) & 0x1f;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const milliseconds = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

// Normalizes an entry's raw name to a safe archive path, or returns null for a path a listing must
// not present: absolute after stripping, empty, or carrying a ".." traversal segment. Backslashes
// are normalized to forward slashes first — the spec mandates "/", but legacy Windows writers used
// "\", and a traversal check that missed "..\" would be a check in name only.
function normalizeEntryPath(rawName: string): string | null {
  const withForwardSlashes = rawName.replaceAll("\\", "/");
  const withoutLeadingSlashes = withForwardSlashes.replace(/^\/+/, "");
  if (withoutLeadingSlashes.length === 0) return null;
  const segments = withoutLeadingSlashes.split("/");
  if (segments.some((segment) => segment === "..")) return null;
  return withoutLeadingSlashes;
}

interface EndOfCentralDirectory {
  readonly totalEntries: number;
  readonly centralDirectorySizeBytes: number;
  readonly centralDirectoryOffset: number;
}

// Locates the EOCD by scanning the tail window backwards for its signature (the record floats ahead
// of a variable-length comment), then follows the ZIP64 locator + record when any 16/32-bit field is
// saturated. Throws when no EOCD exists — that object is not a zip.
async function readEndOfCentralDirectory(
  bucket: ArchiveSourceBucket,
  key: string,
  objectSizeBytes: number,
): Promise<EndOfCentralDirectory> {
  const tailLength = Math.min(objectSizeBytes, END_STRUCTURE_TAIL_BYTES);
  const tailOffset = objectSizeBytes - tailLength;
  const tail = await readRange(bucket, key, tailOffset, tailLength);
  if (tail === null || tail.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES) {
    throw new ZipCentralDirectoryError("not-a-zip", "the object is too small to be a zip archive");
  }
  let eocdPositionInTail = -1;
  for (
    let position = tail.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES;
    position >= 0;
    position -= 1
  ) {
    if (tail.getUint32(position, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocdPositionInTail = position;
      break;
    }
  }
  if (eocdPositionInTail === -1) {
    throw new ZipCentralDirectoryError(
      "not-a-zip",
      "no end-of-central-directory record found — the object is not a zip archive",
    );
  }

  const totalEntries16 = tail.getUint16(eocdPositionInTail + 10, true);
  const centralDirectorySize32 = tail.getUint32(eocdPositionInTail + 12, true);
  const centralDirectoryOffset32 = tail.getUint32(eocdPositionInTail + 16, true);

  const needsZip64 =
    totalEntries16 === 0xffff ||
    centralDirectorySize32 === 0xffffffff ||
    centralDirectoryOffset32 === 0xffffffff;
  if (!needsZip64) {
    return {
      totalEntries: totalEntries16,
      centralDirectorySizeBytes: centralDirectorySize32,
      centralDirectoryOffset: centralDirectoryOffset32,
    };
  }

  // The ZIP64 locator sits immediately before the EOCD. Read it from the tail buffer when the window
  // covers it, otherwise with one more ranged read.
  const locatorAbsoluteOffset = tailOffset + eocdPositionInTail - ZIP64_END_LOCATOR_BYTES;
  if (locatorAbsoluteOffset < 0) {
    throw new ZipCentralDirectoryError(
      "malformed-end-structures",
      "a saturated end record with no room for a ZIP64 locator",
    );
  }
  let locator: DataView;
  if (eocdPositionInTail >= ZIP64_END_LOCATOR_BYTES) {
    locator = new DataView(
      tail.buffer,
      tail.byteOffset + eocdPositionInTail - ZIP64_END_LOCATOR_BYTES,
      ZIP64_END_LOCATOR_BYTES,
    );
  } else {
    const fetched = await readRange(bucket, key, locatorAbsoluteOffset, ZIP64_END_LOCATOR_BYTES);
    if (fetched === null || fetched.byteLength < ZIP64_END_LOCATOR_BYTES) {
      throw new ZipCentralDirectoryError("malformed-end-structures", "unreadable ZIP64 locator");
    }
    locator = fetched;
  }
  if (locator.getUint32(0, true) !== ZIP64_END_LOCATOR_SIGNATURE) {
    throw new ZipCentralDirectoryError(
      "malformed-end-structures",
      "a saturated end record without a ZIP64 locator before it",
    );
  }
  const zip64RecordOffset = Number(locator.getBigUint64(8, true));
  if (
    !Number.isSafeInteger(zip64RecordOffset) ||
    zip64RecordOffset + ZIP64_END_RECORD_BYTES > objectSizeBytes
  ) {
    throw new ZipCentralDirectoryError(
      "malformed-end-structures",
      "the ZIP64 locator points outside the object",
    );
  }
  const record = await readRange(bucket, key, zip64RecordOffset, ZIP64_END_RECORD_BYTES);
  if (
    record === null ||
    record.byteLength < ZIP64_END_RECORD_BYTES ||
    record.getUint32(0, true) !== ZIP64_END_RECORD_SIGNATURE
  ) {
    throw new ZipCentralDirectoryError("malformed-end-structures", "unreadable ZIP64 end record");
  }
  const totalEntries = Number(record.getBigUint64(32, true));
  const centralDirectorySizeBytes = Number(record.getBigUint64(40, true));
  const centralDirectoryOffset = Number(record.getBigUint64(48, true));
  if (
    !Number.isSafeInteger(totalEntries) ||
    !Number.isSafeInteger(centralDirectorySizeBytes) ||
    !Number.isSafeInteger(centralDirectoryOffset)
  ) {
    throw new ZipCentralDirectoryError(
      "malformed-end-structures",
      "the ZIP64 end record carries values past the safe-integer range",
    );
  }
  return { totalEntries, centralDirectorySizeBytes, centralDirectoryOffset };
}

// One entry's ZIP64 extended-information extra field: 8-byte replacements for whichever of the
// 32-bit sizes were saturated, in spec order (uncompressed, then compressed). Fields beyond those
// (local-header offset, disk start) follow but a listing never needs them.
interface Zip64Overridable {
  uncompressedSizeBytes: number;
  compressedSizeBytes: number;
  localHeaderOffset: number;
}

// The ZIP64 extra field carries its values in a fixed order — uncompressed size, compressed size,
// local header offset — and includes ONLY the ones whose 32-bit slot is saturated. So the cursor
// advances per field actually present, and reading the offset means reading past whichever sizes
// came before it.
function applyZip64Extra(extra: DataView, fields: Zip64Overridable): Zip64Overridable {
  let position = 0;
  while (position + 4 <= extra.byteLength) {
    const headerId = extra.getUint16(position, true);
    const dataSize = extra.getUint16(position + 2, true);
    const dataStart = position + 4;
    if (dataStart + dataSize > extra.byteLength) break; // a lying extra field ends the scan
    if (headerId === 0x0001) {
      let cursor = dataStart;
      let { uncompressedSizeBytes, compressedSizeBytes, localHeaderOffset } = fields;
      if (uncompressedSizeBytes === 0xffffffff && cursor + 8 <= dataStart + dataSize) {
        const value = Number(extra.getBigUint64(cursor, true));
        if (Number.isSafeInteger(value)) uncompressedSizeBytes = value;
        cursor += 8;
      }
      if (compressedSizeBytes === 0xffffffff && cursor + 8 <= dataStart + dataSize) {
        const value = Number(extra.getBigUint64(cursor, true));
        if (Number.isSafeInteger(value)) compressedSizeBytes = value;
        cursor += 8;
      }
      if (localHeaderOffset === 0xffffffff && cursor + 8 <= dataStart + dataSize) {
        const value = Number(extra.getBigUint64(cursor, true));
        if (Number.isSafeInteger(value)) localHeaderOffset = value;
      }
      return { uncompressedSizeBytes, compressedSizeBytes, localHeaderOffset };
    }
    position = dataStart + dataSize;
  }
  return fields;
}

// Reads a zip's entry listing from its central directory over ranged reads only, or null when the
// object is gone from the bucket. Never reads entry bytes; never extracts. Throws
// ZipCentralDirectoryError only when the object is not a zip (or its end structures are unusable);
// individual malformed entries are skipped and caps report `truncated` instead of throwing.
export async function readZipCentralDirectory(
  bucket: ArchiveSourceBucket,
  key: string,
  limits: ZipCentralDirectoryLimits,
): Promise<ZipCentralDirectoryListing | null> {
  const head = await bucket.head(key);
  if (head === null) return null;
  const objectSizeBytes = head.size;

  const end = await readEndOfCentralDirectory(bucket, key, objectSizeBytes);
  if (end.totalEntries === 0 || end.centralDirectorySizeBytes === 0) {
    return { entries: [], truncated: false };
  }
  if (end.centralDirectoryOffset >= objectSizeBytes) {
    throw new ZipCentralDirectoryError(
      "malformed-end-structures",
      "the central directory offset points outside the object",
    );
  }

  // Bound the directory read three ways: by the container's own claimed size, by what the object can
  // physically hold past the claimed offset, and by the hard cap — the claim never sizes the read.
  const maxDirectoryBytes = limits.maxCentralDirectoryBytes ?? DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES;
  const readableBytes = Math.min(
    end.centralDirectorySizeBytes,
    objectSizeBytes - end.centralDirectoryOffset,
    maxDirectoryBytes,
  );
  const directoryByteCapBit = readableBytes < end.centralDirectorySizeBytes;
  const directory = await readRange(bucket, key, end.centralDirectoryOffset, readableBytes);
  if (directory === null) return null;

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries: ZipCentralDirectoryEntry[] = [];
  let truncated = directoryByteCapBit;
  let position = 0;
  let recordsWalked = 0;
  while (recordsWalked < end.totalEntries) {
    if (position + CENTRAL_FILE_HEADER_BYTES > directory.byteLength) {
      // The buffer ended mid-record: under the byte cap that is expected truncation (already
      // reported); otherwise the directory lied about its size — stop rather than guess.
      if (!directoryByteCapBit && recordsWalked < end.totalEntries) truncated = true;
      break;
    }
    if (directory.getUint32(position, true) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      // A record without its signature has an unknowable length, so the walk cannot step past it —
      // report the listing as partial rather than throwing away what was already read.
      truncated = true;
      break;
    }
    const dosTime = directory.getUint16(position + 12, true);
    const dosDate = directory.getUint16(position + 14, true);
    const generalPurposeFlags = directory.getUint16(position + 8, true);
    const compressionMethod = directory.getUint16(position + 10, true);
    const crc32 = directory.getUint32(position + 16, true);
    const compressedSize32 = directory.getUint32(position + 20, true);
    const uncompressedSize32 = directory.getUint32(position + 24, true);
    const nameLength = directory.getUint16(position + 28, true);
    const extraLength = directory.getUint16(position + 30, true);
    const commentLength = directory.getUint16(position + 32, true);
    const externalAttributes = directory.getUint32(position + 38, true);
    const localHeaderOffset32 = directory.getUint32(position + 42, true);
    const recordLength = CENTRAL_FILE_HEADER_BYTES + nameLength + extraLength + commentLength;
    if (position + recordLength > directory.byteLength) {
      if (!directoryByteCapBit) truncated = true;
      break;
    }

    const nameBytes = new Uint8Array(
      directory.buffer,
      directory.byteOffset + position + CENTRAL_FILE_HEADER_BYTES,
      nameLength,
    );
    const extra = new DataView(
      directory.buffer,
      directory.byteOffset + position + CENTRAL_FILE_HEADER_BYTES + nameLength,
      extraLength,
    );
    position += recordLength;
    recordsWalked += 1;

    // Names are decoded as UTF-8 unconditionally: the general-purpose flag's bit 11 marks true UTF-8
    // names, and legacy CP437 names share UTF-8's ASCII range — a non-ASCII legacy name may render
    // imperfectly but can never break the listing (fatal: false).
    const path = normalizeEntryPath(decoder.decode(nameBytes));
    if (path === null) continue; // absolute, empty, or traversal — skipped, never presented

    const { uncompressedSizeBytes, compressedSizeBytes, localHeaderOffset } = applyZip64Extra(
      extra,
      {
        uncompressedSizeBytes: uncompressedSize32,
        compressedSizeBytes: compressedSize32,
        localHeaderOffset: localHeaderOffset32,
      },
    );
    const isDirectory = path.endsWith("/") || (externalAttributes & DOS_DIRECTORY_ATTRIBUTE) !== 0;

    entries.push({
      path,
      isDirectory,
      compressedSizeBytes,
      uncompressedSizeBytes,
      modifiedAt: dosDateTimeToIso(dosTime, dosDate),
      compressionMethod,
      generalPurposeFlags,
      crc32,
      localHeaderOffset,
    });
    if (entries.length >= limits.maxEntries && recordsWalked < end.totalEntries) {
      truncated = true;
      break;
    }
  }
  return { entries, truncated };
}
