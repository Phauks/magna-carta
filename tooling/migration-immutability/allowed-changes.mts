/*
 * The recorded exceptions to "a migration on `main` never changes" — each one a deliberate act, with
 * the reason it was safe written down beside it.
 *
 * WHY THERE IS A LIST AT ALL. The rule the gate enforces is right, and it is also occasionally
 * wrong: on 2026-09-15 two per-firm migrations were re-stamped on `main` to repair a lineage a merge
 * had inverted, which is a change to a deployed tag and was nonetheless the correct repair. A gate
 * with no way to say that gets switched off the first time it is right to override, and then it
 * protects nothing. A gate that makes you write the reason down keeps the override rare and keeps
 * the reason findable.
 *
 * That rename is also the reason this list is still empty. It was justified on the premise that no
 * database could have applied either id — no firm onboarded, both pools empty and recreatable — and
 * the premise was wrong: a firm database had applied both, and refused to wake from the moment the
 * rename deployed. So the answer it needed was not an allowance here but a reconciliation, and it
 * lives in `packages/database/src/re-stamped-migrations.ts`. Read that before reaching for an entry
 * in this file: an allowance asserts that nothing has to be repaired, which is a claim about the
 * fleet that is easy to believe and hard to check.
 *
 * WHAT IT COSTS TO BE WRONG HERE. The applied-ledger in every database records the TAG, not the SQL
 * behind it. So a database that has applied `20260911T120000_thing` will never see an edit to that
 * file — its schema and the repository's permanently disagree — and a database that has applied a
 * tag this lineage no longer contains is refused outright by the runner as "a migration this code
 * does not know", which blocks every later migration for the life of that database. Neither is
 * recoverable by deploying again. `packages/database/src/legacy-baselines.ts` is what recovering
 * from one of these costs after the fact.
 *
 * WHAT DOES NOT BELONG HERE. Anything the runtime reconciles by itself needs no entry, because the
 * gate reads the runtime's own lists directly and recording the same fact twice would let the two
 * disagree. That covers a baseline collapse — retiring a chain of migrations behind one baseline,
 * `LEGACY_BASELINES` — and a re-stamp — the same SQL under a new tag, `RE_STAMPED_MIGRATIONS`. What
 * is left for this file is a tag that is going away with nothing standing in for it.
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
 * Empty, and that is the intended steady state. The shape of an entry, for whoever adds the first —
 * deliberately not the 2026-09-15 rename, which is reconciled at runtime and is the worked example
 * of an entry that should not have been written here:
 *
 *   {
 *     lineage: "control-plane",
 *     tag: "20260101T000000_some-migration",
 *     why: "Authored and merged inside one hour, before the deploy that would have carried it " +
 *       "ran; the build that took it to production never contained the old tag.",
 *     recorded: "2026-01-01",
 *   },
 */
export const ALLOWED_CHANGES: readonly AllowedChange[] = [];
