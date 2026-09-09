/*
 * Signing out — the one home for ending a session from inside the application.
 *
 * THREE STEPS, IN THIS ORDER, AND THE ORDER IS THE WHOLE DESIGN. End the session on the server;
 * then drop what this session left in the browser; then leave. Reversing any pair produces a
 * sign-out that looks like one and is not: clearing local state first and then failing the server
 * call leaves somebody still signed in on a screen that has forgotten what it was showing, and
 * leaving first means the person is looking at the sign-in screen while their cookie is still good.
 *
 * A REFUSAL KEEPS YOU WHERE YOU ARE. If the server does not answer, or answers with an error, the
 * session may well still be live — and the one thing worse than not signing out is believing you
 * did. So a failed sign-out says so and changes nothing; it does not navigate to the sign-in screen
 * on the strength of an unanswered request. This matters most on exactly the machine where somebody
 * would sign out most deliberately: a shared one.
 *
 * LEAVING IS A DOCUMENT LOAD, NOT A ROUTE CHANGE. The application is a long-lived SPA and a
 * signed-in session accumulates a heap full of firm data — matters, ledgers, drafts, whatever the
 * screens have read. A client-side navigation to /login keeps every byte of that alive in the tab
 * for the next person to sit down at it; a document load discards the whole heap. That costs one
 * page load on the way out, at the moment nobody is waiting on the application to be fast, which is
 * the cheapest possible place to spend it.
 *
 * WHAT IS DELIBERATELY NOT CLEARED: this device's own preferences (the sidebar's state, the
 * settings drafts, the last-seen download stamp — the localStorage seams under $lib/settings,
 * $lib/navigation and $lib/export). They are how this browser is set up rather than anything the
 * session learned, they hold no firm data, and wiping them would mean signing back in to an
 * application that had forgotten how you like it. Session-scoped secrets are a different question,
 * and the one that exists — an invitation code carried across the joining flow — is dropped here.
 *
 * The server side is Better Auth's own `/api/auth/sign-out`, reached through ./client.ts like every
 * other auth call. It deletes the session row AND expires both cookies — the session token and the
 * five-minute signed session cache (apps/api-worker/src/auth.ts) — so no part of the session
 * survives on this device the way a server-side revocation can for the length of that cache.
 */
import { platformHealth } from "$lib/diagnostics/platform-health.svelte.ts";
import { authClient } from "./client.ts";
import { forgetInvitationCode } from "./pending-invitation.ts";

/** Where a signed-out person lands: the front door, with no `next` — they asked to leave. */
export const SIGNED_OUT_PATH = "/login";

/**
 * The one refusal sentence. It says the session is STILL OPEN rather than merely that something
 * went wrong, because what the person does next depends on that fact and on nothing else.
 */
export const SIGN_OUT_FAILED =
  "You could not be signed out — your session is still open. Try again, and if you are on a shared computer, close the browser.";

/** What happened. A refusal carries the sentence to show, so no caller writes its own. */
export type SignOutOutcome = { kind: "signed-out" } | { kind: "failed"; message: string };

/**
 * The three things signing out does, injectable so the order and the refusal path are unit-tested
 * rather than only reasoned about — none of the three is observable from a test that has to run the
 * real ones.
 */
export interface SignOutSeams {
  /** Ends the session on the server. Resolves carrying `error` when the server refused. */
  readonly endSession: () => Promise<{ error?: unknown }>;
  /** Drops what this session left in the browser. */
  readonly forgetLocalState: () => void;
  /** Leaves for `path` by a document load, discarding the tab's memory with the old document. */
  readonly leave: (path: string) => void;
}

const browserSeams: SignOutSeams = {
  endSession: () => authClient.signOut(),
  forgetLocalState: () => {
    forgetInvitationCode();
    // A platform-trouble notice describes the session that raised it, and carrying one onto the
    // sign-in screen would report an outage to somebody who has not made a request yet.
    platformHealth.reset();
  },
  leave: (path) => globalThis.location.assign(path),
};

/**
 * End the session and leave. Resolves rather than throws: a caller has a message to render on
 * refusal, and on success the document is already going away.
 */
export async function signOut(seams: SignOutSeams = browserSeams): Promise<SignOutOutcome> {
  let ended = false;
  try {
    const { error } = await seams.endSession();
    // Both shapes mean the same thing here: an error the server named, and no answer at all.
    ended = error === null || error === undefined;
  } catch {
    ended = false;
  }
  if (!ended) return { kind: "failed", message: SIGN_OUT_FAILED };

  seams.forgetLocalState();
  seams.leave(SIGNED_OUT_PATH);
  return { kind: "signed-out" };
}
