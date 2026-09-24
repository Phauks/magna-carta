/*
 * What a reader may do to a payment that is waiting on a decision, decided once for both surfaces.
 *
 * WHO MAY ACT ON A REQUEST IS NOT THE BUTTON'S BUSINESS. A member may never settle their own
 * proposal — that is the whole point of a second person — so the queue offers Withdraw on a request
 * the reader raised and Approve and Reject on everybody else's. A member without the capability
 * sees the same verbs, disabled, carrying the reason: a control that vanishes teaches nobody that
 * the capability exists.
 *
 * ONE ANSWER FOR THE MATTER AND FOR THE FIRM. A matter's Trust section and the firm's Trust screen
 * show the same waiting request to the same member, so a second copy of this judgment on either of
 * them is a second answer to one question — and the matter's copy had already drifted into posting
 * a withdrawal on the press, with no panel and no reason, where the firm's opened one.
 *
 * IT IS PURE, so every one of these is asserted without a browser. A judgment that only exists
 * inside a component is a judgment nothing can check.
 */
import { permissionRefusal } from "$lib/access/refusal.ts";
import { TRUST_PERMISSIONS, type TrustPendingRequest } from "./trust-api.ts";

/** The three things a reader can do to a request that nobody has decided yet. */
export type TrustRequestVerb = "approve" | "reject" | "withdraw";

/** Who is looking at the queue, which is all it takes to decide what they may do. */
export interface TrustQueueViewer {
  /** The signed-in member's user identifier, or null while the session is still being read. */
  readonly sessionUserId: string | null;
  /** The capabilities the session holds, or null while it is still being read. */
  readonly permissions: readonly string[] | null;
}

/** One verb the queue offers, and why it cannot be pressed where it cannot. */
export interface TrustRequestAction {
  readonly verb: TrustRequestVerb;
  readonly label: string;
  /** Why the verb is refused, or undefined while it is available. */
  readonly refusal?: string;
}

const VERB_LABELS: Readonly<Record<TrustRequestVerb, string>> = {
  approve: "Approve",
  reject: "Reject",
  withdraw: "Withdraw",
};

/** What each verb is called when a refusal has to name the act it would have performed. */
const VERB_ACTS: Readonly<Record<TrustRequestVerb, string>> = {
  approve: "Approving a trust request",
  reject: "Rejecting a trust request",
  withdraw: "Withdrawing a trust request",
};

/**
 * The verbs this reader is offered on this request.
 *
 * The proposer gets Withdraw and nothing else: a member who could approve their own proposal is a
 * firm with no second person on any payment, however its posture reads. Everybody else gets Approve
 * and Reject. The set never changes with the capability — only the refusal does — because a reader
 * refused server-side should learn that here rather than at the commit.
 */
export function requestActions(
  request: TrustPendingRequest,
  viewer: TrustQueueViewer,
): readonly TrustRequestAction[] {
  const verbs: readonly TrustRequestVerb[] =
    viewer.sessionUserId !== null && request.requestedBy === viewer.sessionUserId
      ? ["withdraw"]
      : ["approve", "reject"];
  return verbs.map((verb) => {
    const refusal = verbRefusal(verb, viewer);
    return refusal === undefined
      ? { verb, label: VERB_LABELS[verb] }
      : { verb, label: VERB_LABELS[verb], refusal };
  });
}

function verbRefusal(verb: TrustRequestVerb, viewer: TrustQueueViewer): string | undefined {
  if (viewer.permissions === null) return "Reading your session.";
  if (!viewer.permissions.includes(TRUST_PERMISSIONS.manage)) {
    return permissionRefusal(VERB_ACTS[verb], TRUST_PERMISSIONS.manage);
  }
  return undefined;
}
