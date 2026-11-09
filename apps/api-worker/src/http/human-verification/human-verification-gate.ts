// The gate a protected anonymous route puts in front of its own work: ask the verifier, and either
// hand back a problem to return or hand back `null` meaning "carry on".
//
// WHY A HELPER CALLED FROM THE HANDLER RATHER THAN ROUTE MIDDLEWARE. Route-specific middleware runs
// BEFORE the chokepoint (see chokepoint/register.ts), which means before the rate-limit gate — and a
// challenge check that runs ahead of rate limiting is an unmetered outbound call per request that
// anyone on the internet can make this deployment pay for. Called from the handler, the check sits
// where it belongs: after tenancy, idempotency and the IP-keyed limit have already had their say,
// so a flood is throttled before it reaches the verifier at all.
//
// WHAT EACH OUTCOME BECOMES, and why none of them is a 500:
//   - verified                     -> null. The request proceeds.
//   - refused                      -> 403. A verdict about the caller; the detail tells them to get
//                                    a fresh challenge, which is the only thing that helps.
//   - unavailable, not configured  -> the posture decides (wiring.ts). Either way it is COUNTED.
//   - unavailable, anything else   -> 503 with a retry window. The verifier is live and did not
//                                    answer, so the protection the owner deliberately switched on is
//                                    not in force — and passing the request anyway would mean an
//                                    attacker who can break one outbound call has turned the gate
//                                    off. A retryable refusal is the honest answer, and it is never
//                                    an Error ID for a fault the caller cannot act on.

import { z } from "@hono/zod-openapi";
import { authDenied } from "@magna-carta/telemetry/events";
import { humanVerificationDecided } from "@magna-carta/telemetry/metrics";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Context } from "hono";
import type { Bindings } from "../../bindings.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { problemJson, type ProblemResponse } from "../contracts/problem.ts";
import type { HumanVerificationPort } from "./human-verification-port.ts";
import {
  resolveHumanVerificationPort,
  resolveUnverifiedPosture,
  type UnverifiedPosture,
} from "./human-verification-wiring.ts";

/**
 * The request header a client presents its challenge solution in.
 *
 * A HEADER, NOT A BODY FIELD, and that is a compatibility decision rather than a taste one: the
 * bodies of these endpoints are published contract that shipped clients already build, and adding a
 * field to them would make every existing caller's request a different document. A header rides
 * alongside and is simply absent until a client mints one. Lowercase because Hono lowercases the
 * incoming header map and matches case-sensitively.
 */
export const HUMAN_VERIFICATION_TOKEN_HEADER = "x-human-verification-token";

// The contract fragment for `request.headers` on a protected anonymous route. OPTIONAL at the schema
// layer on purpose, exactly as the idempotency-key fragment is: whether a solution is REQUIRED is a
// deployment fact (is a verifier provisioned?), not a request-shape fact, and a required schema key
// would preempt the gate's own 403 with a generic 422 that tells the caller nothing about what to do.
// The length ceiling is a cheap guard against a header used as a body — a real solution is a few
// hundred characters and the published ceiling is well inside this.
const MAXIMUM_TOKEN_LENGTH = 4096;
export const humanVerificationTokenHeader = z.object({
  [HUMAN_VERIFICATION_TOKEN_HEADER]: z.string().min(1).max(MAXIMUM_TOKEN_LENGTH).optional(),
});

// Long enough for a transient verifier fault to clear, short enough that a person refreshing the
// page is not told to come back later than they will.
const VERIFIER_RETRY_AFTER_SECONDS = 30;

export interface HumanVerificationGateOptions {
  /** Overrides the verifier. Production resolves it from the environment; tests inject a fake. */
  readonly port?: HumanVerificationPort;
  /** Overrides the unconfigured posture, so a test can exercise the one this deployment does not use. */
  readonly posture?: UnverifiedPosture;
}

/**
 * Run the gate for the current request. Returns the problem the handler must return, or `null` when
 * the request may proceed. Every path through here records exactly one metric point, including the
 * ones that proceed — a gate that only reports when it stops something cannot tell you it has
 * stopped reporting.
 */
export async function enforceHumanVerification(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  options: HumanVerificationGateOptions = {},
): Promise<ProblemResponse<403> | ProblemResponse<503> | null> {
  const port = options.port ?? resolveHumanVerificationPort(c.env);
  const posture = options.posture ?? resolveUnverifiedPosture(c.env);
  const route = c.req.routePath;
  // Stashed by the telemetry middleware, which is installed ahead of everything. Optional for the
  // same reason every other guard treats it as optional: a missing logger loses the signal, it never
  // costs the request.
  const logger = c.get("logger");

  const outcome = await port.verify({
    token: c.req.header(HUMAN_VERIFICATION_TOKEN_HEADER) ?? null,
    // Cloudflare's own client-address header. Absent under the local test pool and in any runtime
    // that is not behind the edge, which the verifier treats as "judge on the token alone".
    callerAddress: c.req.header("cf-connecting-ip") ?? null,
  });

  const record = (recordedOutcome: string, recordedReason: string): void => {
    logger?.count(humanVerificationDecided.metricName, {
      route,
      outcome: recordedOutcome,
      reason: recordedReason,
    });
  };

  if (outcome.decision === "verified") {
    record("verified", "solved");
    return null;
  }

  const errorId = newErrorId();
  const correlationId = c.get("correlationId") ?? "";
  const deny = (cause: string): void => {
    logger?.log(
      authDenied({ correlationId, now: new Date().toISOString() }, { cause, route, errorId }),
    );
  };

  if (outcome.decision === "refused") {
    record("refused", outcome.reason);
    deny(`human-verification-${outcome.reason}`);
    return problemJson(c, {
      type: "human-verification-required",
      status: 403,
      title: "Human verification is required",
      // Deliberately one wording for all three refusals. Which of "you sent nothing", "that is not a
      // valid solution" and "that solution is already spent" applies is a distinction useful only to
      // somebody scripting against the endpoint; a person gets the one instruction that works.
      detail: "Complete the verification check and submit the form again.",
      errorId,
    });
  }

  if (outcome.reason === "verifier-not-configured") {
    if (posture === "fail-open") {
      // The endpoint serves, unprotected. This counter is the entire difference between that fact
      // being recorded and that fact being a checkbox in a runbook nobody re-reads.
      record("unenforced", outcome.reason);
      return null;
    }
    record("unavailable", outcome.reason);
    deny("human-verification-unavailable");
    return problemJson(c, {
      type: "service-unavailable",
      status: 503,
      title: "Verification is unavailable",
      detail: "This request cannot be verified right now. Try again shortly.",
      retryAfterSeconds: VERIFIER_RETRY_AFTER_SECONDS,
      errorId,
    });
  }

  record("unavailable", outcome.reason);
  deny("human-verification-unavailable");
  return problemJson(c, {
    type: "service-unavailable",
    status: 503,
    title: "Verification is unavailable",
    // The caller-facing wording never distinguishes "the verifier did not answer" from "the verifier
    // rejected our secret". The first is nothing they can act on and the second is a configuration
    // detail about this deployment; both are in the counter, where the operator will see them.
    detail: "This request cannot be verified right now. Try again shortly.",
    retryAfterSeconds: VERIFIER_RETRY_AFTER_SECONDS,
    errorId,
  });
}
