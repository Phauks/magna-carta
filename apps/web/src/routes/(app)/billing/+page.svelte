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
   * IT WAS A SOON ROW FOR NO REASON, WHICH IS WHY IT SHIPS AS A READ. Time's row was a stub because
   * the listing behind it could not answer a span; billing's listing has always answered without a
   * client named, so the row was announced over a read that already worked. Nothing here is new
   * server work: the invoice listing, the aging buckets and the invoice detail are all shipped
   * routes, and two of them had no consumer at all.
   *
   * THE MONEY COLUMNS ARE THE DOCUMENT'S, NOT A MATTER'S. A bill belongs to a client and may charge
   * several of that client's matters, so across the firm the only honest figures are the bill's own
   * total and what it still owes. The matter's-share pair is declared in the same column set and
   * arrives hidden here, so a stored layout means the same thing on both screens.
   *
   * THE ACTS THAT MOVE ONE MATTER'S MONEY ARE REFUSED HERE, NOT ABSENT. Applying a client's trust
   * funds, writing off a balance and recording a credit note are all a matter's acts, and the
   * refusal names the way through rather than removing the verb — a reader learns where the act
   * lives instead of learning that the menu changes shape between screens.
   *
   * THE SCOPE IS IN THE ADDRESS, so a partner looking at one client's unpaid bills sends that view
   * by sending the link, and an opened bill is a link of its own.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Select from "@magna-carta/design-system/select";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import {
    BILLING_PERMISSIONS,
    type InvoiceListScope,
    type InvoiceStatus,
  } from "$lib/billing/billing-api.ts";
  import {
    BILL_COLUMN_IDENTIFIERS,
    BILL_REGISTER_INITIAL_SORT,
    NOT_APPLICABLE,
    absentShareTitle,
    billColumns,
  } from "$lib/billing/bill-columns.ts";
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

  const today = civilToday();

  // ---- who is asking -----------------------------------------------------------------------------

  let permissions = $state<readonly string[] | null>(null);
  let bootstrapped = false;

  const bills = new FirmBills();

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
    void bills.loadAging(fetch);
  });

  // ---- the scope: what is asked for --------------------------------------------------------------

  /*
   * Only the STATUS rides the address as a control. The client narrowing is the Client column's own
   * filter, which is the same machinery every other column uses and which says how many rows it left
   * out; a second client control in the header would be a second answer to the same question. The
   * status is different because it is what the server narrows, so choosing one changes what is READ
   * rather than what is shown — and a status filter that only looked at the loaded page would report
   * a draft missing from a register it had never finished reading.
   */
  const STATUS_CHOICES = [
    { value: "all", label: "All bills" },
    { value: "draft", label: "Drafts" },
    { value: "final", label: "Finalized" },
    { value: "void", label: "Voided drafts" },
  ] as const;

  const chosenStatus = $derived.by((): InvoiceStatus | null => {
    const named = page.url.searchParams.get("status");
    return named === "draft" || named === "final" || named === "void" ? named : null;
  });

  const scope = $derived<InvoiceListScope>(
    chosenStatus === null ? {} : { status: chosenStatus },
  );

  function chooseStatus(next: string): void {
    const url = new URL(page.url);
    if (next === "all") url.searchParams.delete("status");
    else url.searchParams.set("status", next);
    // Not a navigation: narrowing the register is the same screen looking at fewer bills, and
    // stacking every adjustment on the history would make Back useless.
    replaceState(url, page.state);
  }

  // ---- the read ----------------------------------------------------------------------------------

  /** Bumped after a write, so the register re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  $effect(() => {
    const subject = `${chosenStatus ?? "all"}:${String(reloadToken)}`;
    bills.load(fetch, scope, subject);
  });

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

<div class="flex h-full min-h-0 flex-col gap-16 p-24">
  <ScreenHeader title="Billing">
    {#snippet meta()}
      <span>
        {chosenStatus === null
          ? "Every bill the firm has raised"
          : (STATUS_CHOICES.find((choice) => choice.value === chosenStatus)?.label ?? "")}
        {#if bills.aging !== null}
          · {money(agingTotal)} outstanding as of {formatDate(bills.aging.asOfDate)}
        {/if}
      </span>
    {/snippet}
    {#snippet actions()}
      <Select.Root
        type="single"
        items={STATUS_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
        value={chosenStatus ?? "all"}
        onValueChange={chooseStatus}
        allowDeselect={false}
      >
        <Select.Trigger aria-label="Which bills" class="w-3xs">
          <Select.Value placeholder="Which bills" />
        </Select.Trigger>
        <Select.Content>
          {#each STATUS_CHOICES as choice (choice.value)}
            <Select.Item value={choice.value} label={choice.label} />
          {/each}
        </Select.Content>
      </Select.Root>

      <DataTable.ClearFilters {grid} />
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
      {#snippet empty()}
        {#if grid.isFiltered}
          <EmptyState title="Nothing Matches That">
            No bill in this register answers to what is asked. Widening the column filters brings the
            register back.
          </EmptyState>
        {:else if chosenStatus !== null}
          <EmptyState title="No Bills In That State">
            The firm has raised no bill that is
            {chosenStatus === "draft" ? "still a draft" : chosenStatus === "final" ? "finalized" : "a voided draft"}. Choosing
            All bills above shows the whole register.
          </EmptyState>
        {:else}
          <EmptyState title="No Bills Yet">
            Nothing has been billed. A bill is opened as a draft from the matter it charges, where
            the work it claims lives.
          </EmptyState>
        {/if}
      {/snippet}
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
     * Every act this window offers is either a matter's — refused here with the reason, which names
     * the way through — or one the window itself completes. Nothing reaches this handler on the
     * firm's register, and wiring it to a dialog that needs a matter would be building the act this
     * screen deliberately does not carry.
     */
  }}
  onEditLine={() => {}}
  onClaim={() => {}}
  onClaimAll={() => {}}
/>
