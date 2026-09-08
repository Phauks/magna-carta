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
import init, { listRanges } from "./pkg/seven_zip_core.js";

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
 * Thrown when the engine refuses an archive. Branch on `.code` — never string-match `.message`.
 *
 * `headerEncrypted` is the one worth handling separately: the archive is intact and its members are
 * there, but whoever packed it chose to encrypt the file list too, so the names cannot be shown
 * without the password.
 */
export class SevenZipListingError extends Error {
  public readonly code: SevenZipListingErrorCode;

  constructor(code: SevenZipListingErrorCode) {
    super(code);
    this.name = "SevenZipListingError";
    this.code = code;
  }
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<SevenZipListingErrorCode>([
  "notSevenZip",
  "unsupportedVersion",
  "headerEncrypted",
  "tooLarge",
  "unsupportedCoder",
  "malformed",
  "rangeMismatch",
]);

function wrapEngineError(thrown: unknown): SevenZipListingError {
  if (thrown instanceof Error && KNOWN_ERROR_CODES.has(thrown.message)) {
    return new SevenZipListingError(thrown.message as SevenZipListingErrorCode);
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
