// Listing what is inside a 7z archive without extracting any of it.
//
// A 7z keeps its file list in a header at the END of the archive, and that header is normally
// LZMA-compressed, so unlike zip and tar it cannot be listed by reading bytes and doing arithmetic —
// it needs a real LZMA decoder. That decoder is Rust (crates/seven-zip-core, over
// sevenz-rust2) compiled to WebAssembly, and this module is the seam between it and the platform.
//
// WHAT IT COSTS TO LIST ONE. Two ranged reads for an archive whose file list is stored plain, three
// when it is compressed, and nothing else however large the archive is — the same property the zip
// and tar listings have. `readSevenZipListing` drives that: the engine answers each call with either
// the listing or the next range it needs, and this loops until it has one.
import init, { extractRanges, listRanges } from "./pkg/seven_zip_core.js";

// Optional wasm bytes for environments (Node/Vitest) where fetch is unavailable.
// Pass the result of `readFileSync(wasmPath)` — the loader handles both Buffer and Uint8Array.
let ready: Promise<unknown> | undefined;

// In Cloudflare Workers the bundler provides the WASM as a pre-compiled WebAssembly.Module
// (imported via the package's wasm export entry). Passing it here avoids the URL-fetch fallback
// that wasm-bindgen's generated init() would otherwise attempt at runtime.
export async function ensureReady(
  wasmInput?: Uint8Array | ArrayBuffer | WebAssembly.Module,
): Promise<void> {
  if (ready === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready = wasmInput !== undefined ? init({ module_or_path: wasmInput as any }) : init();
  }
  await ready;
}

/** One member, in the shape every archive reader on this platform answers with. */
export interface SevenZipEntry {
  readonly path: string;
  readonly isDirectory: boolean;
  /**
   * Packed bytes. Members a 7z compressed together in one block share a single packed stream, so
   * that block's size is reported against its first member and the rest report 0 — there is no
   * honest per-member figure when the members have no separate compressed form.
   */
  readonly compressedSizeBytes: number;
  readonly uncompressedSizeBytes: number;
  readonly modifiedAt: string | null;
  /**
   * Whether this member's content is AES-encrypted. A 7z encrypts content and the file list
   * separately, so an archive can be listed member by member while none of it can be opened.
   */
  readonly encrypted: boolean;
}

export interface SevenZipListing {
  readonly entries: readonly SevenZipEntry[];
  readonly truncated: boolean;
}

/** Stable error codes the listing engine answers with. */
export type SevenZipListingErrorCode =
  | "notSevenZip"
  | "unsupportedVersion"
  | "headerEncrypted"
  | "tooLarge"
  | "unsupportedCoder"
  | "malformed"
  | "rangeMismatch";

/**
 * What extraction can refuse on top of everything a listing can. Extraction reads the same header
 * first, so every listing code is reachable here too.
 */
export type SevenZipExtractionErrorCode =
  | SevenZipListingErrorCode
  /** No member sits at that index in this archive. */
  | "memberNotFound"
  /** The index names a directory, or an entry with no content stream of its own. */
  | "notAFile"
  /** The member's content is AES-encrypted; this build carries no AES coder and holds no password. */
  | "memberEncrypted"
  /** The decoded bytes disagree with the length or the checksum the archive recorded. */
  | "corrupt";

/**
 * Thrown when the engine refuses an archive. Branch on `.code` — never string-match `.message`.
 *
 * `headerEncrypted` is the one worth handling separately: the archive is intact and its members are
 * there, but whoever packed it chose to encrypt the file list too, so the names cannot be shown
 * without the password.
 */
export class SevenZipListingError extends Error {
  public readonly code: SevenZipExtractionErrorCode;

  constructor(code: SevenZipExtractionErrorCode) {
    super(code);
    this.name = "SevenZipListingError";
    this.code = code;
  }
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<SevenZipExtractionErrorCode>([
  "notSevenZip",
  "unsupportedVersion",
  "headerEncrypted",
  "tooLarge",
  "unsupportedCoder",
  "malformed",
  "rangeMismatch",
  "memberNotFound",
  "notAFile",
  "memberEncrypted",
  "corrupt",
]);

function wrapEngineError(thrown: unknown): SevenZipListingError {
  if (thrown instanceof Error && KNOWN_ERROR_CODES.has(thrown.message)) {
    return new SevenZipListingError(thrown.message as SevenZipExtractionErrorCode);
  }
  // Anything else is the engine failing in a way it does not have a code for — a trap on an
  // allocation a hostile header asked for, most plausibly. It is still a refusal, never a listing.
  return new SevenZipListingError("malformed");
}

/**
 * The ceilings a listing refuses to work above. Every one bounds something the archive DECLARES
 * about itself, which is why the caller sets them: an archive can claim a four-gigabyte dictionary
 * in five bytes.
 */
export interface SevenZipListingLimits {
  /** How many entries to return. Hitting it produces `truncated: true`, not a refusal. */
  readonly maxEntries: number;
  /** Largest header blob to fetch and hold. Default 32 MiB. */
  readonly maxHeaderBytes?: number;
  /** Largest decoded header to allocate for. Default 256 MiB. */
  readonly maxDecodedHeaderBytes?: number;
  /** Largest LZMA dictionary a header decode may allocate. Default 256 MiB. */
  readonly maxDictionaryBytes?: number;
}

const DEFAULT_MAX_HEADER_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_DECODED_HEADER_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_DICTIONARY_BYTES = 256 * 1024 * 1024;

/** Read `[offset, offset + length)` of the archive. This is where a ranged object read goes. */
export type ArchiveRangeReader = (offset: number, length: number) => Promise<Uint8Array>;

interface EngineEntry {
  path: string;
  isDirectory: boolean;
  compressedSizeBytes: number;
  uncompressedSizeBytes: number;
  modifiedAtEpochMillis: number | null;
  encrypted: boolean;
}

type EngineOutcome =
  | { status: "listing"; entries: EngineEntry[]; truncated: boolean }
  | { status: "needRange"; offset: number; length: number };

/**
 * A listing walks the start header, the next header, and — only when the file list is compressed —
 * the packed stream that holds it. A fourth request means the engine asked for a range it had not
 * named, which is a refusal rather than another read.
 */
const MAX_RANGE_REQUESTS = 3;

function toEntry(entry: EngineEntry): SevenZipEntry {
  return {
    path: entry.path,
    isDirectory: entry.isDirectory,
    compressedSizeBytes: entry.compressedSizeBytes,
    uncompressedSizeBytes: entry.uncompressedSizeBytes,
    modifiedAt:
      entry.modifiedAtEpochMillis === null
        ? null
        : new Date(entry.modifiedAtEpochMillis).toISOString(),
    encrypted: entry.encrypted,
  };
}

function callEngine(
  archiveSizeBytes: number,
  offsets: number[],
  bytes: Uint8Array[],
  limits: SevenZipListingLimits,
): EngineOutcome {
  try {
    return listRanges(
      archiveSizeBytes,
      new Float64Array(offsets),
      bytes,
      limits.maxEntries,
      limits.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES,
      limits.maxDecodedHeaderBytes ?? DEFAULT_MAX_DECODED_HEADER_BYTES,
      limits.maxDictionaryBytes ?? DEFAULT_MAX_DICTIONARY_BYTES,
    ) as EngineOutcome;
  } catch (thrown) {
    throw wrapEngineError(thrown);
  }
}

/**
 * List a 7z over ranged reads, fetching only the header bytes.
 *
 * `read` is called at most three times and never asked for more than `maxHeaderBytes` at once, so
 * this costs the same on a multi-gigabyte archive as on a small one. A `read` that returns fewer
 * bytes than asked for ends the listing as `malformed` rather than being worked around — a short
 * range means the object is not what its own header says it is.
 *
 * Throws `SevenZipListingError`; see its `code`.
 */
export async function readSevenZipListing(
  archiveSizeBytes: number,
  read: ArchiveRangeReader,
  limits: SevenZipListingLimits,
): Promise<SevenZipListing> {
  await ensureReady();

  const offsets: number[] = [];
  const bytes: Uint8Array[] = [];
  for (let request = 0; request <= MAX_RANGE_REQUESTS; request += 1) {
    const outcome = callEngine(archiveSizeBytes, offsets, bytes, limits);
    if (outcome.status === "listing") {
      return { entries: outcome.entries.map(toEntry), truncated: outcome.truncated };
    }
    if (request === MAX_RANGE_REQUESTS) break;
    const fetched = await read(outcome.offset, outcome.length);
    if (fetched.byteLength < outcome.length) throw new SevenZipListingError("malformed");
    offsets.push(outcome.offset);
    bytes.push(fetched);
  }
  throw new SevenZipListingError("malformed");
}

/**
 * List a 7z already held whole in memory. Prefer `readSevenZipListing` against a stored object —
 * this reads the archive into memory to answer a question that needs a few kilobytes of it.
 */
export async function listSevenZipBytes(
  bytes: Uint8Array,
  limits: SevenZipListingLimits,
): Promise<SevenZipListing> {
  await ensureReady();
  const outcome = callEngine(bytes.byteLength, [0], [bytes], limits);
  if (outcome.status !== "listing") throw new SevenZipListingError("malformed");
  return { entries: outcome.entries.map(toEntry), truncated: outcome.truncated };
}

/** The ceilings an extraction refuses to work above, on top of the header ceilings a listing sets. */
export interface SevenZipExtractionLimits extends SevenZipListingLimits {
  /** Largest a single member may unpack to. */
  readonly maxMemberBytes: number;
  /**
   * Largest a BLOCK may unpack to. A 7z packs members into blocks, and a solid block is one
   * compressed stream over several members, so reaching the fourth member of one costs decoding the
   * three before it. A caller bounding only what it keeps would be bounding the wrong number:
   * default 1 GiB.
   */
  readonly maxBlockBytes?: number;
}

const DEFAULT_MAX_BLOCK_BYTES = 1024 * 1024 * 1024;

type ExtractOutcome =
  | { status: "member"; bytes: Uint8Array }
  | { status: "needRange"; offset: number; length: number };

/**
 * A listing needs at most three ranges; extraction needs those plus the one block its member lives
 * in. A fifth request means the engine asked for a range it had not named, which is a refusal.
 */
const MAX_EXTRACT_RANGE_REQUESTS = 4;

/**
 * Take one member's content out of a 7z over ranged reads.
 *
 * `memberIndex` is the member's position in the listing `readSevenZipListing` produced: both halves
 * read the same header, so an index from one addresses the same member in the other.
 *
 * `read` is called at most four times and never asked for the whole archive, so a member comes out
 * of a multi-gigabyte production for the cost of its own block rather than the object.
 *
 * Throws `SevenZipListingError`; branch on its `code`, never on the message.
 */
export async function readSevenZipMember(
  archiveSizeBytes: number,
  read: ArchiveRangeReader,
  memberIndex: number,
  limits: SevenZipExtractionLimits,
): Promise<Uint8Array> {
  await ensureReady();

  const offsets: number[] = [];
  const bytes: Uint8Array[] = [];
  for (let request = 0; request <= MAX_EXTRACT_RANGE_REQUESTS; request += 1) {
    let outcome: ExtractOutcome;
    try {
      outcome = extractRanges(
        archiveSizeBytes,
        new Float64Array(offsets),
        bytes,
        memberIndex,
        limits.maxMemberBytes,
        limits.maxBlockBytes ?? DEFAULT_MAX_BLOCK_BYTES,
        limits.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES,
        limits.maxDecodedHeaderBytes ?? DEFAULT_MAX_DECODED_HEADER_BYTES,
        limits.maxDictionaryBytes ?? DEFAULT_MAX_DICTIONARY_BYTES,
      ) as ExtractOutcome;
    } catch (thrown) {
      throw wrapEngineError(thrown);
    }
    if (outcome.status === "member") return outcome.bytes;
    if (request === MAX_EXTRACT_RANGE_REQUESTS) break;
    const fetched = await read(outcome.offset, outcome.length);
    // A short range means the object is not what its own header says it is, which is the same fact
    // a bad checksum is — never something to work around by asking again.
    if (fetched.byteLength < outcome.length) throw new SevenZipListingError("malformed");
    offsets.push(outcome.offset);
    bytes.push(fetched);
  }
  throw new SevenZipListingError("malformed");
}
