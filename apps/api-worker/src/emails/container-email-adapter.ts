import { z } from "@hono/zod-openapi";
import {
  EmailEngineFaultError,
  MessageRefusedError,
  type EmailEnginePort,
} from "./email-engine-port.ts";
import type { ParsedMessage } from "@magna-carta/email-filing/message";

// The email worker's HTTP surface, narrowed to the two calls this adapter makes. The EMAIL_SERVICE
// Fetcher binding satisfies it; tests pass a fake so the adapter is exercised without a real email
// worker running in the pool.
export interface EmailEngineFetcher {
  fetch(request: Request): Promise<Response>;
}

// The engine's refusal reply — a stable code naming what is wrong with the MESSAGE. Validated
// rather than trusted: an unrecognised code is the far side disagreeing with this adapter about the
// vocabulary, which is a fault rather than a refusal read out to a member.
const refusalSchema = z.object({
  code: z.enum(["malformed", "unsupported", "limitExceeded", "partNotFound"]),
});

// The query parameter naming which part to materialise. Pinned identically in
// apps/email-worker/src/parse-service.ts — a Worker cannot import from another Worker, so change
// one and change both in the same commit or every extraction becomes a 400.
const PART_INDEX_PARAMETER = "index";

// The worker-side ceiling on a single engine call. The engine parses a message (or copies one part
// out of it) and returns; it does no I/O of its own, so this sits well above any real parse and
// exists only to turn a wedged worker into a retryable throw rather than a request that hangs — on
// the member's connection for the inspector route, or on a queue-consumer invocation for capture.
const EMAIL_ENGINE_REQUEST_TIMEOUT_MS = 30 * 1000;

// A ParsedMessage is a large, deeply-nested shape whose field-by-field schema already exists as the
// inspector route's response contract. Re-declaring it here would be a second place for it to
// drift, so the adapter validates the ENVELOPE — a JSON object came back, not an error page or a
// truncated body — and lets the shared type stand for the rest. A far side that answers 200 with a
// body of the wrong shape is the email worker being replaced by something else, which the version
// pinning of a service binding already rules out; a far side that answers with no JSON at all is
// the case that actually happens, and this catches it.
const parsedMessageEnvelopeSchema = z.object({ parts: z.array(z.unknown()) }).passthrough();

/**
 * Builds an EmailEnginePort over apps/email-worker. It POSTs the raw message bytes and maps the
 * reply by status, which is the contract both sides pin:
 *
 * - **200** — the parse, or the part's bytes.
 * - **422** — `MessageRefusedError`, a verdict about the submitted message.
 * - **5xx**, a timeout, a 4xx outside the contract, or a body that does not parse —
 *   `EmailEngineFaultError`. A wired engine that cannot answer is not a fact about somebody's mail
 *   and must never be reported as one.
 *
 * `requestTimeoutMs` overrides the wedged-worker backstop (a test passes a small value to drive the
 * abort path).
 */
export function containerEmailAdapter(
  service: EmailEngineFetcher,
  requestTimeoutMs: number = EMAIL_ENGINE_REQUEST_TIMEOUT_MS,
): EmailEnginePort {
  async function call(url: string, bytes: Uint8Array, operation: string): Promise<Response> {
    let response: Response;
    try {
      response = await service.fetch(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: bytes,
          // A wedged worker becomes a retryable throw (AbortError) here rather than a hang.
          signal: AbortSignal.timeout(requestTimeoutMs),
        }),
      );
    } catch (error) {
      // A transport failure or the abort above. Named as a fault so the caller retries or answers
      // 503; the message carries the failure only, never any part of the submitted message.
      throw new EmailEngineFaultError(
        `email service did not answer the ${operation}: ${error instanceof Error ? error.name : "unknown error"}`,
      );
    }

    if (response.status === 422) {
      const refusal = refusalSchema.safeParse(await response.json().catch(() => null));
      if (!refusal.success) {
        throw new EmailEngineFaultError(
          `email service returned an unreadable refusal from the ${operation}`,
        );
      }
      throw new MessageRefusedError(refusal.data.code);
    }
    if (response.status !== 200) {
      // A 5xx from a worker that is down, or a 4xx from a service that disagrees with this adapter
      // about the request. Neither is a property of the message, so both surface as the same
      // retryable fault rather than as a verdict a member would read as their mail being broken.
      throw new EmailEngineFaultError(
        `email service returned status ${response.status} from the ${operation}`,
      );
    }
    return response;
  }

  return {
    async parseMessage(bytes: Uint8Array): Promise<ParsedMessage> {
      const response = await call("http://email/parse", bytes, "parse");
      const parsed = parsedMessageEnvelopeSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new EmailEngineFaultError("email service returned an unreadable parse");
      }
      return parsed.data as unknown as ParsedMessage;
    },

    async extractPart(bytes: Uint8Array, partIndex: number): Promise<Uint8Array> {
      const response = await call(
        `http://email/extract-part?${PART_INDEX_PARAMETER}=${partIndex}`,
        bytes,
        "part extraction",
      );
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
