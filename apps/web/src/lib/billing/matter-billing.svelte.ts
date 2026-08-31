/*
 * Everything the matter's Billing section reads, in one place.
 *
 * THE READS ARE SHAPED BY WHAT THE CONTRACT SERVES, NOT BY WHAT THE SCREEN WANTS.
 *
 *   - There is no per-matter invoice listing. An invoice belongs to one CLIENT, so the register is
 *     read by client, and this matter's share of each bill comes out of the bill's own detail.
 *   - The client is not on the matter read either. It is resolved from the matter's own party
 *     record — the party wearing the client role — which is also why a matter with no client party
 *     can be read but cannot be billed, and says so rather than offering a control that fails.
 *   - The listing carries no lines and no balances, so each bill's detail is read after it. That is
 *     an N-plus-one and it is deliberate for now: nothing serves a batch detail read, and a register
 *     that showed a client-wide list without this matter's share of each bill would state figures
 *     that are true of the documents and false of the matter.
 *
 * ONE FAILURE, WITH ITS EVIDENCE KEPT. A failed read holds the failing request, the answer, the
 * moment and the correlation handle, because those are what a person needs to report it and what
 * support needs to find it. Collapsing them into one sentence throws all of that away.
 */
import type { ApiOutcome } from "$lib/api/request.ts";
import { listMatterParties } from "$lib/matters/party-api.ts";
import { listMatterCosts, type CostSummary } from "$lib/matters/cost-api.ts";
import { listMatterTimeEntries, type TimeEntrySummary } from "$lib/matters/time-api.ts";
import {
  listClientCredits,
  listClientInvoices,
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

/** What went wrong, with the evidence a report needs. */
export interface BillingReadFailure {
  readonly detail: string;
  readonly request: string;
  readonly status: number | null;
  readonly errorId: string | null;
  readonly failedAt: Date;
}

function failureFrom(
  outcome: ApiOutcome<unknown>,
  request: string,
  whenSilent: string,
): BillingReadFailure | null {
  if (outcome.kind === "ok") return null;
  if (outcome.kind === "transport") {
    return {
      detail: `Nothing answered. ${whenSilent}`,
      request,
      status: null,
      errorId: null,
      failedAt: new Date(),
    };
  }
  return {
    detail: outcome.problem.detail ?? whenSilent,
    request,
    status: outcome.problem.status,
    errorId: outcome.problem.errorId ?? null,
    failedAt: new Date(),
  };
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
      const client = partiesOutcome.value.parties.find(
        (party) => party.role.toLowerCase().replace(/[^a-z]/g, "") === "client",
      );
      this.clientEntityId = client?.entityId ?? null;
      this.clientName = client?.displayName ?? null;
    }

    // The agreement read is the one whose failure means the section cannot be shown: it is the fact
    // the matter owns, and everything else is a list that can honestly be empty.
    const agreementFailure = failureFrom(
      arrangementOutcome,
      `GET /api/v1/billing/matters/${matterId}/arrangement`,
      "The matter's fee record did not load.",
    );
    if (agreementFailure !== null) {
      this.failure = agreementFailure;
      this.rows = [];
      return;
    }

    const clientEntityId = this.clientEntityId;
    if (clientEntityId === null) {
      this.rows = [];
      this.nextCursor = null;
      return;
    }

    const invoicesOutcome = await listClientInvoices(fetchImpl, clientEntityId);
    if (!fresh()) return;
    const invoicesFailure = failureFrom(
      invoicesOutcome,
      `GET /api/v1/billing/invoices?clientEntityId=${clientEntityId}`,
      "The client's bills did not load.",
    );
    if (invoicesFailure !== null || invoicesOutcome.kind !== "ok") {
      this.failure = invoicesFailure;
      this.rows = [];
      return;
    }

    this.nextCursor = invoicesOutcome.value.nextCursor;
    const summaries = invoicesOutcome.value.data.slice(0, DETAIL_PAGE_LIMIT);
    // The rows land before their details do, so the register is readable while the details arrive.
    this.rows = summaries.map((summary) => ({ summary, detail: null, creditNotes: null }));

    const credits = await listClientCredits(fetchImpl, clientEntityId);
    if (!fresh()) return;
    if (credits.kind === "ok") this.clientCredits = credits.value.data;

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
