/*
 * One matter's trust ledger, read for the surfaces that have to NAME a movement rather than hold a
 * handle for one.
 *
 * ONE READER, TWO SURFACES. The panel that closes a diligence file picks the payment the file
 * closes over, and the window that shows a closed file states the payment it closed over. Both need
 * the same ledger, and a second reader beside this one would be a second place for "what if it
 * failed" and "what if the reader moved on" to drift; the choice a reader picked and the line the
 * window then prints would come from two reads that could disagree.
 *
 * IT IS GUARDED AGAINST ITS OWN PREDECESSOR. A reviewer moving between two quiet ledgers starts two
 * reads, and nothing about the order they come back in is under anyone's control. Written
 * unguarded, the panel offers the previous matter's payments under the current matter's name and
 * looks exactly like a panel that loaded correctly — which on this surface would attach one client's
 * payment to another client's file.
 *
 * ITS FAILURE IS ITS OWN. A window whose ledger cannot be read still holds the observation, the
 * attempts and the outcome somebody opened it to read, so the failure stands in the one row it
 * costs and nowhere else.
 */
import type { Failure } from "$lib/api/request.ts";
import { LatestOnly } from "$lib/api/latest-only.ts";
import {
  isNoLedgerYet,
  readMatterTrustLedger,
  type TrustMatterLedger,
  type TrustMovementRecord,
} from "./trust-api.ts";

export class MatterTrustLedger {
  /** The ledger as it was read, or null while nothing has been read or the read failed. */
  ledger = $state<TrustMatterLedger | null>(null);
  /**
   * True where the account holds no ledger for this matter at all. An answer rather than a failure:
   * the money may have reached the matter through another account.
   */
  noLedgerYet = $state(false);
  failure = $state<Failure | null>(null);
  /** True while a read is in flight. */
  reading = $state(false);

  #reads = new LatestOnly();

  /** Which matter and account the ledger on hand was read for. */
  #showing = "";

  /**
   * Read one matter's ledger in one account.
   *
   * A MATTER WITH NO LEDGER IN THIS ACCOUNT IS AN ANSWER, NOT A FAILURE: the money may have reached
   * the matter through another account, and a ledger that was never opened has no payment to
   * attach. It settles to that fact and the surface says there is nothing to choose, rather than
   * reporting a broken read about a matter in perfectly good order.
   *
   * Asking again for what is already on hand does nothing, so an effect that re-runs because
   * something else on the surface changed does not spend a request saying the same thing.
   */
  read(fetchImpl: typeof fetch, matterId: string | null, trustAccountId: string | null): void {
    const asking =
      matterId === null || trustAccountId === null ? "" : `${matterId}\u0000${trustAccountId}`;
    if (asking === this.#showing) return;
    this.#showing = asking;
    this.#reads.supersede();
    this.ledger = null;
    this.noLedgerYet = false;
    this.failure = null;
    this.reading = false;
    if (matterId === null || trustAccountId === null) return;
    const attempt = this.#reads.attempt();
    this.reading = true;
    void (async () => {
      const outcome = await readMatterTrustLedger(fetchImpl, matterId, trustAccountId);
      if (!attempt.current) return;
      this.reading = false;
      if (outcome.kind === "ok") {
        this.ledger = outcome.value;
        this.noLedgerYet = false;
        this.failure = null;
        return;
      }
      this.ledger = null;
      this.noLedgerYet = isNoLedgerYet(outcome);
      this.failure = this.noLedgerYet ? null : outcome.failure;
    })();
  }

  /** Ask again for whatever was last asked for, after a failure. */
  reread(fetchImpl: typeof fetch, matterId: string | null, trustAccountId: string | null): void {
    this.#showing = "";
    this.read(fetchImpl, matterId, trustAccountId);
  }

  /** One movement off the ledger, or null where the ledger does not hold it (yet, or at all). */
  movement(trustMovementId: string | null): TrustMovementRecord | null {
    if (trustMovementId === null) return null;
    return this.ledger?.movements.find((movement) => movement.id === trustMovementId) ?? null;
  }
}
