// The port the decryption and recovery routes reach the encryption engine through.
//
// The engine is a Rust Container owned by apps/recovery-worker; this worker reaches it over the
// RECOVERY_SERVICE service binding and holds no copy of it. That is the whole point of the port:
// parsing untrusted, privileged bytes is Container work, and keeping the engine out of this Worker
// keeps its bundle free of the WebAssembly build.
//
// TWO OPERATIONS, AND THE SECOND ONE CARRIES A SECRET. Reading a header needs no key and is
// unremarkable. Decrypting takes the file's own password, so `unlockWithPassword` puts a password a
// member typed onto a service binding into a Container that is long-lived, shared across firms, and
// whose other job is running password searches. The owner weighed that and accepted it to complete
// the removal of the WebAssembly build from this Worker. The consequence is a working rule for
// everything downstream of this interface, in this file and in every implementation of it:
//
//   THE PASSWORD IS NOT LOGGABLE, NOT COUNTABLE, AND NOT DIMENSIONABLE. It appears in no log line,
//   no telemetry dimension, no metric label, no error message, no URL, no header, and no retry
//   buffer. It is a parameter and a request body and nothing else. An implementation that needs to
//   describe a failure describes the failure, never the input.
//
// This is the same discipline the recovery search already runs on for a RECOVERED password
// (recovery/recovery-types.ts, recovery/recovery-coordinator.ts): surfaced once to the member who
// asked, held only as long as the retrieval window, and never written to a log or an audit row.

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

/** What the engine returns from a successful decrypt. */
export interface UnlockedFile {
  format: EncryptedFormat;
  /**
   * The plaintext, base64-encoded — the encoding the engine produced and the route answers with,
   * so a whole document is not decoded and re-encoded to move it one hop.
   */
  decryptedBase64: string;
  /** The name the encrypted container carried for its payload, where it carried one. */
  filenameHint: string | null;
}

/**
 * Stable codes for a decrypt the engine ran and could get no plaintext out of. `wrongPassword` is
 * the one this set adds over hash extraction, and it is a verdict like the others: the engine
 * answered, and the answer is that the supplied password does not open this file.
 */
export type UnlockRefusalCode = "wrongPassword" | "notEncrypted" | "unsupported" | "malformed";

/**
 * The engine read the bytes and produced no plaintext. A VERDICT about what the member submitted —
 * the password is wrong, the file is not encrypted, the variant is not supported, or the container
 * is damaged — so a route answers it with a 400 the member can act on. Branch on `.code`, never on
 * `.message`.
 *
 * The password is not on this error and must never be put on it. `wrongPassword` says the decrypt
 * failed; which string failed is not information this platform keeps.
 */
export class UnlockRefusedError extends Error {
  public readonly code: UnlockRefusalCode;

  constructor(code: UnlockRefusalCode) {
    super(code);
    this.name = "UnlockRefusedError";
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

  /**
   * Decrypt `bytes` with `password` and return the plaintext.
   *
   * `password` is the file's own password as the member typed it. It goes into the request body and
   * nowhere else: not a log, not a counter dimension, not an error message, not the URL. Read the
   * rule at the top of this file before implementing or calling this.
   *
   * Throws `UnlockRefusedError` when the engine answered and the file did not open,
   * `DecryptionEngineFaultError` when a wired engine could not answer, and
   * `DecryptionEngineUnavailableError` when no engine is wired. The three are distinct on purpose:
   * only the first says anything about what was submitted.
   */
  unlockWithPassword(bytes: Uint8Array, password: string): Promise<UnlockedFile>;
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
  unlockWithPassword(): Promise<UnlockedFile> {
    return Promise.reject(new DecryptionEngineUnavailableError());
  },
};
