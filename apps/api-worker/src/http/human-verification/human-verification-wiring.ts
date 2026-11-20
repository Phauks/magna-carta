// Which verifier this deployment has, and what a protected endpoint does when it has none.
//
// Resolution is by the PRESENCE of the credential, on the same terms `files/scan-port-binding.ts`
// selects an engine and `conversions/conversion-engine.ts` selects a conversion port: no flag to
// forget to flip, no construction-time throw, and the not-configured path is the default everywhere
// either Turnstile key is absent — which is every environment until the owner creates the widget.

import type { Bindings } from "../../bindings.ts";
import { verifierNotConfigured, type HumanVerificationPort } from "./human-verification-port.ts";
import { createTurnstileVerifier } from "./turnstile-verifier.ts";

/**
 * What a protected anonymous endpoint does when NO verifier is provisioned.
 *
 * - `fail-open` — the endpoint serves, unprotected, and every unprotected pass is counted. The
 *   endpoint behaves exactly as it did before this gate existed, and the absence of protection stops
 *   being invisible.
 * - `fail-closed` — the endpoint refuses. Nothing anonymous gets through until a verifier exists.
 *
 * This is a security posture with a product consequence, so it is a deployment value rather than a
 * constant: flipping it is one variable in `wrangler.jsonc`, not a code change and a deploy.
 */
export type UnverifiedPosture = "fail-open" | "fail-closed";

// The default, and the reason for it: the endpoints this gate protects include the platform's ONLY
// self-serve way in. Defaulting to fail-closed would mean that the moment this ships — before the
// owner has touched the Cloudflare dashboard — every visitor trying to found a firm is refused, so
// the act of adding abuse protection would itself be the outage. Fail-open keeps the door working
// and makes the missing protection a counter somebody can alert on, which is the same trade the
// malware-scan path already makes: an honest "not scanned" over a fabricated "clean", never a
// refusal aimed at the member for an engine that is not there.
const DEFAULT_UNVERIFIED_POSTURE: UnverifiedPosture = "fail-open";

/** The widget's two keys: the public one the browser renders with and the secret the server checks with. */
export interface TurnstileKeys {
  readonly siteKey: string;
  readonly secretKey: string;
}

/**
 * Both Turnstile keys, or `null` unless BOTH are set.
 *
 * Requiring the pair is what makes the switch-on order safe. With the secret alone, the server would
 * demand a solution that no screen can mint, because the screens render the widget only when they
 * are handed a site key, and every sign-in and registration would be refused. With the site key
 * alone, the widget renders and its solution is ignored, which costs nothing. So the check turns on
 * only at the moment the screens can satisfy it, whichever key is added first.
 */
export function resolveTurnstileKeys(env: Bindings): TurnstileKeys | null {
  const siteKey = env.TURNSTILE_SITE_KEY;
  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (siteKey === undefined || siteKey === "" || secretKey === undefined || secretKey === "") {
    return null;
  }
  return { siteKey, secretKey };
}

/** Resolve the verifier for an environment. Either key absent -> the honest not-configured port. */
export function resolveHumanVerificationPort(env: Bindings): HumanVerificationPort {
  const keys = resolveTurnstileKeys(env);
  if (keys === null) return verifierNotConfigured;
  return createTurnstileVerifier(keys.secretKey);
}

/**
 * Resolve the posture for an environment. An unset or unrecognized value takes the default rather
 * than throwing: a typo in a deployment variable must not take the front door down, and the counter
 * on every unverified pass is what makes the resulting posture visible.
 */
export function resolveUnverifiedPosture(env: Bindings): UnverifiedPosture {
  return env.HUMAN_VERIFICATION_POSTURE === "fail-closed"
    ? "fail-closed"
    : DEFAULT_UNVERIFIED_POSTURE;
}
