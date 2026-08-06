import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import { MAGNUS_DISCLOSURE_VERSION } from "@magna-carta/magnus/disclosure";
import { magnusEnabledDefinition } from "@magna-carta/magnus/settings";
import { readAcknowledgement } from "@magna-carta/magnus/statements";

// The one place either consent gate is read.
//
// There are two gates and both fail closed, because they answer genuinely different questions and
// collapsing them fails in both directions: a firm that enabled inference for document drafting has
// not thereby consented to a free-form assistant, and a firm that switches the assistant off should
// not thereby disable every other AI feature.
//
//   inference.aiProcessingEligibility — may this firm's content reach a third-party frontier model at
//                                       all? The general axis, already shipped, default closed. The
//                                       assistant inherits the answer; it does not get to re-ask.
//   magnus.enabled                    — is this specific feature on? The specific axis, default
//                                       closed.
//
// Both the routes and the queue consumer resolve through THIS function, so submission and execution
// can never disagree about whether the assistant is on. The consumer re-resolves before the model
// call: a firm that switches the feature off must not have queued turns continue to reach a provider,
// and a gate that has closed since submission produces a refused turn, never a silent drop.

export type MagnusConsent =
  | { readonly state: "open"; readonly disclosureVersion: number }
  // The firm has not consented to third-party model processing at all.
  | { readonly state: "firm-ineligible" }
  // The firm consents to model processing generally but has not turned the assistant on.
  | { readonly state: "feature-disabled" }
  // The firm is open; this member has not accepted the current disclosure. A different kind of
  // refusal — the member can clear it themselves, which is why it is not a 403.
  | { readonly state: "acknowledgement-required"; readonly disclosureVersion: number };

// The firm half, on its own. This function is the ONLY place either setting is read anywhere in the
// codebase — the routes reach it through resolveMagnusConsent below, and the queue consumer calls it
// directly before the model call. The consumer deliberately re-reads the firm gates and NOT the
// member acknowledgement: the member's acceptance was recorded at submission and does not lapse
// mid-flight, whereas the firm's consent is exactly the thing that must be able to stop work already
// in the queue.
export type MagnusFirmGates = "open" | "firm-ineligible" | "feature-disabled";

export async function resolveMagnusFirmGates(firmDatabase: SqlDatabase): Promise<MagnusFirmGates> {
  const eligible = await readFirmSetting(firmDatabase, aiProcessingEligibilityDefinition);
  if (!eligible) return "firm-ineligible";
  const enabled = await readFirmSetting(firmDatabase, magnusEnabledDefinition);
  if (!enabled) return "feature-disabled";
  return "open";
}

export async function resolveMagnusConsent(
  firmDatabase: SqlDatabase,
  userId: UserId,
): Promise<MagnusConsent> {
  const gates = await resolveMagnusFirmGates(firmDatabase);
  if (gates !== "open") return { state: gates };

  // An acknowledgement of an older disclosure is not an acknowledgement of this one: the version
  // moves when what the assistant can see or do changes, and the member is re-prompted rather than
  // presumed to have agreed to something they were never shown.
  const acknowledgement = await readAcknowledgement(firmDatabase, userId);
  if (
    acknowledgement === undefined ||
    acknowledgement.disclosureVersion !== MAGNUS_DISCLOSURE_VERSION
  ) {
    return { state: "acknowledgement-required", disclosureVersion: MAGNUS_DISCLOSURE_VERSION };
  }

  return { state: "open", disclosureVersion: MAGNUS_DISCLOSURE_VERSION };
}
