// The human-verification seam: "is the caller of this anonymous endpoint a person?", asked of
// whatever verifier a deployment has been given, and answered with a typed outcome rather than a
// throw.
//
// THE ABSENCE IS A VALUE, NOT AN EXCEPTION. The verifier's credential is a deployment secret that
// may simply not exist — and a port that threw when it was missing would fail at construction of the
// composition root, which is where the entire not-configured path becomes unreachable and untestable
// (the same failure `apps/api-worker/src/plugins/secret-store.ts` exists to avoid for the per-firm
// credential store, and `conversions/conversion-engine.ts` for an undeployed engine). So an absent
// verifier resolves to `unavailable` with a reason the caller can act on, exactly as an unbuilt
// conversion engine resolves to a reason instead of a stack trace.
//
// THREE DECISIONS, NOT TWO, and only the first two are about the caller:
//   - `verified` / `refused` are verdicts ON THE CALLER: a person solved the challenge, or the token
//     they presented does not stand up.
//   - `unavailable` is a fact about US: nothing was asked, so nothing was learned about the caller.
//     Collapsing it into `refused` would turn our own outage into an accusation against a visitor
//     trying to sign up, and collapsing it into `verified` would fabricate a pass — which is how a
//     bot operator gets a green light by making one outbound call fail.
//
// THE TOKEN IS NEVER LOGGED, ANYWHERE. It is a bearer credential for one challenge solution: a token
// that reaches a log is a token an operator (or a log reader) can spend. Nothing in this module or
// its adapters puts it in an event, a counter dimension, an error message, or a URL — and the
// telemetry catalogs have no field it could occupy even by mistake.

/** The caller's token does not stand up. A verdict about the request, safe to refuse on. */
export type HumanVerificationRefusal =
  /** No token was presented at all, and the verifier is live and expecting one. */
  | "token-missing"
  /** The verifier rejected the token: malformed, forged, expired, or minted for another site. */
  | "token-rejected"
  /**
   * The token was already spent. Turnstile tokens are single-use with a five-minute life and the
   * siteverify API reports both conditions under one code, so a replay and a stale form cannot be
   * told apart — which is why this reason names what a client should DO (get a fresh token) rather
   * than claiming to know which of the two happened.
   */
  | "token-already-spent";

/** Nothing was asked of the caller. A fact about this deployment, never a verdict about them. */
export type HumanVerificationAbsence =
  /** No verifier credential is provisioned. The expected state until the owner stands one up. */
  | "verifier-not-configured"
  /** The verifier was asked and did not answer: a network failure, a timeout, or a server error. */
  | "verifier-unreachable"
  /** The verifier rejected OUR credential. Configured, and configured wrongly — an operator signal. */
  | "verifier-credential-rejected";

export type HumanVerificationOutcome =
  | { readonly decision: "verified" }
  | { readonly decision: "refused"; readonly reason: HumanVerificationRefusal }
  | { readonly decision: "unavailable"; readonly reason: HumanVerificationAbsence };

export interface HumanVerificationRequest {
  /** The challenge solution the client presented, or `null` when it presented none. */
  readonly token: string | null;
  /**
   * The caller's own address, passed to the verifier so it can weigh the solution against where it
   * came from. `null` when the runtime did not supply one — the verification still runs, it is
   * simply given less to judge on.
   */
  readonly callerAddress: string | null;
}

export interface HumanVerificationPort {
  verify(request: HumanVerificationRequest): Promise<HumanVerificationOutcome>;
}

/**
 * The port a deployment with no verifier credential resolves to. It answers the absence rather than
 * guessing at a verdict, and it makes no outbound call — so the unconfigured path costs nothing and
 * is the same shape in tests as it is in production.
 */
export const verifierNotConfigured: HumanVerificationPort = {
  verify: () =>
    Promise.resolve({ decision: "unavailable", reason: "verifier-not-configured" } as const),
};
