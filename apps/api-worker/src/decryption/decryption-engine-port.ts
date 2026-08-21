// The port the decryption and recovery routes read an uploaded file's encryption header through.
//
// The engine that does the reading is a Rust Container owned by apps/recovery-worker; this worker
// reaches it over the RECOVERY_SERVICE service binding and holds no copy of it. That is the whole
// point of the port: parsing untrusted, privileged bytes is Container work, and keeping the engine
// out of this Worker keeps its bundle free of the WebAssembly build.
//
// The password-decrypt operation is deliberately NOT on this port. It takes the file's own
// password, and the port's job is reading a header, not carrying a key to another process.

/** The three encrypted-file formats the engine can read. */
export type EncryptedFormat = "pdf" | "zip" | "ooxml";

/**
 * Whether a recovery search for this hash fits the Cloudflare CPU budget or needs GPU hardware.
 * Classified from the hashcat mode by the same engine that extracted it, so the tier and the hash
 * can never disagree about what was read.
 */
export type RecoveryTier = "cfCapable" | "gpuRequired";

/** What the engine reads out of an encrypted file's header. Carries no file content. */
export interface ExtractedRecoveryHash {
  format: EncryptedFormat;
  /** Hashcat-compatible hash string. */
  hash: string;
  /** Hashcat mode number corresponding to `format` and the encryption variant. */
  hashcatMode: number;
  tier: RecoveryTier;
}

/** Stable codes for a file the engine read and could get no hash out of. */
export type HashExtractionRefusalCode = "notEncrypted" | "unsupported" | "malformed";

/**
 * The engine read the bytes and there is no recovery hash in them. This is a VERDICT about the
 * member's file — it is not encrypted, the variant is not supported, or the container is damaged —
 * so a route answers it with a 400 the member can act on. Branch on `.code`, never on `.message`.
 */
export class HashExtractionRefusedError extends Error {
  public readonly code: HashExtractionRefusalCode;

  constructor(code: HashExtractionRefusalCode) {
    super(code);
    this.name = "HashExtractionRefusedError";
    this.code = code;
  }
}

/**
 * No engine is wired into this deployment at all — the service binding is absent. Not a verdict
 * about anything: no file was read. A route answers it with a retryable 503 and no Error ID,
 * because a member asking about their own file must not be sent to support over an engine that was
 * never deployed.
 */
export class DecryptionEngineUnavailableError extends Error {
  constructor() {
    super("decryption-engine-unavailable");
    this.name = "DecryptionEngineUnavailableError";
  }
}

/**
 * The engine is wired but could not answer — a placeholder worker, a Container that is not up, a
 * wedged request, or a reply this worker cannot parse. Also not a verdict, and answered the same
 * way: a retryable 503, never a 500 with an Error ID and never a refusal blamed on the file.
 */
export class DecryptionEngineFaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionEngineFaultError";
  }
}

export interface DecryptionEnginePort {
  /**
   * Read the encryption header of `bytes` and return the recovery hash and its tier.
   *
   * Throws `HashExtractionRefusedError` when the engine answered and the file yields no hash,
   * `DecryptionEngineFaultError` when a wired engine could not answer, and
   * `DecryptionEngineUnavailableError` when no engine is wired. The three are distinct on purpose:
   * only the first says anything about the file.
   */
  extractRecoveryHash(bytes: Uint8Array): Promise<ExtractedRecoveryHash>;
}

/**
 * The no-engine port: the RECOVERY_SERVICE binding is absent, so every read honestly reports that
 * this deployment has no engine rather than guessing at an answer. Mirrors resolveScanPort's
 * engine-less fallback and resolveSealPort's not-configured adapter.
 */
export const engineUnavailablePort: DecryptionEnginePort = {
  extractRecoveryHash(): Promise<ExtractedRecoveryHash> {
    return Promise.reject(new DecryptionEngineUnavailableError());
  },
};
