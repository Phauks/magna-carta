<script lang="ts">
  /*
   * FEES — what the firm charged for work done, across every matter.
   *
   * THE SECOND PLACE A FEE IS MET, AND THE ONLY ONE THAT CROSSES MATTERS. A matter's Fees section
   * is that matter's record of the flat charges made on it. This is the firm's — "what did the firm
   * charge for work done this month, and how much of it is still waiting on a bill" — which neither
   * that section nor the Billing register can answer: the first knows one file, and the second
   * knows only what a bill has already taken up.
   *
   * A FEE IS TYPED, NEVER COMPUTED. Nothing on this screen is drawn out of time entries or worked
   * out from an arrangement. An hourly matter's fee value is its time ledger's and a flat-fee
   * arrangement's is the arrangement's; what is listed here is the third thing — the charge
   * somebody decided on — which is why it needed a store of its own.
   *
   * THE TABLE IS THE ONLY THING THAT NARROWS IT. The screen opens on the whole record, most recent
   * service date first, and every narrowing is a column's own filter: Date bounds the period,
   * Status picks a state, Billable picks the charged or the absorbed. The screen used to carry a
   * period dropdown and a billing dropdown in its header, each answering a question a column
   * already asked (the owner's ruling of 2026-09-11, docs/conventions/time-tab-rulings.md round
   * twelve).
   *
   * A COLUMN FILTER THAT ONLY NARROWED THE LOADED PAGE WOULD NOT BE A FILTER. The record is
   * cursor-paged, so the filters the listing honours — the two date bounds, the Status column's
   * whole selection, one billing choice — and the search are sent to it as its own parameters and
   * re-read, and the table's in-browser filter then runs over rows that already match.
   *
   * THE FILTERS ARE IN THE ADDRESS, so a bookkeeper's month is a link somebody can send.
   *
   * ONE COLUMN SET, TWO ARRANGEMENTS. The columns are the matter ledger's own declaration with the
   * Matter column brought forward (fee-columns.ts), so a fee carries the same words and the same
   * meaning whichever screen a reader found it on.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import CreateControl from "@magna-carta/design-system/create-control";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { recorderText } from "$lib/records/work-in-progress-record.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import FeeRecordWindow from "$lib/billing/fee-record-window.svelte";
  import {
    FEE_BILLING_CHOICES,
    FEE_COLUMN_IDENTIFIERS,
    FEE_STATUS_CHOICES,
    firmFeeColumns,
    isUnservedFeeColumn,
    timekeeperText,
    unservedFeeCellTitle,
  } from "$lib/billing/fee-columns.ts";
  import {
    canWorkDraft,
    listFeeLedgerInPeriod,
    type FeePeriodScope,
  } from "$lib/billing/fee-operations.ts";
  import {
    billingLabel,
    billingSentence,
    countsInTotals,
    feeMatterText,
    feePosition,
    feeStatusKey,
    type FeeRecord,
  } from "$lib/billing/fee-record.ts";
  import {
    addressAfterFilters,
    civilDateOrNull,
    dateBoundsOf,
    dateRangeFilter,
    filtersSeededBy,
    choicesFilter,
    choicesOf,
    singleChoiceFilter,
    singleChoiceOf,
  } from "$lib/money/listing-scope.ts";

  const firmMatters = new FirmMatters();
  let bootstrapped = false;
  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    // The matters are read for the record window's picker alone — every row already names its own
    // matter, resolved by the listing — so the record is read without waiting on them.
    void firmMatters.load(fetch);
  });

  // ---- the table ---------------------------------------------------------------------------------

  const list = new PagedList<FeeRecord>("The firm's fees could not be read.");
  const fees = $derived(list.items ?? []);
  /** Bumped after a write, so the record re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  /* The currency the record is written in, read off the rows rather than assumed. */
  const currency = $derived(fees[0]?.currency ?? "USD");
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  const grid = DataTable.createDataTableGrid<FeeRecord>({
    columns: () => firmFeeColumns(currency),
    rows: () => fees,
    rowKey: (fee) => fee.id,
    initialSort: { columnId: FEE_COLUMN_IDENTIFIERS.serviceDate, direction: "descending" },
    itemNoun: { singular: "fee", plural: "fees" },
    // A void stays on the record with its chip, reads quieter, and counts toward nothing.
    totalIncludes: countsInTotals,
    rowMark: (fee) => (fee.status === "void" ? { quiet: true } : undefined),
    onActivate: (fee) => openRecord(fee, canWorkDraft(fee).allowed),
  });

  // ---- the scope: what the columns and the search ask the listing for ---------------------------

  /* The address seeds the filters once, on open, so a linked view opens already narrowed. */
  let seededFromAddress = false;
  $effect(() => {
    if (seededFromAddress) return;
    seededFromAddress = true;
    grid.filters = filtersSeededBy(grid.filters, {
      [FEE_COLUMN_IDENTIFIERS.serviceDate]: dateRangeFilter(
        civilDateOrNull(page.url.searchParams.get("from")),
        civilDateOrNull(page.url.searchParams.get("to")),
      ),
      [FEE_COLUMN_IDENTIFIERS.status]: choicesFilter(
        page.url.searchParams.getAll("status"),
        FEE_STATUS_CHOICES,
      ),
      [FEE_COLUMN_IDENTIFIERS.billable]: singleChoiceFilter(
        page.url.searchParams.get("billable"),
        FEE_BILLING_CHOICES,
      ),
    });
  });

  /*
   * The search is the listing's own, so it reads the whole record rather than the page in the
   * browser; it waits for typing to pause because the read leaves the machine.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  const dateBounds = $derived(dateBoundsOf(grid.filterFor(FEE_COLUMN_IDENTIFIERS.serviceDate)));
  const statusChoices = $derived(
    choicesOf(grid.filterFor(FEE_COLUMN_IDENTIFIERS.status), FEE_STATUS_CHOICES),
  );
  const billingChoice = $derived(
    singleChoiceOf(grid.filterFor(FEE_COLUMN_IDENTIFIERS.billable), FEE_BILLING_CHOICES),
  );

  const scope = $derived<FeePeriodScope>({
    ...dateBounds,
    ...(statusChoices.length === 0 ? {} : { statuses: statusChoices }),
    ...(billingChoice === undefined ? {} : { billable: billingChoice === "true" }),
    ...(appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() }),
  });

  $effect(() => {
    const query = scope;
    const subject = `${JSON.stringify(query)}:${String(reloadToken)}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    void list.load((cursor) =>
      listFeeLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  });

  function loadMore(): void {
    const query = scope;
    void list.loadMore((cursor) =>
      listFeeLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  }

  /*
   * The filters the listing honours ride the address, so the view is a link somebody can send.
   * `replaceState` rather than a navigation: narrowing is not a place in the reader's history, it
   * is the same screen looking at fewer rows, and stacking every adjustment would make Back useless.
   */
  $effect(() => {
    if (!seededFromAddress) return;
    const next = addressAfterFilters(page.url, {
      from: dateBounds.from,
      to: dateBounds.to,
      status: statusChoices,
      billable: billingChoice,
    });
    if (next.href !== page.url.href) replaceState(next, page.state);
  });

  const narrowed = $derived(appliedSearch.trim() !== "" || grid.activeFilterCount > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show every fee"
      : `Showing "${appliedSearch.trim()}" of the record`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid.clearAllFilters();
  }

  const position = $derived(feePosition(grid.isFiltered ? grid.rowsInView : fees));

  /*
   * The two figures the record ends with. The captions are the whole reason the pair is not a bare
   * total: "unbilled" and "billed" are positions in a process, and a reader hovering either needs
   * to know which. Both count billable fees only and neither counts a void.
   */
  const figures = $derived([
    {
      identifier: "unbilled",
      label: "unbilled",
      value: money(position.unbilledMinor),
      caption:
        "Billable fees not yet on a finalized bill. Add them to a draft bill on their matter.",
    },
    {
      identifier: "billed",
      label: "billed",
      value: money(position.billedMinor),
      caption: "Fees on a finalized bill.",
    },
  ]);

  // ---- one fee -----------------------------------------------------------------------------------

  let windowOpen = $state(false);
  let windowEditing = $state(false);
  let windowFee = $state<FeeRecord | null>(null);

  function openRecord(fee: FeeRecord, editing: boolean): void {
    windowFee = fee;
    windowEditing = editing;
    windowOpen = true;
  }

  function openNew(): void {
    windowFee = null;
    windowEditing = true;
    windowOpen = true;
  }

  /*
   * A new fee takes a matter, and this screen is on none — so it can only be started once the
   * firm's matters have arrived for the window's picker to offer. A screen that lists a record and
   * offers no way to add one is a reader for somebody else's data, so the control ships with the
   * surface and says what it is waiting on rather than being absent.
   */
  const createRefusal = $derived.by((): string | undefined => {
    if (firmMatters.matters === null) return "Reading the firm's matters.";
    if (firmMatters.matters.length === 0) {
      return (
        firmMatters.failure ??
        "The firm has no matter to charge a fee to. A fee is billed on a file."
      );
    }
    return undefined;
  });
</script>

<svelte:head><title>Fees · Magna Carta</title></svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<FeeRecord>)}
  {#if isUnservedFeeColumn(column.id)}
    <span class="text-text-subtle" title={unservedFeeCellTitle(column.id)}>&mdash;</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.matter}
    {@const named = feeMatterText(row)}
    <!-- The seam back into the matter: a row read across the firm is one click from the record it
         belongs to, on the section it belongs to. The row's own activation opens the fee, so this
         stops the click reaching it. -->
    <a
      href="/matters/{row.matterId}/fees"
      class="block truncate underline-offset-2 hover:underline"
      title="Open {named} — this matter's own fee record"
      onclick={(event) => event.stopPropagation()}
    >
      {named}
    </a>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.serviceDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.serviceDate)}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.enteredBy}
    <span class="block truncate">{recorderText(row)}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.timekeeper}
    <span class="block truncate">{timekeeperText(row)}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.description}
    <span class="block truncate" title={row.description}>{row.description}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.amount}
    <span class="whitespace-nowrap tabular-nums">{money(row.amountMinor)}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.billable}
    <span class={row.billable ? "" : "text-text-muted"} title={billingSentence(row.billable)}>
      {billingLabel(row.billable)}
    </span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.status}
    <Badge {...statusBadgeAttributes(feeStatusKey(row.status))}>
      {statusEntry(feeStatusKey(row.status)).label}
    </Badge>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Fees">
    {#snippet actions()}
      <!-- The search, then the create control, then the way back to everything: the same row, in
           the same order, as every other list screen. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the firm's fees"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />

      <CreateControl
        noun="Fee"
        title="Record one flat charge. It saves as a draft on the matter you name."
        refusal={createRefusal}
        onpress={openNew}
      />

      <DataTable.ClearFilters
        {grid}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />
    {/snippet}
  </ScreenHeader>

  {#if firmMatters.failure !== null}
    <!-- The matters are not this screen's subject, so their failure never fails it: every fee below
         is still true, and only the way to record a new one goes quiet. -->
    <Alert.Root variant="warning">
      <Alert.Description>
        {firmMatters.failure} You can't record a new fee here until they load. A matter's own Fees section still works.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      title="The Fees Could Not Be Read"
      fallback="The record itself is unaffected: nothing was changed by this failure."
      onRetry={() => (reloadToken += 1)}
    />
  {:else}
    <DataTable.Grid
      {grid}
      {cell}
      class="min-h-0 flex-1"
      caption="Fees recorded across the firm's matters"
      loading={list.items === null}
    >
    </DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <span class="flex flex-wrap items-baseline gap-12">
          <DataTable.GridFigures {grid} {figures} />
          <DataTable.LoadMore
            noun="fees"
            more={list.nextCursor !== null}
            loading={list.loadingMore}
            onLoad={loadMore}
          />
        </span>
      {/snippet}
    </DataTable.GridFooter>

    {#if list.nextCursor !== null}
      <!-- The figures cover what is loaded, and the record is not fully loaded. Saying so is the
           difference between a running subtotal and a number somebody reconciles from. -->
      <p class="text-xs text-text-muted">
        Showing the {fees.length} most recent fees. Totals cover only these until you load more.
      </p>
    {/if}
  {/if}
</div>

<!-- A fee charges the matter it was recorded on, and every row carries its own — so the window opens
     on that matter rather than on one this screen had to choose. -->
<FeeRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  fee={windowFee}
  matterId={windowFee?.matterId ?? ""}
  matterTitle={windowFee?.matterTitle ?? ""}
  matterNumber={windowFee?.matterNumber ?? null}
  matters={firmMatters.matters ?? []}
  mattersCapped={firmMatters.capped}
  {currency}
  {canWorkDraft}
  onSaved={() => (reloadToken += 1)}
/>
