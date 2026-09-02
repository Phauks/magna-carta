/*
 * The firm's expense-code catalogue, read once for the surface that needs it.
 *
 * THREE OUTCOMES, KEPT APART. The catalogue can arrive, it can be refused because this account may
 * not read it, or the read can fail. A screen that collapsed the last two into "no codes" would be
 * telling a member their firm has no expense codes when in fact they were not allowed to ask.
 *
 * The code itself never depends on this. A cost's expense-code identifier is issued in a stated
 * handle format, so "E101" is legible from the record alone; what the catalogue adds is the human
 * label beside it. That is why a refused catalogue costs the ledger a label and not a column.
 */
import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
import { listExpenseCodes, type ExpenseCode } from "./cost-operations.ts";

export class ExpenseCodeCatalogue {
  /** Null until the read settles. Empty is a real answer: the firm has none turned on. */
  codes = $state<readonly ExpenseCode[] | null>(null);
  /** True where the account was refused the read, which is not the same as an empty catalogue. */
  refused = $state(false);
  /** Set where the read failed for any other reason. */
  failure = $state<StatedFailure | null>(null);

  #asked = false;

  /** Read the catalogue once per surface. Repeat calls are no-ops. */
  async load(fetchImpl: typeof fetch): Promise<void> {
    if (this.#asked) return;
    this.#asked = true;
    const outcome = await listExpenseCodes(fetchImpl);
    if (outcome.kind === "ok") {
      this.codes = outcome.value.data;
      return;
    }
    this.codes = [];
    if (outcome.kind === "problem" && outcome.problem.status === 403) {
      this.refused = true;
      return;
    }
    this.failure = stated(outcome.failure, "The expense-code catalogue could not be read.");
  }

  /** The codes a person may actually pick: the ones the firm has turned on, in code order. */
  available = $derived.by((): readonly ExpenseCode[] =>
    (this.codes ?? [])
      .filter((code) => code.active !== 0)
      .toSorted((left, right) => left.code.localeCompare(right.code)),
  );

  /** The human label for one code identifier, or null while the catalogue cannot say. */
  labelFor = (identifier: string): string | null =>
    this.codes?.find((code) => code.id === identifier)?.label ?? null;

  /** Why the picker cannot offer a choice, or null when it can. */
  get pickerRefusal(): string | null {
    if (this.refused) {
      return (
        "The expense-code catalogue is gated on the UTBMS management permission, which this " +
        "account does not hold. A cost saves without a code."
      );
    }
    // A picker refusal is one line under a field, not a failure surface: it says why there is
    // nothing to choose from. The whole failure is still held, for a surface that wants to offer
    // the handle and a retry.
    if (this.failure !== null) {
      return this.failure.failure.problem?.detail ?? this.failure.fallback;
    }
    if (this.codes !== null && this.available.length === 0) {
      return "The firm has no expense codes turned on. A cost saves without a code.";
    }
    return null;
  }
}
