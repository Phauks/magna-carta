// Taking ONE member out of a zip, by ranged reads over the stored object.
//
// Browsing a zip reads its central directory and nothing else (zip-central-directory.ts). Extraction
// is the other half, and it is a different act with different consequences: a member pulled out
// becomes a file on the matter, so its bytes have to be found, inflated, checked, and then handed to
// the ordinary ingest gate exactly like an upload. This module does the first three. It never writes
// anything and never decides what a member IS — the gate sniffs the real bytes, because the name
// inside an archive is the other party's claim about its contents, not a fact.
//
// SELECTIVE BY CONSTRUCTION. The member is located from its own local header offset and only its
// compressed bytes are read, so pulling one document out of a multi-gigabyte archive costs that
// document, not the archive. Nothing here ever holds the container.
//
// THE CONTAINER IS UNTRUSTED, and a zip is a format designed to be lied to. Every length in it is a
// claim: the central directory's, the local header's, and the inflated stream's own. So each is
// checked against the object's real size and against the firm's caps BEFORE any inflation, and the
// inflated bytes are checked again on the way out — against the length the archive promised and
// against its own CRC-32. A member that disagrees with itself is refused rather than filed.
//
// The inflate is the runtime's own `DecompressionStream("deflate-raw")`, so there is no compression
// library here and no C or C++ anywhere near an attacker's bytes.
import type { ArchiveSourceBucket, ZipCentralDirectoryEntry } from "./zip-central-directory.ts";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_FILE_HEADER_BYTES = 30;

/** Stored verbatim. */
const METHOD_STORED = 0;
/** Raw deflate, which is what almost every zip in practice uses. */
const METHOD_DEFLATE = 8;

/** Bit 0 of the general-purpose flag: the member's bytes are encrypted. */
const FLAG_ENCRYPTED = 0x0001;

/** What the firm's archive policy allows a single extraction to produce. */
export interface ZipMemberExtractLimits {
  /** The largest a single member may inflate to. */
  readonly maxUncompressedBytes: number;
  /**
   * The most a member may grow when inflated, as a multiple of its compressed size. This is the
   * decompression-bomb guard: a few kilobytes that inflate to gigabytes fail here, before the bytes
   * are held, rather than by exhausting the runtime.
   */
  readonly maxExpansionRatio: number;
}

/** Why a member could not be taken out. Each is a fact about the member, never a generic failure. */
export type ZipMemberRefusal =
  /** The archive object is gone from storage. */
  | "archive-missing"
  /** The entry names a directory, which has no bytes to take out. */
  | "directory"
  /** The member is encrypted; this platform holds no password for it. */
  | "encrypted"
  /** The member is stored by a method this platform does not inflate. */
  | "unsupported-compression"
  /** The archive's own structure does not hold together where this member should be. */
  | "malformed"
  /** The member is larger than the firm allows a single extraction to produce. */
  | "too-large"
  /** The member's compression ratio exceeds the firm's ceiling. */
  | "expansion-ratio"
  /** The inflated bytes disagree with the length or the checksum the archive recorded. */
  | "corrupt";

export type ZipMemberExtraction =
  | { readonly kind: "ok"; readonly bytes: Uint8Array }
  | { readonly kind: "refused"; readonly reason: ZipMemberRefusal };

/*
 * CRC-32, the checksum a zip records for every member. Computed here rather than taken from a
 * library because it is fifteen lines and the alternative is a dependency that would run over
 * attacker-supplied bytes. The table is built once per isolate.
 */
let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32Of(bytes: Uint8Array): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xff] as number);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Read a byte range out of the object, or null when the object or the range is not there. */
async function readRange(
  bucket: ArchiveSourceBucket,
  key: string,
  offset: number,
  length: number,
  // Typed as ArrayBuffer-backed (not the wider ArrayBufferLike) because both are minted here from a
  // fresh ArrayBuffer, and the Blob the inflate runs over will only take a view over a real one.
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (length <= 0) return new Uint8Array(0);
  const object = await bucket.get(key, { range: { offset, length } });
  if (object === null) return null;
  return new Uint8Array(await object.arrayBuffer());
}

/**
 * Where a member's compressed bytes actually begin.
 *
 * The central directory records where the LOCAL header is, not where the data is, and the local
 * header carries its own name and extra lengths which are allowed to differ from the central
 * directory's. So the local header is read and trusted for that one arithmetic and nothing else:
 * its signature is checked, and the data offset is computed from its own lengths.
 */
async function memberDataOffset(
  bucket: ArchiveSourceBucket,
  key: string,
  entry: ZipCentralDirectoryEntry,
  objectSize: number,
): Promise<number | null> {
  if (entry.localHeaderOffset < 0 || entry.localHeaderOffset + LOCAL_FILE_HEADER_BYTES > objectSize) {
    return null;
  }
  const header = await readRange(bucket, key, entry.localHeaderOffset, LOCAL_FILE_HEADER_BYTES);
  if (header === null || header.byteLength < LOCAL_FILE_HEADER_BYTES) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE) return null;
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const dataOffset = entry.localHeaderOffset + LOCAL_FILE_HEADER_BYTES + nameLength + extraLength;
  return dataOffset > objectSize ? null : dataOffset;
}

/** Inflate raw-deflate bytes through the runtime's own decompressor, capped as it goes. */
async function inflate(
  compressed: Uint8Array<ArrayBuffer>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | "too-large"> {
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Checked as it arrives, not at the end: a bomb is refused while it is still inflating rather
      // than after the runtime has already held all of it.
      if (total > maxBytes) return "too-large";
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Take one member's bytes out of the archive, or say why not.
 *
 * Every refusal is checked before the bytes are read where it can be: an encrypted member, an
 * unsupported method, a promised size past the firm's ceiling and a ratio past its ceiling all cost
 * one central-directory read that has already happened. What cannot be known in advance — whether
 * the stream inflates to what it claimed — is checked afterwards, against both the length and the
 * checksum the archive itself recorded.
 */
export async function extractZipMember(
  bucket: ArchiveSourceBucket,
  key: string,
  entry: ZipCentralDirectoryEntry,
  limits: ZipMemberExtractLimits,
): Promise<ZipMemberExtraction> {
  if (entry.isDirectory) return { kind: "refused", reason: "directory" };
  if ((entry.generalPurposeFlags & FLAG_ENCRYPTED) !== 0) {
    return { kind: "refused", reason: "encrypted" };
  }
  if (entry.compressionMethod !== METHOD_STORED && entry.compressionMethod !== METHOD_DEFLATE) {
    return { kind: "refused", reason: "unsupported-compression" };
  }
  if (entry.uncompressedSizeBytes > limits.maxUncompressedBytes) {
    return { kind: "refused", reason: "too-large" };
  }
  // A ratio is only meaningful over a member with bytes behind it; an empty member divides by zero
  // and is never a bomb.
  if (
    entry.compressedSizeBytes > 0 &&
    entry.uncompressedSizeBytes / entry.compressedSizeBytes > limits.maxExpansionRatio
  ) {
    return { kind: "refused", reason: "expansion-ratio" };
  }

  const head = await bucket.head(key);
  if (head === null) return { kind: "refused", reason: "archive-missing" };
  const dataOffset = await memberDataOffset(bucket, key, entry, head.size);
  if (dataOffset === null) return { kind: "refused", reason: "malformed" };
  if (dataOffset + entry.compressedSizeBytes > head.size) {
    return { kind: "refused", reason: "malformed" };
  }

  const compressed = await readRange(bucket, key, dataOffset, entry.compressedSizeBytes);
  if (compressed === null) return { kind: "refused", reason: "archive-missing" };
  if (compressed.byteLength !== entry.compressedSizeBytes) {
    return { kind: "refused", reason: "malformed" };
  }

  let bytes: Uint8Array<ArrayBuffer>;
  if (entry.compressionMethod === METHOD_STORED) {
    bytes = compressed;
  } else {
    let inflated: Uint8Array<ArrayBuffer> | "too-large";
    try {
      inflated = await inflate(compressed, limits.maxUncompressedBytes);
    } catch {
      // A stream that will not inflate is a corrupt member, not a platform failure.
      return { kind: "refused", reason: "corrupt" };
    }
    if (inflated === "too-large") return { kind: "refused", reason: "too-large" };
    bytes = inflated;
  }

  // The archive's own two claims about what it holds. Both are checked, because a member whose
  // bytes do not match what its container recorded is not evidence of anything.
  if (bytes.byteLength !== entry.uncompressedSizeBytes) {
    return { kind: "refused", reason: "corrupt" };
  }
  if (crc32Of(bytes) !== entry.crc32) return { kind: "refused", reason: "corrupt" };

  return { kind: "ok", bytes };
}
