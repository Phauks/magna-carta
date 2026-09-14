/*
 * Everything the matter's Billing section reads, in one place.
 *
 * THE REGISTER IS THE MATTER'S OWN, and it is the listing that makes it so. An invoice belongs to a
 * CLIENT and may bill several of that client's matters; asking the listing for this matter answers
 * with the bills that charge it — drafts included — each carrying this matter's own share. The
 * register used to read the client's whole billing history and then read every one of those bills'
 * details to work out the share, which stated the client's account under the matter's heading and
 * cost a request per bill to correct.
 *
 *   - The client is not on the matter read. It is resolved from the matter's own party record — the
 *     party wearing the client role — which is also why a matter with no client party can be read
 *     but cannot be billed, and says so rather than offering a control that fails. The client is
 *     still needed for the credits read and for the drafts a member opens against them; it is no
 *     longer what the register is read by.
 *   - Each bill's detail is still read, because the window a member opens a bill in needs its lines,
 *     its balances and its delivery record. What changed is the size of that fan-out: it is now the
 *     matter's own bills rather than every bill the client has ever been given.
 *
 * ONE FAILURE, WITH ITS EVIDENCE KEPT. A failed read holds the failing request, the answer, the
 * moment and the correlation handle, because those are what a person needs to report it and what
 * support needs to find it. Collapsing them into one sentence throws all of that away.
 */
import type { ApiOutcome, Failure } from "$lib/api/request.ts";
import { listMatterParties } from "$lib/matters/party-api.ts";
import { clientPartyOf } from "./client-party.ts";
import { listMatterCosts, type CostSummary } from "$lib/matters/cost-api.ts";
import { listMatterTimeEntries, type TimeEntrySummary } from "$lib/matters/time-api.ts";
import {
  listClientCredits,
  listInvoices,
  listInvoiceCreditNotes,
  readArrangement,
  readInvoice,
  readMatterUnbilled,
  type ArrangementRecord,
  type ClientCredit,
  type InvoiceListItem,
  type MatterUnbilled,
} from "./billing-api.ts";
import type { InvoiceRow } from "./invoice-standing.ts";

/** How many bills the register reads in detail at once. */
const DETAIL_PAGE_LIMIT = 50;

/**
 * What went wrong, with the evidence a report needs, and this section's own words for it.
 *
 * The evidence used to be reassembled here field by field — request line, status, handle, moment —
 * from an outcome that had already thrown most of it away. It now travels ON the outcome, so all
 * this carries is the sentence to fall back to where the server sent none of its own.
 */
export interface BillingReadFailure {
  readonly failure: Failure;
  /** This read's own words, used only where the server offered none. */
  readonly whenSilent: string;
}

function failureFrom(outcome: ApiOutcome<unknown>, whenSilent: string): BillingReadFailure | null {
  return outcome.kind === "ok" ? null : { failure: outcome.failure, whenSilent };
}

/** Whether a time entry is work a draft bill could still claim. */
function isClaimableTime(entry: TimeEntrySummary): boolean {
  return entry.billable && entry.status !== "billed" && entry.status !== "void";
}

/** Whether a cost is work a draft bill could still claim. */
function isClaimableCost(cost: CostSummary): boolean {
  return cost.billable && cost.status !== "billed" && cost.status !== "void";
}

export class MatterBilling {
  /** Null until the first read lands: the loading state, distinct from a matter with no bills. */
  rows = $state<readonly InvoiceRow[] | null>(null);
  /** Non-null while the client's bills continue past what has been read. */
  nextCursor = $state<string | null>(null);
  failure = $state<BillingReadFailure | null>(null);

  clientEntityId = $state<string | null>(null);
  clientName = $state<string | null>(null);
  arrangement = $state<ArrangementRecord | null>(null);
  unbilled = $state<MatterUnbilled | null>(null);
  clientCredits = $state<readonly ClientCredit[]>([]);
  unbilledTime = $state<readonly TimeEntrySummary[]>([]);
  unbilledCosts = $state<readonly CostSummary[]>([]);

  /** Bumped on every load; an answer from a stale generation is discarded. */
  #generation = 0;
  #subject: string | null = null;

  /** True when this record is already showing (or reading) the given subject. */
  showing(subject: string): boolean {
    return this.#subject === subject;
  }

  /** Adopt a complete, empty record without reading anything: the sample-matter case. */
  settleEmpty(subject: string): void {
    this.#subject = subject;
    this.#generation += 1;
    this.rows = [];
    this.nextCursor = null;
    this.failure = null;
  }

  /** The whole section's reads, in the order their answers depend on each other. */
  async load(fetchImpl: typeof fetch, matterId: string, subject: string): Promise<void> {
    this.#subject = subject;
    this.#generation += 1;
    const generation = this.#generation;
    this.rows = null;
    this.failure = null;

    const fresh = (): boolean => generation === this.#generation;

    // The agreement and the matter's unbilled position do not depend on the client, so they are
    // asked for straight away.
    const [arrangementOutcome, unbilledOutcome, timeOutcome, costOutcome, partiesOutcome] =
      await Promise.all([
        readArrangement(fetchImpl, matterId),
        readMatterUnbilled(fetchImpl, matterId),
        listMatterTimeEntries(fetchImpl, matterId),
        listMatterCosts(fetchImpl, matterId),
        listMatterParties(fetchImpl, matterId),
      ]);
    if (!fresh()) return;

    if (arrangementOutcome.kind === "ok") this.arrangement = arrangementOutcome.value;
    if (unbilledOutcome.kind === "ok") this.unbilled = unbilledOutcome.value;
    if (timeOutcome.kind === "ok") {
      this.unbilledTime = timeOutcome.value.data.filter(isClaimableTime);
    }
    if (costOutcome.kind === "ok") {
      this.unbilledCosts = costOutcome.value.data.filter(isClaimableCost);
    }

    // The client is the party wearing the client role. A matter with none can be read and cannot be
    // billed, which is a fact the surface states rather than a failure.
    if (partiesOutcome.kind === "ok") {
      const client = clientPartyOf(partiesOutcome.value.parties);
      this.clientEntityId = client?.entityId ?? null;
      this.clientName = client?.displayName ?? null;
    }

    // The agreement read is the one whose failure means the section cannot be shown: it is the fact
    // the matter owns, and everything else is a list that can honestly be empty.
    const agreementFailure = failureFrom(
      arrangementOutcome,
      "The matter's fee record did not load.",
    );
    if (agreementFailure !== null) {
      this.failure = agreementFailure;
      this.rows = [];
      return;
    }

    // The register is read by MATTER, so it does not wait on the client resolving: a matter whose
    // party record names nobody still has whatever bills charge it, and the surface says separately
    // that there is nobody to bill NEXT. The client is what the credits read and the draft controls
    // need, and both stand down honestly without one.
    const invoicesOutcome = await listInvoices(fetchImpl, { matterId });
    if (!fresh()) return;
    const invoicesFailure = failureFrom(invoicesOutcome, "This matter's bills did not load.");
    if (invoicesFailure !== null || invoicesOutcome.kind !== "ok") {
      this.failure = invoicesFailure;
      this.rows = [];
      return;
    }

    this.nextCursor = invoicesOutcome.value.nextCursor;
    const summaries = invoicesOutcome.value.data.slice(0, DETAIL_PAGE_LIMIT);
    // The rows land before their details do, and the money columns are already right: the matter's
    // share rides the listing row, so nothing on screen has to wait for a detail to state a figure.
    this.rows = summaries.map((summary) => ({ summary, detail: null, creditNotes: null }));

    const clientEntityId = this.clientEntityId;
    if (clientEntityId !== null) {
      const credits = await listClientCredits(fetchImpl, clientEntityId);
      if (!fresh()) return;
      if (credits.kind === "ok") this.clientCredits = credits.value.data;
    }

    const detailed = await Promise.all(
      summaries.map(async (summary) => this.#readOne(fetchImpl, summary)),
    );
    if (!fresh()) return;
    this.rows = detailed;
  }

  /** One bill's detail, and the credit notes standing beside it. */
  async #readOne(fetchImpl: typeof fetch, summary: InvoiceListItem): Promise<InvoiceRow> {
    const [detailOutcome, notesOutcome] = await Promise.all([
      readInvoice(fetchImpl, summary.id),
      // A draft has none and never will; asking anyway would spend a round trip per draft.
      summary.status === "final"
        ? listInvoiceCreditNotes(fetchImpl, summary.id)
        : Promise.resolve(null),
    ]);
    return {
      summary,
      detail: detailOutcome.kind === "ok" ? detailOutcome.value : null,
      creditNotes:
        notesOutcome === null ? [] : notesOutcome.kind === "ok" ? notesOutcome.value.data : null,
    };
  }
}
