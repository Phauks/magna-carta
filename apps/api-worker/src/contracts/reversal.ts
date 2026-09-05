/*
 * What putting an operation back MEANS, declared once per route.
 *
 * The platform performs thirty-three deletions and, before this existed, answered "can that be
 * undone?" in thirty-three hand-written sentences scattered through dialogs and route descriptions,
 * none of which anything checked. Reversibility is not a screen's fact: it does not depend on who is
 * looking, how long ago the act happened, or whether the browser was closed in between. It is a
 * property of the OPERATION, so it belongs where the platform already declares per-operation facts.
 *
 * AN ARM EARNS ITS PLACE BY CHANGING WHAT A SURFACE DOES, and by nothing else. That is the whole
 * test, and it is short on purpose — a vocabulary sorted by how a route FEELS is a vocabulary two
 * people apply two ways. `inverse` says offer the way back and call the named route. `compensating`
 * says do NOT offer a way back: the act stands and a new record offsets it. `none` says do not
 * offer, and here is the sentence explaining why. Three answers, three behaviours.
 *
 * TWO ARMS WERE CUT FOR FAILING IT. `restatement` described a route reversed by calling it again,
 * which is an `inverse` naming its own operation. `restoration` described a reversing route that
 * exists only to reverse — which is a fact about the route author's intent, not about anything a
 * caller does: a surface calls a named operationId either way, and the claim that a restoration
 * needs nothing but an id was false of its own only member (`files.restore` takes a body like every
 * other counterpart). Both were sorting on feel.
 *
 * `compensating` has no members yet and is held anyway, because it is the one arm that changes the
 * answer rather than the wording. The ledger is where it lands, and its rule is an invariant rather
 * than a preference: a posted entry is never edited or removed, so a correction is a new balancing
 * entry that leaves the original standing (`packages/ledger/src/reverse-entry.ts` composes exactly
 * that mirror). Declared as an `inverse`, that mirror would tell a surface to offer "undo" for an
 * entry that is never going away.
 *
 * A `none` MUST SAY WHY, and that sentence is the one a surface renders. It is the only arm that
 * carries prose, deliberately: an act nothing puts back is the one a reader must be told about
 * before they perform it, and a reason nobody wrote is a reason nobody thought about.
 */

/** The operation that puts it back, named by its `operationId`. */
type By = { readonly by: string };

export type RouteReversal =
  /**
   * A counterpart operation undoes this one's effect on the same subject, and the declaration names
   * it: an attach answering a detach, a link answering an unlink, a grant answering a revoke, a set
   * answering a clear, a complete answering a reopen, a restore answering a soft delete.
   *
   * THE LINE AGAINST `none`, since it is the one that gets argued: a counterpart route exists whose
   * job is to undo this one's effect on the SAME subject. Where the way back is to CREATE something
   * new — a new field, a new rule, a new mapping — that is not this act reversed, and the arm is
   * `none` with a reason that says what making a new one costs. A row identity that changes on the
   * way back does not by itself disqualify `inverse`; a subject that changes does.
   *
   * A ROUTE MAY NAME ITSELF, and that is the sanctioned form rather than a bug: a field edit is
   * reversed by another field edit, so `{ kind: "inverse", by: "<this operationId>" }` is the true
   * statement. It was briefly a separate arm on the reasoning that the caller must hold the old
   * value — which separates nothing, because nearly every `inverse` needs that too (re-attaching a
   * receipt needs the document, re-adding an address needs the address). What the declaration is
   * for is telling a surface WHICH ROUTE to call; when the answer is "this one", say so.
   */
  | ({ readonly kind: "inverse" } & By)
  /**
   * The act stands and a new record cancels it — the ledger's mirror entry, a credit note, a
   * retraction. Nothing is edited and nothing is removed, so the history reads as what happened
   * followed by what corrected it.
   */
  | ({ readonly kind: "compensating" } & By)
  /** Nothing in the product puts this back, and the reason is the sentence that says so. */
  | { readonly kind: "none"; readonly reason: string };

/** The arms that name an operation, so one check covers all of them. */
export function reversalOperationId(reversal: RouteReversal): string | undefined {
  return "by" in reversal ? reversal.by : undefined;
}

/**
 * Why a declaration is malformed, or undefined when it is well formed.
 *
 * Shared by the registration-time guard and the conformance fitness function so the two cannot
 * drift — one definition of a bad declaration, two places that refuse it.
 */
export function reversalDeclarationProblem(reversal: RouteReversal): string | undefined {
  if (reversal.kind === "none") {
    return reversal.reason.trim() === ""
      ? 'reversal { kind: "none" } must carry a non-empty reason — an act nothing puts back is the one a reader must be told about'
      : undefined;
  }
  const named = reversalOperationId(reversal);
  if (named !== undefined && named.trim() === "") {
    return `reversal { kind: "${reversal.kind}" } must name the operationId that puts it back`;
  }
  return undefined;
}
