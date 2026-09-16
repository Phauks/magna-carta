/*
 * The recorded exceptions to "a migration on `main` never changes" — each one a deliberate act, with
 * the reason it was safe written down beside it.
 *
 * WHY THERE IS A LIST AT ALL. The rule the gate enforces is right, and it is also occasionally
 * wrong: on 2026-09-15 two per-firm migrations were re-stamped on `main` to repair a lineage a merge
 * had inverted, which is a change to a deployed tag and was nonetheless the correct repair, because
 * no firm was onboarded yet and the pools were empty and recreatable. A gate with no way to say that
 * gets switched off the first time it is right to override, and then it protects nothing. A gate
 * that makes you write the reason down keeps the override rare and keeps the reason findable.
 *
 * WHAT IT COSTS TO BE WRONG HERE. The applied-ledger in every database records the TAG, not the SQL
 * behind it. So a database that has applied `20260911T120000_thing` will never see an edit to that
 * file — its schema and the repository's permanently disagree — and a database that has applied a
 * tag this lineage no longer contains is refused outright by the runner as "a migration this code
 * does not know", which blocks every later migration for the life of that database. Neither is
 * recoverable by deploying again. `packages/database/src/legacy-baselines.ts` is what recovering
 * from one of these costs after the fact.
 *
 * WHAT DOES NOT BELONG HERE. A baseline collapse — retiring a chain of migrations behind one
 * baseline — is not an exception and needs no entry: it is reconciled at RUNTIME by
 * `LEGACY_BASELINES`, which the gate reads directly. Recording it twice would let the two disagree.
 *
 * An entry is a statement about a window that has closed. Never delete one; the lineage it explains
 * is still the lineage that shipped.
 */

export interface AllowedChange {
  /** `control-plane` or `per-firm`. */
  readonly lineage: string;
  /** The tag on `main` that this change moves or edits. */
  readonly tag: string;
  /** The tag it became, when it was a rename rather than an edit. */
  readonly replacedBy?: string;
  /** Why no database could have applied it — the part that makes the change safe, not the motive. */
  readonly why: string;
  /** The day it was recorded, `YYYY-MM-DD`. */
  readonly recorded: string;
}

/*
 * Empty, and that is the intended steady state. The shape of an entry, for whoever adds the first:
 *
 *   {
 *     lineage: "per-firm",
 *     tag: "20260911T000000_office-email-address-lines",
 *     replacedBy: "20260911T120001_office-email-address-lines",
 *     why: "No firm was onboarded; both per-firm pools were empty and recreatable. " +
 *       "docs/deploy-queue.md records the window.",
 *     recorded: "2026-09-15",
 *   },
 */
export const ALLOWED_CHANGES: readonly AllowedChange[] = [];
