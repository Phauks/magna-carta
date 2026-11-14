// Content disarm: a copy of a document with everything that can act taken out, and a count of what
// that was. The engine is Rust (crates/disarm-core) compiled to WebAssembly; this module is the seam
// between it and the platform, and decides nothing itself.
//
// The original is never changed. A caller keeps it as the evidence it is and offers the copy beside
// it, named with `outputExtension` when the engine changed what kind of file it is (a .docm whose
// macros are gone is a .docx).
import init, { disarm as wasmDisarm, identify as wasmIdentify } from "./pkg/disarm_core.js";

let ready: Promise<unknown> | undefined;

/**
 * Load the engine once. In Node and Vitest pass the wasm bytes; in a Worker pass the pre-compiled
 * `WebAssembly.Module` the bundler provides through the package's wasm export entry; in a browser
 * pass nothing and the generated loader fetches it.
 */
export async function ensureReady(
  wasmInput?: Uint8Array | ArrayBuffer | WebAssembly.Module,
): Promise<void> {
  if (ready === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready = wasmInput !== undefined ? init({ module_or_path: wasmInput as any }) : init();
  }
  await ready;
}

/** The kinds of document the engine disarms, decided from the bytes, never the name. */
export type DisarmableKind =
  | "pdf"
  | "officePackage"
  | "rtf"
  | "jpeg"
  | "png"
  | "gif"
  | "tiff"
  | "bmp"
  | "webp";

/** One sort of thing a disarm removes or neutralizes. */
export type RemovalKind =
  | "script"
  | "automaticAction"
  | "externalAction"
  | "embeddedFile"
  | "embeddedObject"
  | "control"
  | "dynamicForm"
  | "activeContent"
  | "externalLink"
  | "dynamicField"
  | "customInterface"
  | "pictureMetadata"
  | "animationFlattened";

export interface Removal {
  readonly kind: RemovalKind;
  readonly count: number;
}

export interface DisarmedDocument {
  readonly bytes: Uint8Array;
  readonly kind: DisarmableKind;
  /** Lower case, no dot. `null` when the copy keeps the original's extension. */
  readonly outputExtension: string | null;
  /** Empty when the document carried nothing that acts, which is itself the finding. */
  readonly removals: readonly Removal[];
}

/** Why no copy was offered. */
export type DisarmErrorCode =
  | "unsupported"
  | "encrypted"
  | "limitExceeded"
  | "malformed"
  | "write"
  | "verificationFailed";

export class DisarmError extends Error {
  public readonly code: DisarmErrorCode;

  constructor(code: DisarmErrorCode) {
    super(code);
    this.name = "DisarmError";
    this.code = code;
  }
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<DisarmErrorCode>([
  "unsupported",
  "encrypted",
  "limitExceeded",
  "malformed",
  "write",
  "verificationFailed",
]);

function wrapEngineError(thrown: unknown): DisarmError {
  if (thrown instanceof Error && KNOWN_ERROR_CODES.has(thrown.message)) {
    return new DisarmError(thrown.message as DisarmErrorCode);
  }
  return new DisarmError("malformed");
}

/** What the engine would treat these bytes as, or null when it does not disarm them. */
export async function identifyDisarmable(bytes: Uint8Array): Promise<DisarmableKind | null> {
  await ensureReady();
  return (wasmIdentify(bytes) as DisarmableKind | undefined) ?? null;
}

/** Disarm a document. Rejects with a `DisarmError` when no copy can be offered. */
export async function disarmDocument(bytes: Uint8Array): Promise<DisarmedDocument> {
  await ensureReady();
  try {
    return wasmDisarm(bytes) as unknown as DisarmedDocument;
  } catch (thrown) {
    throw wrapEngineError(thrown);
  }
}
