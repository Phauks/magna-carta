// The port the capture consumer, attachment extraction, and the inspector route read a message
// through.
//
// The engine that does the reading is the email-core WebAssembly build running in
// apps/email-worker — the worker Cloudflare Email Routing already delivers to, and therefore the
// natural home for the thing that reads mail. This worker reaches it over the EMAIL_SERVICE binding
// and holds no copy of it, which is what keeps its bundle free of the WebAssembly build.

import type { ParsedMessage } from "@magna-carta/email-filing/message";

/** Stable codes for a message the engine read and could make nothing of. */
export type MessageRefusalCode = "malformed" | "unsupported" | "limitExceeded" | "partNotFound";

/**
 * The engine read the bytes and there is no message (or no such part) in them. This is a VERDICT
 * about what was submitted, so a route answers it with a 4xx the member can act on and the capture
 * consumer records it rather than retrying. Branch on `.code`, never on `.message`.
 */
export class MessageRefusedError extends Error {
  public readonly code: MessageRefusalCode;

  constructor(code: MessageRefusalCode) {
    super(code);
    this.name = "MessageRefusedError";
    this.code = code;
  }
}

/**
 * No engine is wired into this deployment at all — the EMAIL_SERVICE binding is absent. Not a
 * verdict about anything: no message was read.
 *
 * **The two callers answer this differently and that difference is the whole point.** A route is a
 * request path and answers a retryable 503 with no Error ID. The capture consumer is a QUEUE, where
 * a throw is a redelivery: an absent engine never becomes reachable by being asked again, so
 * retrying it would burn a message's attempts against a condition no redelivery changes and
 * dead-letter every capture in the firm's mail flow. It is a terminal, acked outcome that records
 * why instead.
 */
export class EmailEngineUnavailableError extends Error {
  constructor() {
    super("email-engine-unavailable");
    this.name = "EmailEngineUnavailableError";
  }
}

/**
 * The engine is wired but could not answer — a worker that is not deployed yet, a wedged request,
 * or a reply this worker cannot parse. Not a verdict either, but unlike the absent case a
 * redelivery genuinely can fix it, so the consumer RETRIES this one and a route answers a retryable
 * 503.
 */
export class EmailEngineFaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailEngineFaultError";
  }
}

export interface EmailEnginePort {
  /**
   * Parse one `.eml` or `.msg` into its described form: headers, participants, bodies, and part
   * DESCRIPTORS. No attachment bytes are materialised.
   *
   * Throws `MessageRefusedError` when the engine answered and the bytes are not a message it can
   * read, `EmailEngineFaultError` when a wired engine could not answer, and
   * `EmailEngineUnavailableError` when no engine is wired.
   */
  parseMessage(bytes: Uint8Array): Promise<ParsedMessage>;

  /**
   * Materialise one part's bytes by its position in the parse's `parts` array.
   *
   * Throws the same three, with `partNotFound` and `limitExceeded` as the refusal codes that matter
   * here: the first says the index names no part of this message, the second that the part is past
   * the engine's decode cap.
   */
  extractPart(bytes: Uint8Array, partIndex: number): Promise<Uint8Array>;
}

/**
 * The no-engine port: the EMAIL_SERVICE binding is absent, so every read honestly reports that this
 * deployment has no engine rather than guessing at an answer. Mirrors resolveScanPort's engine-less
 * fallback and the decryption port's engineUnavailablePort.
 */
export const engineUnavailablePort: EmailEnginePort = {
  parseMessage(): Promise<ParsedMessage> {
    return Promise.reject(new EmailEngineUnavailableError());
  },
  extractPart(): Promise<Uint8Array> {
    return Promise.reject(new EmailEngineUnavailableError());
  },
};
