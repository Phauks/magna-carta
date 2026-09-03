/*
 * What putting an operation back MEANS, declared once per route.
 *
 * The platform performs thirty-three deletions and, before this existed, answered "can that be
 * undone?" in thirty-three hand-written sentences scattered through dialogs and route descriptions,
 * none of which anything checked. Reversibility is not a screen's fact: it does not depend on who is
 * looking, how long ago the act happened, or whether the browser was closed in between. It is a
 * property of the OPERATION, so it belongs where the platform already declares per-operation facts.
 *
 * THE VOCABULARY IS WHAT THE PLATFORM CAN ACTUALLY DO, not a taxonomy. Each arm names a mechanism
 * that exists in the code today: a restore route, an attach route that answers a detach, an update
 * route the previous values go back through, a compensating record, or nothing at all.
 *
 * A `none` MUST SAY WHY, and that sentence is the one a surface renders. It is the only arm that
 * carries prose, deliberately: an act nothing puts back is the one a reader must be told about
 * before they perform it, and a reason nobody wrote is a reason nobody thought about.
 */

/** The operation that puts it back, named by its `operationId`. */
type By = { readonly by: string };

export type RouteReversal =
  /**
   * A named operation returns the subject to what it was. The subject survives the act — a
   * soft-delete flag, a status, a completion — and the reversal clears it in place.
   */
  | ({ readonly kind: "restoration" } & By)
  /**
   * The counterpart of a two-sided pair: an attach answering a detach, a link answering an unlink, a
   * grant answering a revoke, a set answering a clear, a complete answering a reopen. Nothing was
   * destroyed, so the reversal is the other half of the pair rather than a repair of this one.
   *
   * THE LINE AGAINST `none`, since it is the one that gets argued: a counterpart route exists whose
   * job is to undo this one's effect on the SAME subject. Where the way back is to CREATE something
   * new — a new field, a new rule, a new mapping — that is not this act reversed, and the arm is
   * `none` with a reason that says what making a new one costs. A row identity that changes on the
   * way back does not by itself disqualify `inverse`; a subject that changes does.
   */
  | ({ readonly kind: "inverse" } & By)
  /**
   * The route reverses ITSELF: called again with the previous values, it lands the same state. There
   * is no other operation to name, which is why this arm carries no `by` — a field edit's reversal
   * is another field edit, and `{ kind: "inverse", by: "<this route>" }` would be a self-reference
   * that reads as a bug.
   *
   * NOT THE SAME AS `inverse` MERELY BECAUSE THE CALLER HOLDS THE OLD VALUE. Nearly every `inverse`
   * needs that too — re-attaching a receipt needs the document, re-adding an address needs the
   * address — so "who holds it" separates nothing. What separates this arm is that there is no
   * COUNTERPART OPERATION: a clear answered by a set is `inverse`, because set and clear are two
   * operations; a patch answered by a patch is this.
   *
   * It has no members while the gate is DELETE-only, because a DELETE that reverses itself does not
   * arise. Its population is the PATCH and PUT tier.
   */
  | { readonly kind: "restatement" }
  /**
   * The act stands and a new record cancels it — the ledger's mirror entry, a credit note, a
   * retraction. Nothing is edited and nothing is removed, so the history reads as what happened
   * followed by what corrected it.
   */
  | ({ readonly kind: "compensating" } & By)
  /** Nothing in the product puts this back, and the reason is the sentence that says so. */
  | { readonly kind: "none"; readonly reason: string };

/** The arms that name another operation, so one check covers all three. */
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
