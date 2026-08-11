/*
 * The two WebAuthn ceremonies, and the words each one is allowed to say.
 *
 * WebAuthn is TWO operations and they are not interchangeable. `navigator.credentials.create` makes
 * a NEW credential: it belongs to registration and to the security settings, and it ends with a
 * passkey added to the account. `navigator.credentials.get` PROVES you already hold one: it belongs
 * to sign-in, and it ends with a session while the account's set of passkeys is untouched.
 *
 * Deriving the wording from which screen called it is how a sign-in ends up reporting "Passkey
 * created" and pushing a phantom credential into a list — the wrong operation, reported with the
 * wrong outcome. So the mode is explicit, and every string, every settled label and every failure
 * sentence is read from the mode rather than from the caller.
 *
 * A cancelled prompt is NOT an error condition to apologise for — it is the most common outcome
 * after a mistaken click, so the failure sentence states what did not happen ("no passkey was
 * created", "you are not signed in") rather than describing a fault.
 *
 * No route is called from here. This module is the ceremony's script; whether a server exists to
 * finish it is a separate question, answered by ./unbuilt-capabilities.ts.
 */
import type { ProgressStep } from "@magna-carta/design-system/progress-steps";

export type PasskeyCeremonyMode = "create" | "authenticate";

/** How far a ceremony has got. `idle` is before the native sheet has been asked for. */
export type PasskeyCeremonyPhase = "idle" | "asked" | "exercising" | "settled" | "cancelled";

interface PasskeyCeremonyScript {
  /** The three moments, in order: the browser is asked, the authenticator is exercised, it lands. */
  steps: readonly [string, string, string];
  /** What the control reads once the ceremony has succeeded. */
  settled: string;
  /** What did not happen, stated plainly. */
  failure: string;
  /** What the control reads when it can be tried again. */
  retry: string;
}

const SCRIPTS: Record<PasskeyCeremonyMode, PasskeyCeremonyScript> = {
  create: {
    steps: ["Waiting for your device", "Verifying with your authenticator", "Passkey created"],
    settled: "Passkey Created",
    failure: "Cancelled or timed out. No passkey was created.",
    retry: "Try Creating Again",
  },
  authenticate: {
    steps: ["Waiting for your device", "Checking your passkey", "Signed in"],
    settled: "Signed In",
    failure: "Cancelled, or that passkey was not recognised. You are not signed in.",
    retry: "Try Passkey Again",
  },
};

export function passkeyCeremonyScript(mode: PasskeyCeremonyMode): PasskeyCeremonyScript {
  return SCRIPTS[mode];
}

/**
 * The step sequence for a phase. A cancelled ceremony DROPS the third step rather than marking it
 * failed: the operation never reached that moment, and showing it struck through claims otherwise.
 */
export function passkeyCeremonySteps(
  mode: PasskeyCeremonyMode,
  phase: PasskeyCeremonyPhase,
): ProgressStep[] {
  const script = SCRIPTS[mode];
  const [asked, exercising, landed] = script.steps;
  if (phase === "cancelled") {
    return [
      { label: asked, status: "done" },
      { label: exercising, status: "failed", failure: script.failure },
    ];
  }
  const reached = phase === "idle" ? -1 : phase === "asked" ? 0 : phase === "exercising" ? 1 : 3;
  return [asked, exercising, landed].map((label, index) => ({
    label,
    status: index < reached ? "done" : index === reached ? "active" : "pending",
  }));
}
