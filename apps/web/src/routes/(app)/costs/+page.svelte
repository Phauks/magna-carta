<script lang="ts">
  /*
   * COSTS — what the firm advanced over a period, across every matter.
   *
   * THE THIRD PLACE A COST IS MET, AND THE ONLY ONE THAT CROSSES MATTERS. A matter's Costs section
   * is that matter's disbursement record; the Billing section is where those costs reach a bill.
   * This is the period — "what did the firm advance this month, and how much of it is still waiting
   * on a bill" — which is the question a bookkeeper asks at a month end and a partner asks before
   * approving a run, and which neither of the other two can answer without visiting matters one at
   * a time.
   *
   * IT WAS NOT A SOON ROW; IT WAS NOT A ROW AT ALL. Costs never had a place in the sidebar's Money
   * group, so the sidebar and the matter disagreed about what Money holds — Time, Billing and Trust
   * on one, Time, Fees, Costs, Billing and Trust on the other. The reason was structural rather
   * than an oversight: `GET /api/v1/costs` answered one matter entire and returned an empty list
   * for anything else, so a firm-wide screen had no read behind it. The `from`/`to` span listing is
   * what made adding the row honest, exactly as the time period listing did for /time.
   *
   * TWO LAYERS OF NARROWING, AND THEY ARE DIFFERENT KINDS. The period and the billable control
   * change WHAT IS ASKED FOR: they re-read, and the answer is the whole record for that scope, page
   * by page. The table's own in-header filters narrow WHAT IS LOADED, and say so while they do it.
   * Keeping the distinction visible is why there is no free-text search box here: a search that
   * quietly covered only the loaded page would tell a reader their word appears nowhere in a month
   * it never looked at.
   *
   * THE SCOPE IS IN THE ADDRESS, so a bookkeeper's month is a link somebody can send, and the
   * screen opens on what the address names.
   *
   * ONE COLUMN SET, TWO ARRANGEMENTS. The columns are the matter ledger's own declaration with the
   * Matter column brought forward (cost-columns.ts), so a cost carries the same words and the same
   * meaning whichever screen a reader found it on.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { parseDate } from "@internationalized/date";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { costStatusKey } from "$lib/matters/cost-api.ts";
  import {
    COST_COLUMN_IDENTIFIERS,
    columnGap,
    costMatterText,
    expenseCodeReading,
    firmCostColumns,
    isUnservedColumn,
    unservedCellTitle,
  } from "$lib/costs/cost-columns.ts";
  import { footerFigures } from "$lib/costs/cost-figures.ts";
  import { ExpenseCodeCatalogue } from "$lib/costs/cost-expense-codes.svelte.ts";
  import CostRecordWindow from "$lib/costs/cost-record-window.svelte";
  import {
    listCostLedgerInPeriod,
    type CostLedgerEntry,
    type CostPeriodScope,
  } from "$lib/costs/cost-operations.ts";
  import { payeeText } from "$lib/costs/cost-vocabulary.ts";
  /*
   * The period arithmetic is the Time Sheet's, reused rather than written a second time: it is pure
   * calendar work — a named span, its label, and the refusal a backwards custom range earns — with
   * no knowledge of time entries in it. Two money screens computing "last month" separately is two
   * chances to disagree about where a month starts.
   */
  import {
    PERIOD_PRESET_IDENTIFIERS,
    customRangeOutcome,
    isScopeShowing,
    scopePreset,
    spanLabel,
    type SheetScope,
  } from "$lib/time/time-sheet-scope.ts";

  /*
   * The firm's first weekday is a firm setting the settings registry will serve. Until it does, the
   * week presets span Monday to Sunday and each label names the days it actually covered — the same
   * interim the Time Sheet and the period ledger hold, deliberately: two surfaces disagreeing about
   * where a week starts is worse than all three being provisional.
   */
  const FIRST_WEEKDAY_OF_THE_FIRMS_WEEK = 1;

  const today = new Date().toISOString().slice(0, 10);

  const expenseCodes = new ExpenseCodeCatalogue();
  let bootstrapped = false;
  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void expenseCodes.load(fetch);
  });

  // ---- the scope: what is asked for --------------------------------------------------------------

  const addressSpan = $derived.by((): SheetScope | null => {
    const from = page.url.searchParams.get("from");
    const to = page.url.searchParams.get("to");
    if (from === null || to === null) return null;
    const outcome = customRangeOutcome(from, to);
    return outcome.kind === "applied" ? outcome.scope : null;
  });

  /* A month, not a week: a cost record is read back at a month end, not day by day as it is captured. */
  const defaultScope = $derived(scopePreset("month", today, FIRST_WEEKDAY_OF_THE_FIRMS_WEEK));
  const scope = $derived(addressSpan ?? defaultScope);

  const BILLING_CHOICES = [
    { value: "all", label: "Billable and absorbed" },
    { value: "true", label: "Billable only" },
    { value: "false", label: "Absorbed only" },
  ] as const;

  const chosenBilling = $derived.by((): boolean | null => {
    const named = page.url.searchParams.get("billable");
    return named === "true" ? true : named === "false" ? false : null;
  });

  function goToScope(next: SheetScope, billable: boolean | null): void {
    const url = new URL(page.url);
    url.searchParams.set("from", next.from);
    url.searchParams.set("to", next.to);
    if (billable === null) url.searchParams.delete("billable");
    else url.searchParams.set("billable", billable ? "true" : "false");
    // Not a navigation: changing the period is not a place in the reader's history, it is the same
    // screen looking at different days, and stacking every adjustment would make Back useless.
    replaceState(url, page.state);
  }

  function applyPreset(preset: SheetScope): void {
    goToScope(preset, chosenBilling);
  }

  let customRangeRefusal = $state<string | null>(null);
  function applyCustomRange(from: string, to: string): void {
    const outcome = customRangeOutcome(from, to);
    if (outcome.kind === "refused") {
      customRangeRefusal = outcome.reason;
      return;
    }
    customRangeRefusal = null;
    applyPreset(outcome.scope);
  }

  // ---- the read ----------------------------------------------------------------------------------

  const list = new PagedList<CostLedgerEntry>("The firm's costs could not be read.");
  const costs = $derived(list.items ?? []);
  /** Bumped after a write, so the period re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  const periodScope = $derived<CostPeriodScope>({
    from: scope.from,
    to: scope.to,
    ...(chosenBilling === null ? {} : { billable: chosenBilling }),
  });

  $effect(() => {
    const query = periodScope;
    const subject = `${query.from}:${query.to}:${String(query.billable ?? "both")}:${String(reloadToken)}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    void list.load((cursor) =>
      listCostLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  });

  function loadMore(): void {
    const query = periodScope;
    void list.loadMore((cursor) =>
      listCostLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  }

  // ---- the table ---------------------------------------------------------------------------------

  /* The currency the period is written in, read off the rows rather than assumed. */
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

  /*
   * Whose draft this is to work — the matter ledger's own rule, held to the same words.
   *
   * The listing does not serve who recorded a cost, so this surface cannot answer "only the person
   * who entered it" the way the design words it. What it can say honestly is what the chain says: a
   * draft is editable and everything past it is not. The recorder gate arrives with the recorder.
   */
  function canWorkDraft(cost: CostLedgerEntry): { allowed: boolean; reason: string } {
    if (cost.status !== "draft") {
      return { allowed: false, reason: statusEntry(costStatusKey(cost.status)).meaning };
    }
    return { allowed: true, reason: "Change any part of this draft." };
  }

  function openRecord(cost: CostLedgerEntry, editing: boolean): void {
    windowEntry = cost;
    windowEditing = editing;
    windowOpen = true;
  }

  /*
   * A cost is captured against a matter, and this screen stands on none — so a new one is started
   * from the matter it belongs to, where the matter is already decided. The screen says so rather
   * than offering a create control that would have to ask which matter first, which is the matter's
   * own Costs section with extra steps.
   */
  const billingLine = $derived(
    chosenBilling === null
      ? "Billable and absorbed"
      : chosenBilling
        ? "Billable only"
        : "Absorbed only",
  );
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
      <span class="block truncate" title={named}>{named}</span>
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

<div class="flex h-full min-h-0 flex-col gap-16 p-24">
  <ScreenHeader title="Costs">
    {#snippet meta()}
      <span>{billingLine} · {spanLabel(scope.from, scope.to)}</span>
    {/snippet}
    {#snippet actions()}
      <!-- The period, then what kind: the two controls that change what is READ sit together. -->
      <Popover.Root>
        <Popover.Trigger
          class={buttonClasses({ variant: "secondary", size: "sm" })}
          title="Choose the days this screen shows"
        >
          <Calendar class="size-16" aria-hidden="true" />
          {scope.label}
          <ChevronDown class="size-16" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Content align="start">
          <div class="flex flex-col gap-12">
            <p class="text-xs text-text-subtle">Show costs incurred</p>
            <div class="flex flex-col items-start gap-4">
              {#each PERIOD_PRESET_IDENTIFIERS as identifier (identifier)}
                {@const preset = scopePreset(identifier, today, FIRST_WEEKDAY_OF_THE_FIRMS_WEEK)}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={isScopeShowing(scope, preset)}
                  onclick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              {/each}
            </div>
            <p class="text-xs text-text-subtle">Custom range</p>
            <DateRangePicker
              value={{ start: parseDate(scope.from), end: parseDate(scope.to) }}
              onValueChange={(range) => {
                const from = range?.start?.toString() ?? "";
                const to = range?.end?.toString() ?? "";
                if (from !== "" && to !== "") applyCustomRange(from, to);
              }}
            />
            <p class="text-xs text-text-muted">
              {customRangeRefusal ??
                "The range applies as you pick it. A preset above returns to a named span."}
            </p>
          </div>
        </Popover.Content>
      </Popover.Root>

      <Select.Root
        type="single"
        items={BILLING_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
        value={chosenBilling === null ? "all" : chosenBilling ? "true" : "false"}
        onValueChange={(next) =>
          goToScope(scope, next === "true" ? true : next === "false" ? false : null)}
        allowDeselect={false}
      >
        <Select.Trigger aria-label="Which costs" class="w-3xs">
          <Select.Value placeholder="Which costs" />
        </Select.Trigger>
        <Select.Content>
          {#each BILLING_CHOICES as choice (choice.value)}
            <Select.Item value={choice.value} label={choice.label} />
          {/each}
        </Select.Content>
      </Select.Root>

      <DataTable.ClearFilters {grid} />
    {/snippet}
  </ScreenHeader>

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
      {#snippet empty()}
        {#if grid.isFiltered}
          <EmptyState title="Nothing Matches That">
            No cost in this period answers to what is asked. Widening the column filters brings the
            period back.
          </EmptyState>
        {:else}
          <EmptyState title="No Costs In This Period">
            Nothing was advanced between {spanLabel(scope.from, scope.to)}. A wider span is one click
            away, and a cost is captured from the matter it was advanced for.
          </EmptyState>
        {/if}
      {/snippet}
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
      <!-- The figures cover what is loaded, and the period is not fully loaded. Saying so is the
           difference between a running subtotal and a number somebody reconciles from. -->
      <p class="text-xs text-text-muted">
        Showing the {costs.length} most recent costs in this period. The figures cover only what is
        loaded, so they are not the period's whole total until every page is read.
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
  {currency}
  {expenseCodes}
  {canWorkDraft}
  onSaved={() => (reloadToken += 1)}
/>
