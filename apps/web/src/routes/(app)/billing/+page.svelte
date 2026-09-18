<script lang="ts">
  /*
   * BILLING — every bill the firm has raised, and what the firm is owed.
   *
   * THE FOURTH PLACE A BILL IS MET, AND THE ONLY ONE THAT SEES THEM ALL. A matter's Billing section
   * is that matter's account: the bills that charge it, each carrying its own share, with the acts
   * that move that matter's money. This screen is the firm's: every bill for every client, newest
   * first, with the receivables aging over it. Neither can answer the other's question — a matter's
   * register cannot say what the firm is owed, and no amount of visiting matters one at a time adds
   * up to a receivable a partner can act on.
   *
   * THE TABLE IS THE ONLY THING THAT NARROWS IT. The screen opens on the whole register and the
   * Status column's filter picks the states; the screen used to carry a status dropdown in its
   * header answering the same question (the owner's ruling of 2026-09-11, docs/conventions/time-
   * tab-rulings.md round twelve). A filter that only narrowed the loaded page would report a draft
   * missing from a register it had never finished reading, so the invoice statuses a Status
   * selection reaches are sent to the listing as its own `status` list and re-read; Unpaid,
   * Partially Paid and Paid are all readings of a finalized bill, so any of them asks for the
   * finalized and the table narrows those to the standing chosen.
   *
   * THE SEARCH IS THE PRODUCT'S ONE CONTROL, and it is the listing's own: an invoice number or a
   * client's name is looked for across the whole register, never only in the page in hand.
   *
   * IT STARTS A BILL, AND THE BILL IS BUILT ELSEWHERE. A draft is opened against a matter's client
   * and then built up by claiming that matter's unbilled work, which lives on the matter's own
   * Billing section. So New Bill asks for the matter first, opens the draft, and goes to that
   * section with the draft open — the one screen whose whole subject is a document the firm
   * produces is no longer the one screen with no way to start one.
   *
   * THE MONEY COLUMNS ARE THE DOCUMENT'S, NOT A MATTER'S. A bill belongs to a client and may charge
   * several of that client's matters, so across the firm the only honest figures are the bill's own
   * total and what it still owes. The matter's-share pair is declared in the same column set and
   * arrives hidden here, so a stored layout means the same thing on both screens.
   *
   * IT READS AND DOES NOT ACT ON A BILL, AND EVERY VERB THAT WRITES SAYS SO. Applying a client's
   * trust funds, writing off a balance and recording a credit note each move ONE matter's money
   * against one matter's account and have no meaning without one; finalizing, voiding and recording
   * a delivery simply live where the work does. All of them are refused here rather than removed,
   * and the refusal names the way through.
   *
   * THE SCOPE IS IN THE ADDRESS, so a partner looking at the firm's open drafts sends that view by
   * sending the link, and an opened bill is a link of its own.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { page } from "$app/state";
  import { goto, replaceState } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { BILLING_PERMISSIONS, type InvoiceListScope } from "$lib/billing/billing-api.ts";
  import {
    BILL_COLUMN_IDENTIFIERS,
    BILL_REGISTER_INITIAL_SORT,
    NOT_APPLICABLE,
    absentShareTitle,
    billColumns,
    invoiceStatusesForStandings,
    standingFilterForStatuses,
  } from "$lib/billing/bill-columns.ts";
  import DraftBillDialog from "$lib/billing/draft-bill-dialog.svelte";
  import { FirmBills } from "$lib/billing/firm-bills.svelte.ts";
  import InvoiceWindow from "$lib/billing/invoice-window.svelte";
  import {
    civilToday,
    creditedMinor,
    deliveryReading,
    invoiceReference,
    invoiceStanding,
    overdueDays,
    type InvoiceRow,
  } from "$lib/billing/invoice-standing.ts";
  import { billHref } from "$lib/money/money-sections.ts";
  import { addressAfterFilters, filtersSeededBy } from "$lib/money/listing-scope.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";

  const today = civilToday();

  // ---- who is asking -----------------------------------------------------------------------------

  let permissions = $state<readonly string[] | null>(null);
  let bootstrapped = false;

  const bills = new FirmBills();
  const firmMatters = new FirmMatters();

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
    void bills.loadAging(fetch);
    // The matters are read for the draft dialog's picker alone; the register never waits on them.
    void firmMatters.load(fetch);
  });

  // ---- the table ---------------------------------------------------------------------------------

  const rows = $derived(bills.rows);

  /*
   * The currency the register is written in, read off the bills rather than assumed. Every bill in a
   * firm's register is in one currency today — the invoice contract takes USD only — and reading it
   * off the rows is what keeps the columns and the aging agreeing when that stops being true.
   */
  const currency = $derived(rows[0]?.summary.currency ?? "USD");
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  const grid = DataTable.createDataTableGrid<InvoiceRow>({
    columns: () => billColumns({ scope: { kind: "firm" }, currency }),
    rows: () => rows,
    rowKey: (row) => row.summary.id,
    initialSort: BILL_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "bill", plural: "bills" },
    // A voided draft stays on the register with its chip and counts toward nothing: it never
    // charged anybody anything.
    totalIncludes: (row) => row.summary.status !== "void",
    onActivate: (row) => openBill(row),
  });

  // ---- the scope: what the Status column asks the listing for -----------------------------------

  /* The address seeds the Status filter once, on open, so a linked view opens already narrowed. */
  let seededFromAddress = false;
  $effect(() => {
    if (seededFromAddress) return;
    seededFromAddress = true;
    grid.filters = filtersSeededBy(grid.filters, {
      [BILL_COLUMN_IDENTIFIERS.standing]: standingFilterForStatuses(
        page.url.searchParams.getAll("status"),
      ),
    });
  });

  /*
   * The search is the listing's own, so it reads the whole register rather than the page in the
   * browser; it waits for typing to pause because the read leaves the machine.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  const chosenStatuses = $derived(
    invoiceStatusesForStandings(grid.filterFor(BILL_COLUMN_IDENTIFIERS.standing)),
  );
  const scope = $derived<InvoiceListScope>({
    ...(chosenStatuses.length === 0 ? {} : { statuses: chosenStatuses }),
    ...(appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() }),
  });

  /** Bumped after a write, so the register re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  $effect(() => {
    const subject = `${JSON.stringify(scope)}:${String(reloadToken)}`;
    bills.load(fetch, scope, subject);
  });

  /*
   * The statuses the listing honours ride the address, so the view is a link somebody can send.
   * `replaceState` rather than a navigation: narrowing the register is the same screen looking at
   * fewer bills, and stacking every adjustment on the history would make Back useless.
   */
  $effect(() => {
    if (!seededFromAddress) return;
    const next = addressAfterFilters(page.url, { status: chosenStatuses });
    if (next.href !== page.url.href) replaceState(next, page.state);
  });

  const narrowed = $derived(appliedSearch.trim() !== "" || grid.activeFilterCount > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show every bill"
      : `Showing "${appliedSearch.trim()}" of the register`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid.clearAllFilters();
  }

  // ---- the aging -----------------------------------------------------------------------------

  /*
   * The firm's receivable, bucketed. It sits above the table rather than in the footer figures
   * because it is not a summary of the rows on screen: it is worked out server-side over every
   * finalized bill, including the ones past the page. A figure in the footer strip beside two that
   * DO narrow with the table would invite a reader to add three numbers from three different scopes.
   */
  const agingTotal = $derived(
    (bills.aging?.buckets ?? []).reduce((total, bucket) => total + bucket.unpaidMinor, 0),
  );

  // ---- one bill ------------------------------------------------------------------------------

  let windowOpen = $state(false);
  let openInvoiceId = $state<string | null>(null);

  /* The window follows the bill it was opened on, so a re-read after a write reaches it. */
  const openRow = $derived(openInvoiceId === null ? null : bills.rowFor(openInvoiceId));

  function openBill(row: InvoiceRow): void {
    openInvoiceId = row.summary.id;
    windowOpen = true;
    void bills.openDetail(fetch, row.summary.id, row.summary.status);
    const url = new URL(page.url);
    url.searchParams.set("invoice", row.summary.id);
    replaceState(url, page.state);
  }

  function closeBill(): void {
    openInvoiceId = null;
    const url = new URL(page.url);
    url.searchParams.delete("invoice");
    replaceState(url, page.state);
  }

  /*
   * A bill named in the address opens itself once the listing carries it. This is what makes a bill
   * linkable: a partner sends the address and the recipient lands on the same document, rather than
   * on a register and an instruction to go looking for it.
   */
  let addressOpened: string | null = null;
  $effect(() => {
    const named = page.url.searchParams.get("invoice");
    if (named === null || named === addressOpened) return;
    const row = bills.rowFor(named);
    if (row === null) return;
    addressOpened = named;
    openInvoiceId = named;
    windowOpen = true;
    void bills.openDetail(fetch, named, row.summary.status);
  });

  // ---- starting a bill ---------------------------------------------------------------------------

  let draftOpen = $state(false);

  /*
   * A new bill takes a matter, and this screen is on none — so the dialog asks for one, and it can
   * only be started once the firm's matters have arrived for its picker to offer. The permission is
   * the same one that opens a draft from a matter; a member without it sees the control and the
   * reason, never an absent one.
   */
  const createRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(BILLING_PERMISSIONS.draft)) {
      return permissionRefusal("Opening a draft bill", BILLING_PERMISSIONS.draft);
    }
    if (firmMatters.matters === null) return "Reading the firm's matters.";
    if (firmMatters.matters.length === 0) {
      return firmMatters.failure ?? "The firm has no matter to bill. A bill charges a matter's client.";
    }
    return undefined;
  });

  /** Whether the loaded register already holds a draft for this client, for the dialog's warning. */
  function draftIsOpenFor(clientEntityId: string): boolean {
    return rows.some(
      (row) => row.summary.status === "draft" && row.summary.clientEntityId === clientEntityId,
    );
  }

  /*
   * The draft is built on the matter it charges — its unbilled work is claimed there — so opening
   * one goes to that matter's Billing section with the draft open, where the next act is.
   */
  function draftOpened(invoiceId: string, matterId: string | null): void {
    if (matterId !== null) {
      void goto(billHref(matterId, invoiceId));
      return;
    }
    reloadToken += 1;
  }

  const readRefusal = $derived.by((): string | null => {
    const failure = bills.list.failure;
    if (failure?.problem?.status !== 403) return null;
    return permissionRefusal("Reading the firm's bills", BILLING_PERMISSIONS.read);
  });
</script>

<svelte:head><title>Billing · Magna Carta</title></svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<InvoiceRow>)}
  {#if column.id === BILL_COLUMN_IDENTIFIERS.standing}
    {@const standing = invoiceStanding(row)}
    <Badge {...statusBadgeAttributes(standing)}>{statusEntry(standing).label}</Badge>
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.invoiceNumber}
    <span class="whitespace-nowrap tabular-nums">{invoiceReference(row)}</span>
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.dueDate}
    {@const late = overdueDays(row, today)}
    {#if row.summary.dueDate === null}
      <span class="text-text-subtle">{NOT_APPLICABLE}</span>
    {:else}
      <span
        class="whitespace-nowrap tabular-nums {late > 0
          ? 'font-semibold text-status-danger-subtle-foreground'
          : ''}"
        title={late > 0
          ? "Overdue is worked out from the date at the moment of asking; it is never a stored flag."
          : undefined}
      >
        {formatDate(row.summary.dueDate)}{late > 0 ? ` · ${late} days` : ""}
      </span>
    {/if}
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.billTotal || column.id === BILL_COLUMN_IDENTIFIERS.billUnpaid}
    {#if text === ""}
      <span class="text-text-subtle" title={absentShareTitle(row)}>{NOT_APPLICABLE}</span>
    {:else}
      <span class="whitespace-nowrap tabular-nums">{text}</span>
    {/if}
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.credited}
    {@const credited = creditedMinor(row)}
    <!-- Credit notes ride the DETAIL, which this register reads only when a bill is opened. A row
         nobody has opened says the figure is unread rather than printing a zero, which would read
         as "nothing was ever credited". -->
    {#if row.detail === null}
      <span class="text-text-subtle" title="Read when the bill is opened.">{NOT_APPLICABLE}</span>
    {:else}
      <span class="whitespace-nowrap tabular-nums"
        >{credited === 0 ? NOT_APPLICABLE : money(credited)}</span
      >
    {/if}
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.delivered}
    {@const reading = deliveryReading(row, formatDate)}
    <span class:text-text-subtle={reading.key === "unreadable"} title={reading.title}>
      {reading.text}
    </span>
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.client}
    <span class="block truncate" title={text}>{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Billing">
    {#snippet actions()}
      <!-- The search, then the create control, then the way back to everything: the same row, in
           the same order, as every other list screen. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the firm's bills"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />

      <CreateControl
        noun="Bill"
        title="Open a draft bill on the matter it charges. Its work is claimed on that matter's Billing section."
        refusal={createRefusal}
        onpress={() => (draftOpen = true)}
      />

      <DataTable.ClearFilters
        {grid}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />
    {/snippet}
  </ScreenHeader>

  <!-- The receivable, bucketed by how late it is. Worked out at the moment of asking over every
       finalized bill, so a bill settled this morning is never reported as late. -->
  {#if bills.aging !== null && agingTotal > 0}
    <section
      class="flex flex-wrap items-baseline gap-x-24 gap-y-8 rounded-md border border-border-default bg-surface-raised px-16 py-12"
      aria-label="Receivables aging"
    >
      {#each bills.aging.buckets as bucket (bucket.label)}
        <span class="flex flex-col gap-2">
          <span class="text-xs text-text-subtle">{bucket.label}</span>
          <span class="tabular-nums {bucket.unpaidMinor === 0 ? 'text-text-muted' : ''}">
            {money(bucket.unpaidMinor)}
            <span class="text-xs text-text-muted">
              · {bucket.invoiceCount}
              {bucket.invoiceCount === 1 ? "bill" : "bills"}
            </span>
          </span>
        </span>
      {/each}
    </section>
  {/if}

  {#if bills.agingFailure !== null}
    <!-- The aging is not this screen's subject, so its failure never fails it: every bill below is
         still true and only the strip above goes quiet. -->
    <Alert.Root variant="warning">
      <Alert.Description>
        The receivables aging could not be read, so the strip above is absent. The register itself is
        unaffected.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if bills.list.failure !== null}
    {#if readRefusal !== null}
      <Alert.Root variant="danger">
        <Alert.Title>The Firm's Bills Are Not Yours To Read</Alert.Title>
        <Alert.Description>{readRefusal}</Alert.Description>
      </Alert.Root>
    {:else}
      <FailureNotice
        failure={bills.list.failure}
        title="The Bills Could Not Be Read"
        fallback="The record itself is unaffected: nothing was changed by this failure, and every finalized bill is still on the firm's record."
        onRetry={() => (reloadToken += 1)}
      />
    {/if}
  {:else}
    <DataTable.Grid
      {grid}
      {cell}
      class="min-h-0 flex-1"
      caption="Bills raised across the firm's clients"
      loading={bills.list.items === null}
    >
    </DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="bills"
          more={bills.list.nextCursor !== null}
          loading={bills.list.loadingMore}
          onLoad={() => bills.loadMore(fetch, scope)}
        />
      {/snippet}
    </DataTable.GridFooter>

    {#if bills.list.nextCursor !== null}
      <!-- The column totals cover what is loaded, and the register is not fully loaded. The aging
           strip above is the figure that does not have this caveat, which is exactly why it is
           read from the server rather than added up here. -->
      <p class="text-xs text-text-muted">
        Showing the {rows.length} most recent bills. The column totals cover only what is loaded; the
        outstanding figure above covers the firm's whole receivable.
      </p>
    {/if}
  {/if}
</div>

<DraftBillDialog
  bind:open={draftOpen}
  matters={firmMatters.matters ?? []}
  mattersCapped={firmMatters.capped}
  {draftIsOpenFor}
  onOpened={draftOpened}
/>

<InvoiceWindow
  bind:open={
    () => windowOpen,
    (next) => {
      windowOpen = next;
      if (!next) closeBill();
    }
  }
  row={openRow}
  matterId={null}
  matterTitle={null}
  matterNumber={null}
  clientName={openRow?.summary.clientName ?? "This bill's client"}
  {currency}
  {today}
  actionContext={{
    matterId: null,
    permissions,
    openClientCreditMinor: null,
    money,
  }}
  deliveries={null}
  clientCredits={[]}
  unbilledTime={[]}
  unbilledCosts={[]}
  claiming={null}
  onAction={() => {
    /*
     * Every act that writes is refused on this register, with the reason naming where it lives
     * (bill-actions.ts), so nothing reaches this handler. Wiring it to a dialog would be building
     * the acts this screen deliberately does not carry — and leaving a verb enabled over an empty
     * handler is the inert control the file-manager rulings forbid.
     */
  }}
  onEditLine={() => {}}
  onClaim={() => {}}
  onClaimAll={() => {}}
/>
