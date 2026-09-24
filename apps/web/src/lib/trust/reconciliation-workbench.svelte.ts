/*
 * What one reconciliation's screen reads, in one place.
 *
 * FOUR READS, FOUR FAILURES, AND ONLY ONE OF THEM IS THE SCREEN. The reconciliation and its proof
 * are the screen's subject: without them there is no proof to state and no period to work in, so
 * that failure is the screen's. The two sides, the matches and the statement's own words each
 * answer a different question about the same reconciliation, and a period whose matches cannot be
 * read still has a proof somebody came here to read. So each keeps its own failure and its own
 * absence, and a section that cannot be read goes quiet on its own while the rest of the screen
 * stands.
 *
 * EVERY READ IS GUARDED AGAINST ITS OWN PREDECESSOR. Recording a match re-reads the proof, the two
 * sides and the matches together, and nothing about the order three requests come back in is under
 * anyone's control. Written unguarded, a re-read that started first and answered last puts the
 * state from before the match back on screen, and it looks exactly like a match that did not
 * record. One guard covers the three together, because they share one subject: this reconciliation
 * as it stands after the last thing anybody did to it.
 *
 * A REFRESH KEEPS WHAT IS ON SCREEN. The re-read after a match is not the arrival of a screen, it
 * is the same screen answering again, so the records stay standing and the region says it is
 * reading rather than emptying itself and filling back up under the reader's hands.
 */
import type { Failure } from "$lib/api/request.ts";
import { LatestOnly } from "$lib/api/latest-only.ts";
import {
  listTrustBankStatements,
  listTrustReconciliationMatches,
  readTrustReconciliation,
  readTrustReconciliationSuggestions,
  type TrustBankStatement,
  type TrustReconciliation,
  type TrustReconciliationMatch,
  type TrustReconciliationSuggestions,
  type TrustThreeWayProof,
} from "./trust-api.ts";

export class ReconciliationWorkbench {
  /** The reconciliation and the proof as it stands now. Null until the screen's own read lands. */
  reconciliation = $state<TrustReconciliation | null>(null);
  proof = $state<TrustThreeWayProof | null>(null);
  reconciliationFailure = $state<Failure | null>(null);
  /** True where the record read answered that there is no such reconciliation. */
  notFound = $state(false);

  /** The unmatched lines, the outstanding items and the candidate pairings between them. */
  suggestions = $state<TrustReconciliationSuggestions | null>(null);
  suggestionsFailure = $state<Failure | null>(null);

  /** Every match recorded on this reconciliation, withdrawn ones included, oldest first. */
  matches = $state<readonly TrustReconciliationMatch[] | null>(null);
  matchesFailure = $state<Failure | null>(null);

  /**
   * The statement this reconciliation is of.
   *
   * Read after the reconciliation, because it is the reconciliation that names which account and
   * which statement, and read off the account's own listing rather than by a route of its own: the
   * period, the two balances and the reference all come from the same record the firm's Trust
   * screen already reads. Its failure costs the screen the period's WORDS and nothing else, so it
   * keeps its own absence rather than taking the proof down with it.
   */
  statement = $state<TrustBankStatement | null>(null);
  statementFailure = $state<Failure | null>(null);

  /** True while the three reads are answering again over records already on screen. */
  refreshing = $state(false);

  #reads = new LatestOnly();

  /** Which reconciliation the reads were last started for. */
  #showing: string | null = null;

  /** Read everything this screen says about one reconciliation, from nothing. */
  load(fetchImpl: typeof fetch, reconciliationId: string): void {
    this.#showing = reconciliationId;
    this.#reads.supersede();
    this.reconciliation = null;
    this.proof = null;
    this.reconciliationFailure = null;
    this.notFound = false;
    this.suggestions = null;
    this.suggestionsFailure = null;
    this.matches = null;
    this.matchesFailure = null;
    this.statement = null;
    this.statementFailure = null;
    this.refreshing = false;
    this.#readAll(fetchImpl, reconciliationId);
  }

  /**
   * Read it all again, after something was recorded.
   *
   * It takes the identifier rather than reading the one it is showing, so an answer about a
   * reconciliation the reader has since left cannot write itself over the one now on screen: the
   * guard drops it exactly as it drops a superseded first read.
   */
  reread(fetchImpl: typeof fetch, reconciliationId: string): void {
    if (reconciliationId !== this.#showing) return;
    this.#reads.supersede();
    this.refreshing = true;
    this.#readAll(fetchImpl, reconciliationId);
  }

  /** Ask for the screen's own read again, after it failed. */
  retryReconciliation(fetchImpl: typeof fetch, reconciliationId: string): void {
    this.load(fetchImpl, reconciliationId);
  }

  #readAll(fetchImpl: typeof fetch, reconciliationId: string): void {
    const attempt = this.#reads.attempt();
    void (async () => {
      await Promise.all([
        this.#readReconciliation(fetchImpl, reconciliationId, attempt),
        this.#readSuggestions(fetchImpl, reconciliationId, attempt),
        this.#readMatches(fetchImpl, reconciliationId, attempt),
      ]);
      if (attempt.current) this.refreshing = false;
    })();
  }

  async #readReconciliation(
    fetchImpl: typeof fetch,
    reconciliationId: string,
    attempt: { readonly current: boolean },
  ): Promise<void> {
    const outcome = await readTrustReconciliation(fetchImpl, reconciliationId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.reconciliation = outcome.value.reconciliation;
      this.proof = outcome.value.proof;
      this.reconciliationFailure = null;
      this.notFound = false;
      await this.#readStatement(
        fetchImpl,
        outcome.value.reconciliation.trustAccountId,
        outcome.value.reconciliation.statementId,
        attempt,
      );
      return;
    }
    /*
     * A 404 KEEPS ITS FAILURE RECORD. It is an answer rather than a fault, and it is still a
     * failure: the problem document carries the Error ID, the server's own words, and the
     * difference between an address that names no reconciliation and a service briefly out of step
     * after a release. The flag says only that a retry could not succeed, so the screen draws none;
     * everything a reader is told comes off the record.
     */
    this.notFound = outcome.failure.problem?.status === 404;
    this.reconciliation = null;
    this.proof = null;
    this.reconciliationFailure = outcome.failure;
  }

  async #readStatement(
    fetchImpl: typeof fetch,
    trustAccountId: string,
    statementId: string,
    attempt: { readonly current: boolean },
  ): Promise<void> {
    const outcome = await listTrustBankStatements(fetchImpl, trustAccountId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.statement =
        outcome.value.statements.find((statement) => statement.id === statementId) ?? null;
      this.statementFailure = null;
      return;
    }
    this.statement = null;
    this.statementFailure = outcome.failure;
  }

  async #readSuggestions(
    fetchImpl: typeof fetch,
    reconciliationId: string,
    attempt: { readonly current: boolean },
  ): Promise<void> {
    const outcome = await readTrustReconciliationSuggestions(fetchImpl, reconciliationId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.suggestions = outcome.value;
      this.suggestionsFailure = null;
      return;
    }
    this.suggestions = null;
    this.suggestionsFailure = outcome.failure;
  }

  async #readMatches(
    fetchImpl: typeof fetch,
    reconciliationId: string,
    attempt: { readonly current: boolean },
  ): Promise<void> {
    const outcome = await listTrustReconciliationMatches(fetchImpl, reconciliationId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.matches = outcome.value.matches;
      this.matchesFailure = null;
      return;
    }
    this.matches = null;
    this.matchesFailure = outcome.failure;
  }
}
