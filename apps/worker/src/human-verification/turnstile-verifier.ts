// The Cloudflare Turnstile adapter for the human-verification port: one server-side POST of the
// client's token plus this deployment's secret to the siteverify endpoint, with the caller's address.
//
// Contract this is built against (verified against the current Turnstile server-side validation
// documentation rather than recalled):
//   - POST https://challenges.cloudflare.com/turnstile/v0/siteverify, accepting either
//     application/json or form encoding, always answering JSON.
//   - Request: `secret` and `response` required; `remoteip` and `idempotency_key` optional.
//   - Response: `success` plus an `error-codes` array; a pass also carries `challenge_ts`,
//     `hostname`, `action`, `cdata` and `metadata`.
//   - A token lives 300 seconds and validates EXACTLY ONCE. A second validation of the same token
//     comes back `timeout-or-duplicate`, which is the same code an expired token gets.
//   - `idempotency_key` exists so a RETRY of a validation is not counted as that second use. It must
//     be fresh per token — reusing one across tokens serves the first token's cached answer back for
//     a different token, which reads as a bogus verdict.
//
// The single-use rule is what forces the retry design here. A bare `fetch` retry without the key
// would spend the caller's token on the attempt that failed and then be told the token is duplicate,
// turning one flaky outbound call into a refusal aimed at a person who did nothing wrong.

import type {
  HumanVerificationOutcome,
  HumanVerificationPort,
  HumanVerificationRequest,
} from "./human-verification-port.ts";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// This call sits on an anonymous request path a person is waiting on, so it is bounded rather than
// left to the platform's own timeout. Two attempts inside this budget is still well under what a
// visitor reads as a hung form.
const SITEVERIFY_TIMEOUT_MILLISECONDS = 4_000;

// One retry, and only for a call that did not produce a verdict (a network failure, a timeout, a 5xx).
// A verdict — pass or fail — is never retried: it is the answer.
const SITEVERIFY_ATTEMPTS = 2;

// Error codes that are facts about the CALLER's token.
const TOKEN_REJECTED_CODES = new Set([
  "invalid-input-response",
  "missing-input-response",
  "bad-request",
]);
const TOKEN_SPENT_CODE = "timeout-or-duplicate";

// Error codes that are facts about OUR configuration. Reported as an absence, never as a refusal:
// a wrong secret is our mistake, and charging a visitor for it would be both unjust and invisible.
const CREDENTIAL_REJECTED_CODES = new Set(["missing-input-secret", "invalid-input-secret"]);

interface SiteverifyBody {
  readonly success?: unknown;
  readonly "error-codes"?: unknown;
}

function errorCodesOf(body: SiteverifyBody): string[] {
  const codes = body["error-codes"];
  return Array.isArray(codes)
    ? codes.filter((code): code is string => typeof code === "string")
    : [];
}

function outcomeFor(body: SiteverifyBody): HumanVerificationOutcome {
  if (body.success === true) return { decision: "verified" };

  const codes = errorCodesOf(body);
  if (codes.some((code) => CREDENTIAL_REJECTED_CODES.has(code))) {
    return { decision: "unavailable", reason: "verifier-credential-rejected" };
  }
  if (codes.includes(TOKEN_SPENT_CODE)) {
    return { decision: "refused", reason: "token-already-spent" };
  }
  if (codes.some((code) => TOKEN_REJECTED_CODES.has(code))) {
    return { decision: "refused", reason: "token-rejected" };
  }
  // `internal-error`, and anything the API grows that this adapter has never seen. Deliberately an
  // absence rather than a refusal: an unrecognized code is not evidence against the caller, and
  // reading it as one would let any future response shape become a wall in front of the front door.
  return { decision: "unavailable", reason: "verifier-unreachable" };
}

/**
 * Build the Turnstile-backed verifier for a deployment that has a secret. Absence of the secret is
 * resolved one level up (`human-verification-wiring.ts`) — this adapter is only ever constructed
 * with one, so it has no not-configured branch to get wrong.
 */
export function createTurnstileVerifier(
  secret: string,
  fetchImplementation: typeof fetch = fetch,
): HumanVerificationPort {
  return {
    async verify(request: HumanVerificationRequest): Promise<HumanVerificationOutcome> {
      // No round trip for a caller who presented nothing: the verifier would answer
      // `missing-input-response`, and asking it costs a call that an unauthenticated flood would be
      // delighted to make us pay for.
      if (request.token === null || request.token === "") {
        return { decision: "refused", reason: "token-missing" };
      }

      // Fresh per token, per the API's own rule, and generated rather than derived from the token —
      // a key derived from the token would be a second copy of the credential travelling in a second
      // field, for no gain.
      const idempotencyKey = crypto.randomUUID();

      let lastOutcome: HumanVerificationOutcome = {
        decision: "unavailable",
        reason: "verifier-unreachable",
      };
      for (let attempt = 0; attempt < SITEVERIFY_ATTEMPTS; attempt += 1) {
        let response: Response;
        try {
          response = await fetchImplementation(SITEVERIFY_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              secret,
              response: request.token,
              ...(request.callerAddress !== null && { remoteip: request.callerAddress }),
              idempotency_key: idempotencyKey,
            }),
            signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MILLISECONDS),
          });
        } catch {
          // A transport failure or a timeout. The thrown value is deliberately not inspected or
          // carried anywhere: the request body it describes holds both the secret and the token.
          continue;
        }

        if (!response.ok) continue;

        let body: SiteverifyBody;
        try {
          body = (await response.json()) as SiteverifyBody;
        } catch {
          continue;
        }

        lastOutcome = outcomeFor(body);
        // A verdict is final, and so is a rejected credential — retrying a wrong secret only spends
        // the caller's patience. Only "did not answer" is worth another attempt, which is what the
        // shared idempotency key above makes safe.
        const worthRetrying =
          lastOutcome.decision === "unavailable" && lastOutcome.reason === "verifier-unreachable";
        if (!worthRetrying) return lastOutcome;
      }
      return lastOutcome;
    },
  };
}
