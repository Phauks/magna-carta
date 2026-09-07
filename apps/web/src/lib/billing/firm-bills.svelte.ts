/*
 * What the firm's own billing register reads, in one place.
 *
 * THE LIST IS ONE READ AND THE DETAIL IS ANOTHER, deliberately. A matter's register reads every one
 * of its bills' details up front because the matter has a handful of them and the window is one
 * click from every row. Across the firm the list is the whole record — thousands of documents — so
 * reading each one's detail to fill a table nobody has opened yet would spend a request per row to
 * show what the listing already carries. A bill's detail is read when a reader opens it, and only
 * then.
 *
 * WHAT THE LISTING ALREADY CARRIES is why that works: the total, what has been applied, what is
 * unpaid and the client's name all ride the row, so every column on this screen is right the moment
 * the page lands. The detail adds the lines, the per-matter balances and the delivery record, which
 * are what the window shows and the table does not.
 *
 * THE AGING IS NOT A SUMMARY OF THE ROWS. It is the firm's whole receivable bucketed by how late it
 * is, worked out server-side at the moment of asking over every finalized bill — including the ones
 * past the page on screen. Deriving it from what is loaded would give a figure that grew as a reader
 * scrolled, which is the one thing a receivables number must never do.
 */
import type { Failure } from "$lib/api/request.ts";
import { PagedList } from "$lib/matters/paged-list.svelte.ts";
import {
  listInvoiceCreditNotes,
  listInvoices,
  readInvoice,
  readReceivablesAging,
  type CreditNote,
  type InvoiceDetail,
  type InvoiceListItem,
  type InvoiceListScope,
  type ReceivablesAging,
} from "./billing-api.ts";
import type { InvoiceRow } from "./invoice-standing.ts";

/** The rows the register holds: a listing row, plus whatever of its detail has been read. */
export class FirmBills {
  readonly list = new PagedList<InvoiceListItem>("The firm's bills could not be read.");

  /** The firm's receivables aging, or null until the read lands. Its own failure, kept separately. */
  aging = $state<ReceivablesAging | null>(null);
  agingFailure = $state<Failure | null>(null);

  /**
   * The details read so far, by invoice id. A map rather than a field on each row: the listing is
   * re-read on every scope change and a detail already paid for should survive that.
   *
   * It holds only what the DETAIL adds — the lines, the balances, the delivery record and the credit
   * notes. The summary is always the listing's, so this deliberately does not keep the copy of it
   * the detail read came back with: two summaries for one bill is two answers about what it totals,
   * and the stale one would go back on screen after a re-read.
   */
  #details = $state<
    Record<string, { detail: InvoiceDetail; creditNotes: readonly CreditNote[] | null }>
  >({});

  /** Which bill's detail is in flight, so a second open of the same bill does not ask twice. */
  #reading: string | null = null;

  /** The register's rows: every listing row, carrying its detail where one has been read. */
  get rows(): readonly InvoiceRow[] {
    const items = this.list.items ?? [];
    return items.map((summary) => {
      const read = this.#details[summary.id];
      return read === undefined
        ? { summary, detail: null, creditNotes: null }
        : { summary, detail: read.detail, creditNotes: read.creditNotes };
    });
  }

  /** One bill as the window wants it, with whatever has been read of it. */
  rowFor(invoiceId: string): InvoiceRow | null {
    return this.rows.find((row) => row.summary.id === invoiceId) ?? null;
  }

  /** Read the aging. Its failure never fails the screen: the bills are still true without it. */
  async loadAging(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await readReceivablesAging(fetchImpl);
    if (outcome.kind === "ok") {
      this.aging = outcome.value;
      this.agingFailure = null;
      return;
    }
    this.aging = null;
    this.agingFailure = outcome.failure;
  }

  /** The first page of a scope. `subject` is what tells a re-read from a change of scope. */
  load(fetchImpl: typeof fetch, scope: InvoiceListScope, subject: string): void {
    if (this.list.showing(subject)) return;
    this.list.reset(subject);
    void this.list.load((cursor) =>
      listInvoices(fetchImpl, { ...scope, ...(cursor === undefined ? {} : { cursor }) }),
    );
  }

  /** The next page of the scope already on screen. */
  loadMore(fetchImpl: typeof fetch, scope: InvoiceListScope): void {
    void this.list.loadMore((cursor) =>
      listInvoices(fetchImpl, { ...scope, ...(cursor === undefined ? {} : { cursor }) }),
    );
  }

  /**
   * One bill's detail and the credit notes beside it, read on the gesture that opens it.
   *
   * A failed detail read leaves the row as it was rather than raising a failure over the screen: the
   * window renders what it has and says what it is missing, and the list behind it is unaffected.
   */
  async openDetail(fetchImpl: typeof fetch, invoiceId: string, status: string): Promise<void> {
    if (this.#details[invoiceId] !== undefined || this.#reading === invoiceId) return;
    this.#reading = invoiceId;
    const [detailOutcome, notesOutcome] = await Promise.all([
      readInvoice(fetchImpl, invoiceId),
      // A draft has no credit notes and never will; asking anyway spends a round trip per draft.
      status === "final" ? listInvoiceCreditNotes(fetchImpl, invoiceId) : Promise.resolve(null),
    ]);
    this.#reading = null;
    if (detailOutcome.kind !== "ok") return;
    this.#details = {
      ...this.#details,
      [invoiceId]: {
        detail: detailOutcome.value,
        creditNotes:
          notesOutcome === null ? [] : notesOutcome.kind === "ok" ? notesOutcome.value.data : null,
      },
    };
  }
}
