/*
 * The sign-in surface's honest inventory of what the SERVER cannot do yet.
 *
 * Several of the designed screens describe a capability the Worker has no route for. The rule this
 * module exists to enforce is that such a control is never rendered as though it worked: a button
 * that silently does nothing is worse than an absent one, and worse still than a present one that
 * says why it is inert. So each unbuilt capability is declared once, here, and every surface reads
 * its state from this list — the live sign-in screen to decide whether to render a control at all,
 * and the developer screen-state page to label the gap out loud.
 *
 * Each entry names the SERVER-side thing that is missing, not the screen. When the route lands, the
 * entry is deleted and every consumer follows, rather than a `false` flag being flipped in six
 * places. An entry may also NARROW rather than disappear — human verification did: the server now
 * validates a solution on the joining endpoints, so what is missing is no longer the route but a
 * widget to mint a token and a decision to gate sign-in, and the sentence says so. A gap that half
 * closes and keeps its old wording is worse than one that never closed, because the next reader
 * trusts it. Verified against apps/api-worker/src/auth.ts,
 * apps/api-worker/src/http/human-verification/human-verification-gate.ts and
 * apps/web/src/lib/auth/client.ts.
 */

export interface UnbuiltCapability {
  /** A stable key so a surface can ask about one capability without matching on prose. */
  id: string;
  /** What the visitor would be trying to do. */
  label: string;
  /** What is actually missing on the server, in one sentence. */
  missing: string;
}

export const UNBUILT_CAPABILITIES: readonly UnbuiltCapability[] = [
  {
    id: "passkey",
    label: "Sign in with a passkey or security key",
    missing:
      "The Better Auth passkey plugin is not mounted, so there is no registration or assertion route and no credential store.",
  },
  {
    id: "one-time-link",
    label: "Email a one-time sign-in link",
    missing:
      "The magic-link plugin is not mounted. Password reset does send mail, but it resets a password rather than establishing a session.",
  },
  {
    id: "identity-provider",
    label: "Sign in through the firm's identity provider",
    missing:
      "No socialProviders are configured, so nothing resolves an address to a firm's identity provider and there is no redirect target.",
  },
  {
    id: "human-verification",
    label: "Human verification on the anonymous endpoints",
    missing:
      "The server verifies a Turnstile solution on the two joining endpoints, but nothing here mints one and the sign-in endpoints are not gated at all — so this row is a placeholder, not a widget.",
  },
  {
    id: "second-factor-choice",
    label: "Choosing which second factor to use",
    missing:
      "The two-factor plugin holds one authenticator secret plus backup codes. There are no enrolled phone channels or email codes to choose between.",
  },
  {
    id: "workspace-selection",
    label: "Choosing a workspace after signing in",
    missing:
      "Nothing publishes the firms a signed-in person belongs to, and there is no route to record a default.",
  },
  {
    id: "reset-code",
    label: "Typing a reset code instead of opening the reset link",
    missing:
      "Password reset is a link carrying an opaque token; the emailOTP plugin that would issue a typeable code is not mounted.",
  },
];

/** Look one capability up by key. Throws rather than returning undefined: every id here is a literal in source. */
export function unbuiltCapability(id: string): UnbuiltCapability {
  const found = UNBUILT_CAPABILITIES.find((capability) => capability.id === id);
  if (!found) throw new Error(`No unbuilt capability is registered under "${id}".`);
  return found;
}
