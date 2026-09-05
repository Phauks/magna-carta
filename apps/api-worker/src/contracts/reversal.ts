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
 * that exists in the code today: a restore route, a route that answers this one, a compensating
 * record, or nothing at all. An arm nobody can point at a member of is an arm nobody applies
 * consistently, which is why `restatement` was removed rather than kept for a case that had not
 * arisen — the one it described is an `inverse` naming its own operation.
 *
 * `compensating` IS THE ONE ARM WITH NO MEMBERS, and it is held deliberately rather than by
 * oversight: the ledger is where it lands, and its rule is an invariant rather than a preference —
 * a posted entry is never edited or removed, so a correction is a new balancing entry that leaves
 * the original standing (`packages/ledger/src/reverse-entry.ts` composes exactly that mirror).
 * Without the arm the mirror would be declared an `inverse`, which says the original went away.
 * It is the next thing to declare when the gate widens past DELETE; if that widening does not
 * happen, it should go the way `restatement` did.
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
