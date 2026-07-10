import init, {
  parse as wasmParse,
  parseMbox as wasmParseMbox,
  extractPart as wasmExtractPart,
} from "./pkg/email_core.js";

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

/** Stable error codes returned by the parse engine. */
export type EmailErrorCode = "malformed" | "unsupported" | "limitExceeded" | "partNotFound";

/**
 * Thrown by `parseMessage`, `parseMailbox`, and `extractPart` when the engine
 * reports a stable failure code. Branch on `.code` — never string-match `.message`.
 */
export class EmailError extends Error {
  public readonly code: EmailErrorCode;

  constructor(code: EmailErrorCode) {
    super(code);
    this.name = "EmailError";
    this.code = code;
  }
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<EmailErrorCode>([
  "malformed",
  "unsupported",
  "limitExceeded",
  "partNotFound",
]);

function wrapEngineError(thrown: unknown): EmailError {
  if (thrown instanceof Error && KNOWN_ERROR_CODES.has(thrown.message)) {
    return new EmailError(thrown.message as EmailErrorCode);
  }
  return new EmailError("malformed");
}

/** Which lane produced a record. */
export type SourceFormat = "eml" | "msg" | "mboxMember";

/**
 * A message identifier that remembers where it came from. A `.msg` file carries
 * RFC 5322 headers only when they survived export, which is frequently dropped —
 * an identifier synthesized from MAPI properties is not the same bytes another
 * recipient's `.eml` copy carries, so `provenance` must never be collapsed away.
 */
export interface MessageIdentifier {
  value: string | null;
  provenance: "header" | "mapi" | "absent";
}

export interface Address {
  displayName: string | null;
  address: string | null;
}

export interface RawHeader {
  name: string;
  value: string;
}

/**
 * Where a part's bytes actually live, which differs by container: a contiguous
 * span of the original input for `.eml`/mbox parts, or a named compound-file
 * stream for `.msg` parts. A discriminated union rather than a flattened range,
 * so a caller that only handles one kind cannot mistake the other for it.
 */
export type PartLocator =
  | { kind: "inputRange"; start: number; end: number }
  | { kind: "mapiStream"; name: string };

/** A part is described, never materialized, by `parseMessage`; `extractPart` turns one descriptor into bytes on demand. */
export interface PartDescriptor {
  filename: string | null;
  mediaType: string | null;
  contentIdentifier: string | null;
  disposition: "attachment" | "inline";
  size: number;
  locator: PartLocator;
  isEmbeddedMessage: boolean;
}

/** Authenticity evidence, captured verbatim with no verdict attached. */
export interface Integrity {
  dkimSignatures: string[];
  authenticationResults: string[];
  receivedChain: string[];
}

export interface ParsedMessage {
  messageIdentifier: MessageIdentifier;
  inReplyTo: string | null;
  references: string[];
  subject: string | null;
  dateRaw: string | null;
  from: Address[];
  to: Address[];
  cc: Address[];
  bcc: Address[];
  rawHeaders: RawHeader[];
  textBodies: string[];
  htmlBodies: string[];
  rtfBody: string | null;
  parts: PartDescriptor[];
  integrity: Integrity;
  sourceFormat: SourceFormat;
  referencesRemoteContent: boolean;
}

/** One mbox member that failed to parse. `byteStart`/`byteEnd` span the member inside the input buffer. */
export interface MemberFailure {
  index: number;
  byteStart: number;
  byteEnd: number;
  error: EmailErrorCode;
}

/**
 * The result of parsing an mbox. Framing is total — a malformed member never
 * discards a well-formed one — so failures are reported as data alongside the
 * messages that did parse, rather than aborting the whole file.
 */
export interface MboxParseOutcome {
  messages: ParsedMessage[];
  failures: MemberFailure[];
}

/**
 * Parse one single-message email (`.eml` or `.msg`).
 *
 * Throws `EmailError` with the relevant code on failure: `"malformed"`,
 * `"unsupported"`, or `"limitExceeded"`.
 */
export async function parseMessage(bytes: Uint8Array): Promise<ParsedMessage> {
  await ensureReady();
  try {
    return wasmParse(bytes) as unknown as ParsedMessage;
  } catch (thrown) {
    throw wrapEngineError(thrown);
  }
}

/**
 * Parse an mbox, which is many messages, not one. A malformed member never
 * discards a well-formed one, so this does not throw on a member failure —
 * failures come back as data in the returned outcome. It only rejects on a
 * genuine engine error.
 */
export async function parseMailbox(bytes: Uint8Array): Promise<MboxParseOutcome> {
  await ensureReady();
  try {
    return wasmParseMbox(bytes) as unknown as MboxParseOutcome;
  } catch (thrown) {
    throw wrapEngineError(thrown);
  }
}

/**
 * Materialize one part's bytes by its position in `message.parts`.
 *
 * Throws `EmailError` with code `"partNotFound"` when the index does not match
 * any part this input produced, or `"limitExceeded"` when the part exceeds the
 * engine's decode cap.
 */
export async function extractPart(bytes: Uint8Array, partIndex: number): Promise<Uint8Array> {
  await ensureReady();
  try {
    return wasmExtractPart(bytes, partIndex);
  } catch (thrown) {
    throw wrapEngineError(thrown);
  }
}
