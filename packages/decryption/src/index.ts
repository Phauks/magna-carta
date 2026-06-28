import init, {
  detect,
  extractHash as wasmExtractHash,
  stripWithKey as wasmStripWithKey,
  verifyGuess as wasmVerifyGuess,
} from "./pkg/decryption_core.js";

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

/** The three encrypted-file formats this package can handle. */
export type EncryptedFormat = "pdf" | "zip" | "ooxml";

/** Stable error codes returned by the decryption engine. */
export type DecryptionErrorCode = "wrongPassword" | "notEncrypted" | "unsupported" | "malformed";

/**
 * Thrown by `stripWithKey` and `extractHash` when the engine reports a stable
 * failure code. Branch on `.code` — never string-match `.message`.
 */
export class DecryptionError extends Error {
  public readonly code: DecryptionErrorCode;

  constructor(code: DecryptionErrorCode) {
    super(code);
    this.name = "DecryptionError";
    this.code = code;
  }
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<DecryptionErrorCode>([
  "wrongPassword",
  "notEncrypted",
  "unsupported",
  "malformed",
]);

function wrapEngineError(thrown: unknown): DecryptionError {
  if (thrown instanceof Error && KNOWN_ERROR_CODES.has(thrown.message)) {
    return new DecryptionError(thrown.message as DecryptionErrorCode);
  }
  return new DecryptionError("malformed");
}

/** Result of a successful decryption. */
export interface StripResult {
  bytes: Uint8Array;
  /** Original filename, when the container encodes one (e.g. OOXML). */
  filenameHint?: string;
}

/** Hash and metadata needed to run a dictionary attack offline. */
export interface ExtractHashResult {
  format: EncryptedFormat;
  /** Hashcat-compatible hash string. */
  hash: string;
  /** Hashcat mode number corresponding to `format` and the encryption variant. */
  hashcatMode: number;
}

/**
 * Detect the encrypted-file format from magic bytes.
 * Returns `"pdf"`, `"zip"`, or `"ooxml"`, or `null` when unrecognised.
 */
export async function detectFormat(bytes: Uint8Array): Promise<EncryptedFormat | null> {
  await ensureReady();
  const result = detect(bytes);
  if (result === undefined || result === null) return null;
  return result as EncryptedFormat;
}

/**
 * Decrypt a password-protected file.
 *
 * Throws `DecryptionError` with the relevant code on failure:
 * `"wrongPassword"`, `"notEncrypted"`, `"unsupported"`, or `"malformed"`.
 */
export async function stripWithKey(bytes: Uint8Array, password: string): Promise<StripResult> {
  await ensureReady();
  try {
    const raw = wasmStripWithKey(bytes, password) as { bytes: Uint8Array; filenameHint?: string };
    return { bytes: raw.bytes, filenameHint: raw.filenameHint };
  } catch (thrown) {
    throw wrapEngineError(thrown);
  }
}

/**
 * Extract a hashcat-compatible hash from an encrypted file for offline recovery.
 *
 * Throws `DecryptionError` with the relevant code on failure:
 * `"notEncrypted"`, `"unsupported"`, or `"malformed"`.
 */
export async function extractHash(bytes: Uint8Array): Promise<ExtractHashResult> {
  await ensureReady();
  try {
    const raw = wasmExtractHash(bytes) as { format: string; hash: string; hashcatMode: number };
    return { format: raw.format as EncryptedFormat, hash: raw.hash, hashcatMode: raw.hashcatMode };
  } catch (thrown) {
    throw wrapEngineError(thrown);
  }
}

/**
 * Test a single candidate password against a pre-extracted hash without touching
 * the original file. Returns `false` on any parse failure or bad parameters.
 */
export async function verifyGuess(
  hash: string,
  format: EncryptedFormat,
  candidate: string,
): Promise<boolean> {
  await ensureReady();
  return wasmVerifyGuess(hash, format, candidate);
}
