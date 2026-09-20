/*
 * What the firm's Trust screen reads, in one place.
 *
 * SEVEN READS, SEVEN FAILURES, AND ONLY ONE OF THEM IS THE SCREEN. The roster of accounts is the
 * screen's subject: without it there is no register and no panel, so its failure is the screen's.
 * The queue, the position, the statements, the reconciliations, the cushion and the firm's posture
 * each answer a different question about ONE account, and a firm whose statements cannot be read
 * still has an approval queue somebody owes an answer to. So each keeps its own failure and its own
 * absence, and a section that cannot be read goes quiet on its own while the rest of the panel
 * stands.
 *
 * EVERY PER-ACCOUNT READ IS GUARDED AGAINST ITS OWN PREDECESSOR. A reader selecting three accounts
 * in quick succession starts three sets of reads, and nothing about the order they come back in is
 * under anyone's control — the slower answer is frequently the first one asked for. Written
 * unguarded, the panel shows the previous account's queue under the current account's name and
 * looks exactly like a panel that loaded correctly. One guard covers the reads that arrive with the
 * selection, because they share one subject: the account selected.
 *
 * THE POSITION CARRIES A GUARD OF ITS OWN, because it is the one read every write asks for again.
 * A deposit into the cushion re-reads the position while the selection's own read may still be in
 * flight, and the figures the reader must end up looking at are the ones asked for AFTER the money
 * moved. Its own guard is what lets the later read supersede the earlier one instead of racing it.
 *
 * A 404 ON THE CUSHION IS AN ANSWER, NOT A FAILURE. The bank-charge carve-out is something a firm
 * opts into, so an account that never opened one answers 404 and the section says the cushion is
 * not open. Rendering that as an error would tell a reader something is broken about an account
 * that is in perfectly good order.
 *
 * THE POSTURE IS THE FIRM'S, NOT AN ACCOUNT'S. It is read once for the screen and does not move
 * when the selection does, which is why it carries its own guard rather than riding the account's.
 */
import type { Failure } from "$lib/api/request.ts";
import { LatestOnly, type ReadAttempt } from "$lib/api/latest-only.ts";
import {
  isCushionNotOpened,
  listPendingTrustRequests,
  listTrustAccounts,
  listTrustBankStatements,
  listTrustReconciliations,
  readTrustAccountPosition,
  readTrustAuthorizationPolicy,
  readTrustFirmFunds,
  type TrustAccountListing,
  type TrustAccountPosition,
  type TrustAuthorizationPolicy,
  type TrustBankStatement,
  type TrustFirmFundsPosition,
  type TrustPendingRequest,
  type TrustReconciliation,
} from "./trust-api.ts";

/** What the cushion read settled to: the position, or the fact that nobody opened one. */
export type TrustCushionReading =
  | { readonly kind: "open"; readonly position: TrustFirmFundsPosition }
  | { readonly kind: "not-opened" };

export class FirmTrust {
  /** The firm's whole roster, or null until the read lands. */
  accounts = $state<readonly TrustAccountListing[] | null>(null);
  /** True where the walk stopped short of the end: these are SOME of the accounts, not all. */
  capped = $state(false);
  accountsFailure = $state<Failure | null>(null);

  /** The selected account's pending requests, oldest first once the model has ordered them. */
  requests = $state<readonly TrustPendingRequest[] | null>(null);
  requestsFailure = $state<Failure | null>(null);

  /** What the selected account holds today: the bank's book balance and what stands against it. */
  position = $state<TrustAccountPosition | null>(null);
  positionFailure = $state<Failure | null>(null);

  statements = $state<readonly TrustBankStatement[] | null>(null);
  statementsFailure = $state<Failure | null>(null);

  reconciliations = $state<readonly TrustReconciliation[] | null>(null);
  reconciliationsFailure = $state<Failure | null>(null);

  cushion = $state<TrustCushionReading | null>(null);
  cushionFailure = $state<Failure | null>(null);

  /** The firm's authorization posture, current version and every version before it. */
  policy = $state<TrustAuthorizationPolicy | null>(null);
  policyFailure = $state<Failure | null>(null);

  #rosterReads = new LatestOnly();
  #accountReads = new LatestOnly();
  #positionReads = new LatestOnly();
  #policyReads = new LatestOnly();

  /** Which account the four per-account reads were last started for. */
  #showing: string | null = null;

  /** One account off the roster, or null where the roster does not hold it (yet, or at all). */
  accountFor(trustAccountId: string | null): TrustAccountListing | null {
    if (trustAccountId === null) return null;
    return (this.accounts ?? []).find((account) => account.id === trustAccountId) ?? null;
  }

  // ---- the roster ------------------------------------------------------------------------------

  /** Read the whole roster. The screen's own read: its failure is the screen's failure. */
  async loadAccounts(fetchImpl: typeof fetch): Promise<void> {
    const attempt = this.#rosterReads.begin();
    const outcome = await listTrustAccounts(fetchImpl);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.accounts = outcome.value.accounts;
      this.capped = outcome.value.capped;
      this.accountsFailure = null;
      return;
    }
    this.accounts = null;
    this.capped = false;
    this.accountsFailure = outcome.failure;
  }

  // ---- one account -----------------------------------------------------------------------------

  /**
   * Read everything the panel says about one account.
   *
   * Calling it again for the account already showing does nothing, so an effect that re-runs
   * because something else on the screen changed does not spend five requests saying the same
   * thing. A reader who wants the queue again after deciding something asks for the queue.
   */
  selectAccount(fetchImpl: typeof fetch, trustAccountId: string | null): void {
    if (trustAccountId === this.#showing) return;
    this.#showing = trustAccountId;
    this.#accountReads.supersede();
    this.#positionReads.supersede();
    this.requests = null;
    this.requestsFailure = null;
    this.position = null;
    this.positionFailure = null;
    this.statements = null;
    this.statementsFailure = null;
    this.reconciliations = null;
    this.reconciliationsFailure = null;
    this.cushion = null;
    this.cushionFailure = null;
    if (trustAccountId === null) return;
    const attempt = this.#accountReads.attempt();
    void this.#readQueue(fetchImpl, trustAccountId, attempt);
    void this.#readStatements(fetchImpl, trustAccountId, attempt);
    void this.#readReconciliations(fetchImpl, trustAccountId, attempt);
    void this.#readCushion(fetchImpl, trustAccountId, attempt);
    void this.#readPosition(fetchImpl, trustAccountId, this.#positionReads.attempt());
  }

  /**
   * Read the queue again, after a decision.
   *
   * It takes the account rather than reading the one it is showing, so a decision made against an
   * account the reader has since moved away from cannot write its answer over the account now on
   * screen: the guard drops it exactly as it drops a superseded first read.
   */
  reloadQueue(fetchImpl: typeof fetch, trustAccountId: string): void {
    if (trustAccountId !== this.#showing) return;
    void this.#readQueue(fetchImpl, trustAccountId, this.#accountReads.attempt());
  }

  /**
   * Read the position again, after anything that moved money on the account.
   *
   * It BEGINS rather than merely attempting: this read is asked for because the figures on screen
   * are known to be out of date, so it must win over a position read that was already in flight
   * when the write landed — which is the one ordering where the older answer is the wrong one.
   */
  reloadPosition(fetchImpl: typeof fetch, trustAccountId: string): void {
    if (trustAccountId !== this.#showing) return;
    void this.#readPosition(fetchImpl, trustAccountId, this.#positionReads.begin());
  }

  /** Read the cushion again, after opening it, funding it or recording a charge against it. */
  reloadCushion(fetchImpl: typeof fetch, trustAccountId: string): void {
    if (trustAccountId !== this.#showing) return;
    void this.#readCushion(fetchImpl, trustAccountId, this.#accountReads.attempt());
  }

  /** Read the statements again, after one was recorded or imported. */
  reloadStatements(fetchImpl: typeof fetch, trustAccountId: string): void {
    if (trustAccountId !== this.#showing) return;
    void this.#readStatements(fetchImpl, trustAccountId, this.#accountReads.attempt());
  }

  /** Read the reconciliations again, after a failed read of them. */
  reloadReconciliations(fetchImpl: typeof fetch, trustAccountId: string): void {
    if (trustAccountId !== this.#showing) return;
    void this.#readReconciliations(fetchImpl, trustAccountId, this.#accountReads.attempt());
  }

  async #readQueue(
    fetchImpl: typeof fetch,
    trustAccountId: string,
    attempt: ReadAttempt,
  ): Promise<void> {
    const outcome = await listPendingTrustRequests(fetchImpl, trustAccountId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.requests = outcome.value.requests;
      this.requestsFailure = null;
      return;
    }
    this.requests = null;
    this.requestsFailure = outcome.failure;
  }

  async #readPosition(
    fetchImpl: typeof fetch,
    trustAccountId: string,
    attempt: ReadAttempt,
  ): Promise<void> {
    const outcome = await readTrustAccountPosition(fetchImpl, trustAccountId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.position = outcome.value;
      this.positionFailure = null;
      return;
    }
    this.position = null;
    this.positionFailure = outcome.failure;
  }

  async #readStatements(
    fetchImpl: typeof fetch,
    trustAccountId: string,
    attempt: ReadAttempt,
  ): Promise<void> {
    const outcome = await listTrustBankStatements(fetchImpl, trustAccountId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.statements = outcome.value.statements;
      this.statementsFailure = null;
      return;
    }
    this.statements = null;
    this.statementsFailure = outcome.failure;
  }

  async #readReconciliations(
    fetchImpl: typeof fetch,
    trustAccountId: string,
    attempt: ReadAttempt,
  ): Promise<void> {
    const outcome = await listTrustReconciliations(fetchImpl, trustAccountId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.reconciliations = outcome.value.reconciliations;
      this.reconciliationsFailure = null;
      return;
    }
    this.reconciliations = null;
    this.reconciliationsFailure = outcome.failure;
  }

  async #readCushion(
    fetchImpl: typeof fetch,
    trustAccountId: string,
    attempt: ReadAttempt,
  ): Promise<void> {
    const outcome = await readTrustFirmFunds(fetchImpl, trustAccountId);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.cushion = { kind: "open", position: outcome.value };
      this.cushionFailure = null;
      return;
    }
    if (isCushionNotOpened(outcome)) {
      this.cushion = { kind: "not-opened" };
      this.cushionFailure = null;
      return;
    }
    this.cushion = null;
    this.cushionFailure = outcome.failure;
  }

  // ---- the firm's posture -----------------------------------------------------------------------

  /**
   * Read the firm's posture again, after a change or after a failed read.
   *
   * It supersedes for the same reason the first read does: the answer a reader must end up looking
   * at is the one asked for LAST, whatever order the two came back in.
   */
  reloadPolicy(fetchImpl: typeof fetch): void {
    void this.loadPolicy(fetchImpl);
  }

  /** Read the firm's authorization posture. Read again after a change, which is why it supersedes. */
  async loadPolicy(fetchImpl: typeof fetch): Promise<void> {
    const attempt = this.#policyReads.begin();
    const outcome = await readTrustAuthorizationPolicy(fetchImpl);
    if (!attempt.current) return;
    if (outcome.kind === "ok") {
      this.policy = outcome.value;
      this.policyFailure = null;
      return;
    }
    this.policy = null;
    this.policyFailure = outcome.failure;
  }
}
