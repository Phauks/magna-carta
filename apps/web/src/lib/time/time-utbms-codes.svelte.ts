/*
 * The firm's UTBMS codes, read once for the surface that needs them.
 *
 * TWO SETS, ONE READ EACH. A time entry carries a task code (its category) and an activity code,
 * and the catalogue serves one set per call — so this holds both and the caller asks for whichever
 * field it is filling.
 *
 * THREE OUTCOMES, KEPT APART. The catalogue can arrive, it can be refused because this account may
 * not read it, or the read can fail. A screen that collapsed the last two into "no codes" would be
 * telling a member their firm has no codes when in fact they were not allowed to ask. This is the
 * cost surface's ExpenseCodeCatalogue applied to the two sets a time entry uses; the shape is
 * deliberately the same, because a member who has learned one has learned the other.
 *
 * A CODE IS LEGIBLE WITHOUT THIS. An entry's own listing serves the code and its label together, so
 * a row reads properly whether or not the catalogue could be fetched. What the catalogue adds is
 * the ability to CHOOSE one, which is why a refusal costs the record window a picker and costs the
 * ledger nothing.
 */
import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
import { listUtbmsCodes, type UtbmsCode } from "./time-operations.ts";

/** One ABA set as this surface holds it. */
class CodeSet {
  codes = $state<readonly UtbmsCode[] | null>(null);
  refused = $state(false);
  failure = $state<StatedFailure | null>(null);

  /** The codes a person may actually pick: the ones the firm has turned on, in code order. */
  available = $derived.by((): readonly UtbmsCode[] =>
    (this.codes ?? [])
      .filter((code) => code.active !== 0)
      .toSorted((left, right) => left.code.localeCompare(right.code)),
  );

  /** How one code reads: the code and its label together, or "" where it is not in what was read. */
  labelFor(identifier: string | null): string {
    if (identifier === null) return "";
    const code = this.codes?.find((candidate) => candidate.id === identifier);
    return code === undefined ? "" : `${code.code} · ${code.label}`;
  }

  /** Why the picker cannot offer a choice, or null when it can. */
  get pickerRefusal(): string | null {
    if (this.refused) {
      return (
        "The code catalogue is gated on the UTBMS management permission, which this account does " +
        "not hold. An entry saves without a code."
      );
    }
    if (this.failure !== null) {
      return this.failure.failure.problem?.detail ?? this.failure.fallback;
    }
    /*
     * A FIRM WITH NO CODES TURNED ON IS NOT A REFUSAL, AND IT USED TO READ AS ONE. There was a
     * third branch here that returned "The firm has no codes of this kind turned on"; on the
     * record window that printed a paragraph under Category and the same paragraph again under
     * Activity Code, so the commonest configuration in the product — a firm that does not code its
     * time — got two sentences of apology and no working field.
     *
     * Nothing was wrong. The field's answer in that case is (None), and the picker offers (None)
     * unconditionally, so there is a real choice to make and it is already correct. What remains
     * here are the two states that ARE inabilities: this account may not read the catalogue, and
     * the read failed. Neither is a fact about the firm's codes, and both leave a reader unable to
     * pick — which is worth a sentence.
     */
    return null;
  }
}

export class UtbmsCatalogue {
  /** The task codes — what the record window calls the entry's Category. */
  readonly task = new CodeSet();
  /** The activity codes. */
  readonly activity = new CodeSet();

  #asked = false;

  /** Read both sets once per surface. Repeat calls are no-ops. */
  async load(fetchImpl: typeof fetch): Promise<void> {
    if (this.#asked) return;
    this.#asked = true;
    await Promise.all([
      this.#loadOne(fetchImpl, "task", this.task),
      this.#loadOne(fetchImpl, "activity", this.activity),
    ]);
  }

  async #loadOne(
    fetchImpl: typeof fetch,
    codeSet: "task" | "activity",
    into: CodeSet,
  ): Promise<void> {
    const outcome = await listUtbmsCodes(fetchImpl, codeSet);
    if (outcome.kind === "ok") {
      into.codes = outcome.value.data;
      return;
    }
    into.codes = [];
    if (outcome.kind === "problem" && outcome.problem.status === 403) {
      into.refused = true;
      return;
    }
    into.failure = stated(outcome.failure, "The code catalogue could not be read.");
  }
}
