<script lang="ts">
  /*
   * COSTS — what the firm advanced, across every matter.
   *
   * THE THIRD PLACE A COST IS MET, AND THE ONLY ONE THAT CROSSES MATTERS. A matter's Costs section
   * is that matter's disbursement record; the Billing section is where those costs reach a bill.
   * This is the firm's — "what did the firm advance this month, and how much of it is still waiting
   * on a bill" — which is the question a bookkeeper asks at a month end and a partner asks before
   * approving a run, and which neither of the other two can answer without visiting matters one at
   * a time.
   *
   * THE TABLE IS THE ONLY THING THAT NARROWS IT. The screen opens on the whole record, most
   * recently incurred first, and every narrowing is a column's own filter: Date bounds the period,
   * Status picks a state, Billing picks the charged or the absorbed. The screen used to carry a
   * period dropdown and a billing dropdown in its header, each answering a question a column
   * already asked (the owner's ruling of 2026-09-11, docs/conventions/time-tab-rulings.md round
   * twelve).
   *
   * A COLUMN FILTER THAT ONLY NARROWED THE LOADED PAGE WOULD NOT BE A FILTER. The record is
   * cursor-paged, so the filters the listing honours — the two date bounds, the Status column's
   * whole selection, one billing choice — and the search are sent to it as its own parameters and
   * re-read, and the table's in-browser filter then runs over rows that already match.
   *
   * THE FILTERS ARE IN THE ADDRESS, so a bookkeeper's month is a link somebody can send, and the
   * screen opens on what the address names.
   *
   * ONE COLUMN SET, TWO ARRANGEMENTS. The columns are the matter ledger's own declaration with the
   * Matter column brought forward (cost-columns.ts), so a cost carries the same words and the same
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
  import { costStatusKey } from "$lib/matters/cost-api.ts";
  import {
    COST_BILLING_CHOICES,
    COST_COLUMN_IDENTIFIERS,
    COST_STATUS_CHOICES,
    costMatterText,
    expenseCodeReading,
    firmCostColumns,
    isUnservedColumn,
    unservedCellTitle,
  } from "$lib/costs/cost-columns.ts";
  import { footerFigures } from "$lib/costs/cost-figures.ts";
  import { ExpenseCodeCatalogue } from "$lib/costs/cost-expense-codes.svelte.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import CostRecordWindow from "$lib/costs/cost-record-window.svelte";
  import {
    canWorkDraft,
    listCostLedgerInPeriod,
    type CostLedgerEntry,
    type CostPeriodScope,
  } from "$lib/costs/cost-operations.ts";
  import { payeeText } from "$lib/costs/cost-vocabulary.ts";
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

  const expenseCodes = new ExpenseCodeCatalogue();
  const firmMatters = new FirmMatters();
  let bootstrapped = false;
  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void expenseCodes.load(fetch);
    // The matters are read for the record window's picker alone — every row already names its own
    // matter, resolved by the listing — so the record is read without waiting on them.
    void firmMatters.load(fetch);
  });

  // ---- the table ---------------------------------------------------------------------------------

  const list = new PagedList<CostLedgerEntry>("The firm's costs could not be read.");
  const costs = $derived(list.items ?? []);
  /** Bumped after a write, so the record re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  /* The currency the record is written in, read off the rows rather than assumed. */
  const currency = $derived(costs[0]?.currency ?? "USD");
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  const grid = DataTable.createDataTableGrid<CostLedgerEntry>({
    columns: () => firmCostColumns({ currency, expenseCodeLabels: expenseCodes.labelFor }),
    rows: () => costs,
    rowKey: (cost) => cost.id,
    initialSort: { columnId: COST_COLUMN_IDENTIFIERS.incurredDate, direction: "descending" },
    itemNoun: { singular: "cost", plural: "costs" },
    // A void stays on the record with its chip and counts toward nothing.
    totalIncludes: (cost) => cost.status !== "void",
    onActivate: (cost) => openRecord(cost, canWorkDraft(cost).allowed),
  });

  // ---- the scope: what the columns and the search ask the listing for ---------------------------

  /* The address seeds the filters once, on open, so a linked view opens already narrowed. */
  let seededFromAddress = false;
  $effect(() => {
    if (seededFromAddress) return;
    seededFromAddress = true;
    grid.filters = filtersSeededBy(grid.filters, {
      [COST_COLUMN_IDENTIFIERS.incurredDate]: dateRangeFilter(
        civilDateOrNull(page.url.searchParams.get("from")),
        civilDateOrNull(page.url.searchParams.get("to")),
      ),
      [COST_COLUMN_IDENTIFIERS.status]: choicesFilter(
        page.url.searchParams.getAll("status"),
        COST_STATUS_CHOICES,
      ),
      [COST_COLUMN_IDENTIFIERS.billing]: singleChoiceFilter(
        page.url.searchParams.get("billable"),
        COST_BILLING_CHOICES,
      ),
    });
  });

  /*
   * The search is the listing's own, so it reads the whole record rather than the page in the
   * browser; it waits for typing to pause because the read leaves the machine.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  const dateBounds = $derived(dateBoundsOf(grid.filterFor(COST_COLUMN_IDENTIFIERS.incurredDate)));
  const statusChoices = $derived(
    choicesOf(grid.filterFor(COST_COLUMN_IDENTIFIERS.status), COST_STATUS_CHOICES),
  );
  const billingChoice = $derived(
    singleChoiceOf(grid.filterFor(COST_COLUMN_IDENTIFIERS.billing), COST_BILLING_CHOICES),
  );

  const scope = $derived<CostPeriodScope>({
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
      listCostLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  });

  function loadMore(): void {
    const query = scope;
    void list.loadMore((cursor) =>
      listCostLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
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
      ? "Show every cost"
      : `Showing "${appliedSearch.trim()}" of the record`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid.clearAllFilters();
  }

  const figures = $derived(
    footerFigures(grid.isFiltered ? grid.rowsInView : costs, { filtered: grid.isFiltered }).map(
      (figure) => ({
        identifier: figure.identifier,
        label: figure.label,
        value: money(figure.amountMinor),
        caption: figure.caption,
      }),
    ),
  );

  // ---- one cost ----------------------------------------------------------------------------------

  let windowOpen = $state(false);
  let windowEditing = $state(false);
  let windowEntry = $state<CostLedgerEntry | null>(null);

  function openRecord(cost: CostLedgerEntry, editing: boolean): void {
    windowEntry = cost;
    windowEditing = editing;
    windowOpen = true;
  }

  function openNew(): void {
    windowEntry = null;
    windowEditing = true;
    windowOpen = true;
  }

  /*
   * A new cost takes a matter, and this screen is on none — so it can only be started once the
   * firm's matters have arrived for the window's picker to offer. A screen that lists a record and
   * offers no way to add one is a reader for somebody else's data, so the control ships with the
   * surface and says what it is waiting on rather than being absent.
   */
  const createRefusal = $derived.by((): string | undefined => {
    if (firmMatters.matters === null) return "Reading the firm's matters.";
    if (firmMatters.matters.length === 0) {
      return (
        firmMatters.failure ??
        "The firm has no matter to advance a cost for. A cost is recovered from a file."
      );
    }
    return undefined;
  });
</script>

<svelte:head><title>Costs · Magna Carta</title></svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<CostLedgerEntry>)}
  {#if isUnservedColumn(column.id)}
    <span class="text-text-subtle" title={unservedCellTitle(column.id)}>—</span>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.matter}
    {@const named = costMatterText(row)}
    {#if named === ""}
      <!-- The cost is on a matter — the record requires one — but its name did not come back.
           An honest blank, never the raw handle. -->
      <span class="text-text-subtle" title="This matter's name could not be read.">—</span>
    {:else}
      <!-- The seam back into the matter: a row read across the firm is one click from the record it
           belongs to, on the section it belongs to. The row's own activation opens the cost, so this
           stops the click reaching it. -->
      <a
        href="/matters/{row.matterId}/costs"
        class="block truncate underline-offset-2 hover:underline"
        title="Open {named} — this matter's own cost record"
        onclick={(event) => event.stopPropagation()}
      >
        {named}
      </a>
    {/if}
  {:else if column.id === COST_COLUMN_IDENTIFIERS.description}
    <span class="block truncate" title={row.description}>{row.description}</span>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.payee}
    {@const payee = payeeText(row)}
    {#if payee === ""}
      <span class="text-text-subtle" title="No payee was recorded on this cost.">—</span>
    {:else}
      <span class="block truncate" title={payee}>{payee}</span>
    {/if}
  {:else if column.id === COST_COLUMN_IDENTIFIERS.expenseCode}
    {@const reading = expenseCodeReading(row, expenseCodes.labelFor)}
    {#if reading === null}
      <span class="text-text-subtle">—</span>
    {:else}
      <span class="whitespace-nowrap" title={reading.label ?? undefined}>
        {reading.code}
        {#if reading.label !== null}<span class="text-text-muted">{reading.label}</span>{/if}
      </span>
    {/if}
  {:else if column.id === COST_COLUMN_IDENTIFIERS.status}
    <Badge {...statusBadgeAttributes(costStatusKey(row.status))}>
      {statusEntry(costStatusKey(row.status)).label}
    </Badge>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.incurredDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.incurredDate)}</span>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.amount}
    <span class="whitespace-nowrap tabular-nums">{money(row.amountMinor)}</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Costs">
    {#snippet actions()}
      <!-- The search, then the create control, then the way back to everything: the same row, in
           the same order, as every other list screen. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the firm's costs"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />

      <CreateControl
        noun="Cost"
        title="Record one cost. It saves as a draft on the matter you name."
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
    <!-- The matters are not this screen's subject, so their failure never fails it: every cost
         below is still true, and only the way to record a new one goes quiet. -->
    <Alert.Root variant="warning">
      <Alert.Description>
        {firmMatters.failure} You can't record a new cost here until they load. A matter's own Costs section still works.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      title="The Costs Could Not Be Read"
      fallback="The record itself is unaffected: nothing was changed by this failure."
      onRetry={() => (reloadToken += 1)}
    />
  {:else}
    <DataTable.Grid
      {grid}
      {cell}
      class="min-h-0 flex-1"
      caption="Costs advanced across the firm's matters"
      loading={list.items === null}
    >
    </DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <span class="flex flex-wrap items-baseline gap-12">
          <DataTable.GridFigures {grid} {figures} />
          <DataTable.LoadMore
            noun="costs"
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
        Showing the {costs.length} most recent costs. Totals cover only these until you load more.
      </p>
    {/if}
  {/if}
</div>

<!-- A cost belongs to the matter it was advanced for, and every row carries its own — so the window
     opens on that matter rather than on one this screen had to choose. -->
<CostRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  entry={windowEntry}
  matterId={windowEntry?.matterId ?? ""}
  matterTitle={windowEntry?.matterTitle ?? ""}
  matterNumber={windowEntry?.matterNumber ?? null}
  matters={firmMatters.matters ?? []}
  mattersCapped={firmMatters.capped}
  {currency}
  {expenseCodes}
  {canWorkDraft}
  onSaved={() => (reloadToken += 1)}
/>
