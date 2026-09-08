<script lang="ts">
  /*
   * FEES — what the firm charged for work done over a period, across every matter.
   *
   * THE SECOND PLACE A FEE IS MET, AND THE ONLY ONE THAT CROSSES MATTERS. A matter's Fees section
   * is that matter's record of the flat charges made on it. This is the period — "what did the firm
   * charge for work done this month, and how much of it is still waiting on a bill" — which neither
   * that section nor the Billing register can answer: the first knows one file, and the second
   * knows only what a bill has already taken up.
   *
   * A FEE IS TYPED, NEVER COMPUTED. Nothing on this screen is drawn out of time entries or worked
   * out from an arrangement. An hourly matter's fee value is its time ledger's and a flat-fee
   * arrangement's is the arrangement's; what is listed here is the third thing — the charge
   * somebody decided on — which is why it needed a store of its own.
   *
   * IT WAS NOT A SOON ROW; IT WAS NOT A ROW AT ALL, for the same structural reason Costs was not:
   * nothing served the record. The sidebar and the matter disagreed about what Money holds, and the
   * fee work-in-progress store is what made adding the row honest rather than aspirational.
   *
   * TWO LAYERS OF NARROWING, AND THEY ARE DIFFERENT KINDS. The period and the billing control
   * change WHAT IS ASKED FOR: they re-read, and the answer is the whole record for that scope, page
   * by page. The table's own in-header filters narrow WHAT IS LOADED, and say so while they do it.
   * That distinction is why there is no free-text search box here: a search quietly covering only
   * the loaded page would tell a reader their word appears nowhere in a month it never looked at.
   *
   * THE SCOPE IS IN THE ADDRESS, so a bookkeeper's month is a link somebody can send.
   *
   * ONE COLUMN SET, TWO ARRANGEMENTS. The columns are the matter ledger's own declaration with the
   * Matter column brought forward (fee-columns.ts), so a fee carries the same words and the same
   * meaning whichever screen a reader found it on. Costs is the working template for every one of
   * these decisions, deliberately: the two screens answer the same shape of question.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Select from "@magna-carta/design-system/select";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import CreateControl from "@magna-carta/design-system/create-control";
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
  import { recorderText } from "$lib/records/work-in-progress-record.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import FeeRecordWindow from "$lib/billing/fee-record-window.svelte";
  import {
    FEE_COLUMN_IDENTIFIERS,
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
  /*
   * The period arithmetic is the Time Sheet's, reused rather than written a third time: it is pure
   * calendar work — a named span, its label, and the refusal a backwards custom range earns — with
   * no knowledge of any ledger in it. Three money screens computing "last month" separately is
   * three chances to disagree about where a month starts.
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
   * interim every other period screen holds, deliberately: two surfaces disagreeing about where a
   * week starts is worse than all of them being provisional.
   */
  const FIRST_WEEKDAY_OF_THE_FIRMS_WEEK = 1;

  const today = new Date().toISOString().slice(0, 10);

  const firmMatters = new FirmMatters();
  let bootstrapped = false;
  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    // The matters are read for the record window's picker alone — every row already names its own
    // matter, resolved by the listing — so the period is read without waiting on them.
    void firmMatters.load(fetch);
  });

  // ---- the scope: what is asked for --------------------------------------------------------------

  const addressSpan = $derived.by((): SheetScope | null => {
    const from = page.url.searchParams.get("from");
    const to = page.url.searchParams.get("to");
    if (from === null || to === null) return null;
    const outcome = customRangeOutcome(from, to);
    return outcome.kind === "applied" ? outcome.scope : null;
  });

  /* A month, not a week: a fee record is read back at a month end, not day by day as it is typed. */
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

  const list = new PagedList<FeeRecord>("The firm's fees could not be read.");
  const fees = $derived(list.items ?? []);
  /** Bumped after a write, so the period re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  const periodScope = $derived<FeePeriodScope>({
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
      listFeeLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  });

  function loadMore(): void {
    const query = periodScope;
    void list.loadMore((cursor) =>
      listFeeLedgerInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  }

  // ---- the table ---------------------------------------------------------------------------------

  /* The currency the period is written in, read off the rows rather than assumed. */
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

  const position = $derived(feePosition(grid.isFiltered ? grid.rowsInView : fees));

  /*
   * The two figures this period ends with. The captions are the whole reason the pair is not a bare
   * total: "unbilled" and "billed" are positions in a process, and a reader hovering either needs
   * to know which. Both count billable fees only and neither counts a void.
   */
  const figures = $derived([
    {
      identifier: "unbilled",
      label: "unbilled",
      value: money(position.unbilledMinor),
      caption:
        "Billable fees no finalized invoice has taken up. A draft bill claims them on the matter they charge.",
    },
    {
      identifier: "billed",
      label: "billed",
      value: money(position.billedMinor),
      caption: "Fees a finalized invoice has taken up.",
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

  const billingLine = $derived(
    chosenBilling === null
      ? "Billable and absorbed"
      : chosenBilling
        ? "Billable only"
        : "Absorbed only",
  );
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
            <p class="text-xs text-text-subtle">Show fees for work done</p>
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
        <Select.Trigger aria-label="Which fees" class="w-3xs">
          <Select.Value placeholder="Which fees" />
        </Select.Trigger>
        <Select.Content>
          {#each BILLING_CHOICES as choice (choice.value)}
            <Select.Item value={choice.value} label={choice.label} />
          {/each}
        </Select.Content>
      </Select.Root>

      <CreateControl
        noun="Fee"
        title="Record one flat charge. It saves as a draft on the matter you name."
        refusal={createRefusal}
        onpress={openNew}
      />

      <DataTable.ClearFilters {grid} />
    {/snippet}
  </ScreenHeader>

  {#if firmMatters.failure !== null}
    <!-- The matters are not this screen's subject, so their failure never fails it: every fee below
         is still true, and only the way to record a new one goes quiet. -->
    <Alert.Root variant="warning">
      <Alert.Description>
        {firmMatters.failure} Recording a new fee from here waits on them; a matter's own Fees section
        is unaffected.
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
      {#snippet empty()}
        {#if grid.isFiltered}
          <EmptyState title="Nothing Matches That">
            No fee in this period answers to what is asked. Widening the column filters brings the
            period back.
          </EmptyState>
        {:else}
          <EmptyState title="No Fees In This Period">
            Nothing was charged for work done between {spanLabel(scope.from, scope.to)}. A wider span
            is one click away, and a fee is recorded on the matter it charges.
          </EmptyState>
        {/if}
      {/snippet}
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
      <!-- The figures cover what is loaded, and the period is not fully loaded. Saying so is the
           difference between a running subtotal and a number somebody reconciles from. -->
      <p class="text-xs text-text-muted">
        Showing the {fees.length} most recent fees in this period. The figures cover only what is
        loaded, so they are not the period's whole total until every page is read.
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
