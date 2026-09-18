/*
 * Everything the matter's Trust section reads, in one place.
 *
 * THE ACCOUNT COMES FIRST, BECAUSE EVERYTHING ELSE TAKES IT. A matter's trust ledger is read
 * against one of the firm's trust accounts (trust-api.ts), so the roster is this section's first
 * read; the chosen account then decides the ledger read and the pending-request read, and a reader
 * who changes the account changes both. The rule for choosing it is its own pure module
 * (trust-account-choice.ts), so the shape the whole section takes can be read without a browser.
 *
 * A MATTER WITH NO LEDGER YET IS A FACT, NOT A FAILURE. The leaf is created by the first deposit,
 * so a matter that has never received client money into this account answers 404 — and the section
 * says so in a line and keeps every other part of itself, rather than showing a failure screen for
 * a matter nothing is wrong with.
 *
 * ONE FAILURE, WITH ITS EVIDENCE KEPT. The two reads that decide whether the section can be shown
 * hold the failing request, the answer, the moment and the correlation handle, because those are
 * what a person needs to report it. The pending-request read is not one of them: a queue that
 * could not be read is a band that says so, not a screen that goes away.
 */
import type { ApiOutcome, Failure } from "$lib/api/request.ts";
import { LatestOnly } from "$lib/api/latest-only.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
import {
  isNoLedgerYet,
  listPendingTrustRequests,
  listTrustAccounts,
  readMatterTrustLedger,
  type TrustAccountListing,
  type TrustMatterLedger,
  type TrustMovementRecord,
  type TrustPendingRequest,
} from "./trust-api.ts";
import { chooseTrustAccount, trustAccountPreference } from "./trust-account-choice.ts";
import { pendingRequestsOnLedger } from "./trust-write-requests.ts";

/** What went wrong, with the evidence a report needs, and this section's own words for it. */
export interface TrustReadFailure {
  readonly failure: Failure;
  /** This read's own words, used only where the server offered none. */
  readonly whenSilent: string;
}

function failureFrom(outcome: ApiOutcome<unknown>, whenSilent: string): TrustReadFailure | null {
  return outcome.kind === "ok" ? null : { failure: outcome.failure, whenSilent };
}

export class MatterTrust {
  /** The firm's trust accounts. Empty and read is a firm that has opened none. */
  accounts = $state<readonly TrustAccountListing[]>([]);
  /** Whether the roster read has landed, so "none yet" is not confused with "not read". */
  accountsRead = $state(false);
  /** Whether the roster stopped short of the whole record: the walk is bounded and says so. */
  accountsCapped = $state(false);
  /** The account this section is reading against, or null where nothing can be chosen. */
  chosenAccountId = $state<string | null>(null);

  /** The ledger read. Null while it is in flight, and null where the matter holds none yet. */
  ledger = $state<TrustMatterLedger | null>(null);
  /** Whether that null means the matter has no ledger in this account rather than an unread one. */
  noLedgerYet = $state(false);
  /** Null until the first read lands: the loading state, distinct from a ledger with no movements. */
  movements = $state<readonly TrustMovementRecord[] | null>(null);

  /** The requests standing against THIS matter's node, oldest first as the queue serves them. */
  pendingRequests = $state<readonly TrustPendingRequest[]>([]);
  /** What to say where the queue itself could not be read. The section still stands. */
  pendingRefusal = $state<string | null>(null);

  failure = $state<TrustReadFailure | null>(null);

  /** An answer from a superseded load is discarded rather than written under the new subject. */
  readonly #latest = new LatestOnly();
  #subject: string | null = null;
  #fetchImpl: typeof fetch | null = null;
  #matterId: string | null = null;
  readonly #preference = createPersistedPreference(trustAccountPreference());

  /** The chosen account itself, for the surfaces that need its name, currency and zone. */
  get account(): TrustAccountListing | null {
    const chosen = this.chosenAccountId;
    return chosen === null ? null : (this.accounts.find((one) => one.id === chosen) ?? null);
  }

  /** True when this record is already showing (or reading) the given subject. */
  showing(subject: string): boolean {
    return this.#subject === subject;
  }

  /** Adopt a complete, empty record without reading anything: the sample-matter case. */
  settleEmpty(subject: string): void {
    this.#subject = subject;
    this.#latest.supersede();
    this.accounts = [];
    this.accountsRead = true;
    this.accountsCapped = false;
    this.chosenAccountId = null;
    this.ledger = null;
    this.noLedgerYet = false;
    this.movements = [];
    this.pendingRequests = [];
    this.pendingRefusal = null;
    this.failure = null;
  }

  /** The whole section's reads, in the order their answers depend on each other. */
  async load(fetchImpl: typeof fetch, matterId: string, subject: string): Promise<void> {
    this.#subject = subject;
    this.#fetchImpl = fetchImpl;
    this.#matterId = matterId;
    const attempt = this.#latest.begin();
    this.movements = null;
    this.failure = null;
    this.pendingRefusal = null;

    // The names on every movement come from the roster the whole app shares; it is read at most
    // once per page load, and a failure there leaves the identifiers standing rather than the
    // section. Nothing waits on it.
    void firmRoster.load(fetchImpl);

    const rosterOutcome = await listTrustAccounts(fetchImpl);
    if (!attempt.current) return;
    const rosterFailure = failureFrom(
      rosterOutcome,
      "The firm's trust accounts did not load, so this matter's ledger could not be read.",
    );
    if (rosterFailure !== null || rosterOutcome.kind !== "ok") {
      this.failure = rosterFailure;
      this.accounts = [];
      this.accountsRead = true;
      this.movements = [];
      return;
    }

    this.accounts = rosterOutcome.value.accounts;
    this.accountsCapped = rosterOutcome.value.capped;
    this.accountsRead = true;
    this.chosenAccountId = chooseTrustAccount(this.accounts, this.#preference.current);
    await this.#readChosenAccount(attempt);
  }

  /**
   * Read against a different account, and remember it.
   *
   * The memory is per browser and per reader, not per matter: a firm with an account per office has
   * a member who works out of one of them, and asking them to pick it on every matter is asking the
   * same question every time.
   */
  async choose(accountId: string): Promise<void> {
    if (accountId === this.chosenAccountId) return;
    this.#preference.set(accountId);
    this.chosenAccountId = accountId;
    const attempt = this.#latest.begin();
    this.movements = null;
    this.failure = null;
    this.pendingRefusal = null;
    await this.#readChosenAccount(attempt);
  }

  /** The ledger and the queue for whatever account is chosen. Both take the one identifier. */
  async #readChosenAccount(attempt: { readonly current: boolean }): Promise<void> {
    const fetchImpl = this.#fetchImpl;
    const matterId = this.#matterId;
    const accountId = this.chosenAccountId;
    if (fetchImpl === null || matterId === null || accountId === null) {
      // Nothing to read against. The surface states which fact that is from the roster itself.
      this.ledger = null;
      this.noLedgerYet = false;
      this.movements = [];
      this.pendingRequests = [];
      return;
    }

    const [ledgerOutcome, pendingOutcome] = await Promise.all([
      readMatterTrustLedger(fetchImpl, matterId, accountId),
      listPendingTrustRequests(fetchImpl, accountId),
    ]);
    if (!attempt.current) return;

    if (ledgerOutcome.kind === "ok") {
      this.ledger = ledgerOutcome.value;
      this.noLedgerYet = false;
      this.movements = ledgerOutcome.value.movements;
    } else if (isNoLedgerYet(ledgerOutcome)) {
      // The leaf is created by the first deposit. A matter that has not had one is not a failure.
      this.ledger = null;
      this.noLedgerYet = true;
      this.movements = [];
    } else {
      this.failure = failureFrom(ledgerOutcome, "This matter's trust ledger did not load.");
      this.ledger = null;
      this.noLedgerYet = false;
      this.movements = [];
      this.pendingRequests = [];
      return;
    }

    if (pendingOutcome.kind === "ok") {
      this.pendingRequests = pendingRequestsOnLedger(
        pendingOutcome.value.requests,
        this.ledger?.trustLedgerNodeId ?? null,
      );
      this.pendingRefusal = null;
    } else {
      this.pendingRequests = [];
      this.pendingRefusal =
        "The payments waiting on somebody's decision could not be read for this account.";
    }
  }
}
