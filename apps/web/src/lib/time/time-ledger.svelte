<script lang="ts">
  /*
   * The matter's Time ledger: the list is the screen.
   *
   * Three altitudes, and they stay in their places. The LIST is what a person came for. The PANEL
   * beside it is the smaller details, and it opens from its own control alone — clicking a row
   * selects it and does nothing else, which is what lets a reader pick a range without the screen
   * rearranging itself. The RECORD WINDOW is where everything about one entry lives, and it opens by
   * double-click, by the row menu, or by the panel's Open.
   *
   * ONE TABLE. Sorting, the in-header filters, show/hide, drag-reorder, pinning, resize, selection,
   * the totals row, the filtered-empty state and the counts strip are all the product's one grid;
   * this file declares columns and renders cells, and decides none of that behaviour. A gap between
   * this table and any other table in the product would be a defect by definition.
   *
   * THE REVIEW VOCABULARY IS ABSENT, NOT DISABLED. Whether a firm runs review is a firm setting and
   * it is not served, so the lifecycle reads draft to billed, nothing solicits a submission, and no
   * Review control appears. A disabled "Submit" would be soliciting a workflow this firm has not
   * been asked about.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Resizable from "@magna-carta/design-system/resizable";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import Plus from "@lucide/svelte/icons/plus";
  import {
    RecordMenu,
    ledgerRecordMenu,
    type RecordMenuAction,
    type RecordMenuModel,
  } from "$lib/records/index.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import {
    TIME_COLUMN_IDENTIFIERS,
    chargeAmount,
    durationParts,
    isUnservedColumn,
    personInitials,
    timeLedgerColumns,
    timekeeperOf,
    unservedCellTitle,
  } from "./time-columns.ts";
  import { footerFigures, ledgerCurrency } from "./time-figures.ts";
  import TimeDetailsPanel from "./time-details-panel.svelte";
  import TimeRecordWindow from "./time-record-window.svelte";
  import { timeEntrySheet } from "./time-print-sheet.ts";
  import { approveTimeEntry, submitTimeEntry, voidTimeEntry } from "./time-operations.ts";

  let {
    entries,
    matterId,
    matterTitle,
    members,
    sessionUserId,
    loading = false,
    onChanged,
  }: {
    /** Every entry on the matter, in every status: that is what a matter's time record is. */
    entries: readonly TimeEntrySummary[];
    matterId: string;
    matterTitle: string;
    members: readonly FirmMemberSummary[];
    sessionUserId: string | null;
    loading?: boolean;
    /** Something was written; the matter's time wants re-reading. */
    onChanged: () => void;
  } = $props();

  const currency = $derived(ledgerCurrency(entries));
  const money = (amount: number): string => formatMoney(amount, { currency });
  /** What a row's Amount cell says. Nothing charged is a dash, never a zero. */
  const chargeText = (entry: TimeEntrySummary): string => {
    const amount = chargeAmount(entry);
    return amount === null ? "—" : money(amount);
  };

  /* The panel's open state is the reader's, and it survives leaving the tab and coming back. */
  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-time-details-panel", ["open", "closed"] as const, "closed"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  let selectedEntries = $state<readonly TimeEntrySummary[]>([]);
  let windowOpen = $state(false);
  let windowEditing = $state(false);
  let windowEntry = $state<TimeEntrySummary | null>(null);
  let printEntry = $state<TimeEntrySummary | null>(null);
  let printOpen = $state(false);
  let actionFailure = $state<string | null>(null);

  const grid = DataTable.createDataTableGrid<TimeEntrySummary>({
    columns: () => timeLedgerColumns(currency),
    rows: () => entries,
    rowKey: (entry) => entry.id,
    initialSort: { columnId: TIME_COLUMN_IDENTIFIERS.workDate, direction: "descending" },
    itemNoun: { singular: "entry", plural: "entries" },
    // A void stays on the ledger with its chip and counts toward nothing.
    totalIncludes: (entry) => entry.status !== "void",
    onSelectionChange: (_keys, rows) => {
      selectedEntries = rows;
    },
    onActivate: (entry) => {
      openRecord(entry, false);
    },
  });

  /* Whose draft this is to work. Delegated entry is not served, so the timekeeper is the answer. */
  function canWorkDraft(entry: TimeEntrySummary): { allowed: boolean; reason: string } {
    if (entry.status !== "draft") {
      return { allowed: false, reason: statusEntry(entry.status).meaning };
    }
    if (sessionUserId !== null && entry.timekeeperUserId === sessionUserId) {
      return { allowed: true, reason: "Change any part of this draft." };
    }
    return {
      allowed: false,
      reason: `Only ${timekeeperOf(entry)} can edit this draft.`,
    };
  }

  function openRecord(entry: TimeEntrySummary, editing: boolean): void {
    windowEntry = entry;
    windowEditing = editing && canWorkDraft(entry).allowed;
    windowOpen = true;
  }

  function openLogTime(): void {
    windowEntry = null;
    windowEditing = true;
    windowOpen = true;
  }

  function print(entry: TimeEntrySummary): void {
    printEntry = entry;
    printOpen = true;
  }

  /*
   * What the menu speaks for. Right-clicking inside the selection speaks for all of it; right-
   * clicking outside re-targets that one row first, which is what `retargetSelection` does before
   * the menu opens. The scope therefore comes from the selection, and the right-clicked row is only
   * the fallback for the instant before the re-target lands.
   */
  let contextTarget = $state<TimeEntrySummary | null>(null);
  const menuScope = $derived(
    selectedEntries.length > 0
      ? selectedEntries
      : contextTarget === null
        ? []
        : [contextTarget],
  );
  const menu = $derived.by((): RecordMenuModel => {
    const target = menuScope[0];
    if (target === undefined) return [];
    return ledgerRecordMenu(menuScope.map(describeForMenu), describeForMenu(target), {
      recordNoun: { singular: "Time Entry", plural: "Time Entries" },
      // Not served: with the firm's review setting unknown, the review vocabulary stays absent.
      reviewGateEnabled: false,
    });
  });

  /** Re-target the selection to the row under the pointer, without swallowing the menu's own event. */
  function retargetSelection(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest("[data-grid-row]") : null;
    const key = element?.getAttribute("data-grid-row") ?? null;
    if (key === null) return;
    contextTarget = entries.find((entry) => entry.id === key) ?? null;
    if (!grid.isSelected(key)) grid.rowClick(key, { repeated: true });
  }

  function describeForMenu(entry: TimeEntrySummary): {
    identifier: string;
    status: TimeEntrySummary["status"];
    entryNumber: null;
    description: string;
    amount: string;
  } {
    return {
      identifier: entry.id,
      status: entry.status,
      // The matter-scoped entry number is not recorded yet, so nothing offers to copy one.
      entryNumber: null,
      description: entry.narrative,
      amount: chargeAmount(entry) === null ? "No charge" : chargeText(entry),
    };
  }

  async function runMenuAction(action: RecordMenuAction): Promise<void> {
    const targets = menuScope;
    const first = targets[0];
    if (first === undefined) return;
    actionFailure = null;
    switch (action.identifier) {
      case "open":
        openRecord(first, canWorkDraft(first).allowed);
        return;
      case "duplicate":
        // Duplicating starts a new draft from this entry's fields. The window opens on what the
        // listing carries; the category, activity and rate a duplicate should also copy are not
        // served, so there is nothing to copy them from.
        windowEntry = null;
        windowEditing = true;
        windowOpen = true;
        return;
      case "submit":
        await Promise.all(targets.map((entry) => submitTimeEntry(fetch, entry.id)));
        onChanged();
        return;
      case "approve":
        await Promise.all(targets.map((entry) => approveTimeEntry(fetch, entry.id)));
        onChanged();
        return;
      case "kickBack":
        // The settled design makes the reason optional and records it only when given; the route
        // requires one. Rather than inventing a sentence nobody wrote, the act says what stands in
        // its way. It is unreachable while the review vocabulary is absent.
        actionFailure =
          "Kick Back is not wired here yet: the route requires a written reason, and the design " +
          "settled that the reason is optional. The entry is unchanged.";
        return;
      case "void": {
        const outcome = await voidTimeEntry(fetch, first.id);
        if (outcome.kind !== "ok") {
          actionFailure = "The entry was not voided. It is unchanged on the ledger.";
          return;
        }
        onChanged();
        return;
      }
      default:
        return;
    }
  }

  function copyMenuValue(identifier: string): void {
    const entry = selectedEntries[0];
    if (entry === undefined) return;
    const text =
      identifier === "description"
        ? entry.narrative
        : identifier === "amount"
          ? (chargeAmount(entry) === null ? "No charge" : chargeText(entry))
          : "";
    if (text !== "") void navigator.clipboard.writeText(text);
  }

  const figures = $derived(
    footerFigures(grid.isFiltered ? grid.rowsInView : entries, { filtered: grid.isFiltered }),
  );

  const sheet = $derived(
    printEntry === null
      ? null
      : timeEntrySheet(printEntry, {
          matterTitle,
          money,
          date: (isoDate) => formatDate(isoDate),
          printedAt: formatInstant(new Date()),
        }),
  );
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<TimeEntrySummary>)}
  {#if isUnservedColumn(column.id)}
    <span class="text-text-subtle" title={unservedCellTitle(column.id)}>—</span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.timekeeper}
    {@const name = timekeeperOf(row)}
    <span class="inline-flex items-center gap-8 whitespace-nowrap">
      <span
        class="inline-flex size-20 items-center justify-center rounded-full bg-surface-raised text-xs text-text-muted"
        aria-hidden="true">{personInitials(name)}</span
      >
      {name}
    </span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.description}
    <span class="block truncate" title={row.narrative}>{row.narrative}</span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.worked || column.id === TIME_COLUMN_IDENTIFIERS.hours}
    {@const parts = durationParts(
      column.id === TIME_COLUMN_IDENTIFIERS.worked ? row.rawDurationMinutes : row.durationMinutes,
    )}
    <span class="whitespace-nowrap tabular-nums">
      {parts.decimal}
      <span class="text-xs text-text-muted">{parts.clock}</span>
    </span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.amount}
    <span class="whitespace-nowrap tabular-nums">{chargeText(row)}</span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.billable}
    {#if row.billable}
      Yes
    {:else}
      <span class="text-text-muted">No</span>
    {/if}
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.status}
    <Badge {...statusBadgeAttributes(row.status)}>{statusEntry(row.status).label}</Badge>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.workDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.workDate)}</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet emptyLedger()}
  <EmptyState title="No Time Recorded Yet">
    Timers, manual entries and the weekly grid all land here, billable or not.
    {#snippet actions()}
      <Button onclick={openLogTime}>
        <Plus class="size-16" aria-hidden="true" />
        Log Time
      </Button>
    {/snippet}
  </EmptyState>
{/snippet}

{#snippet footerEnd()}
  {#if grid.isFiltered}
    <span class="text-text-link" title="Figures over the rows in view only">In view:</span>
  {/if}
  {#each figures as figure, index (figure.identifier)}
    {#if index > 0}<span aria-hidden="true">·</span>{/if}
    <span class="inline-flex items-baseline gap-4" title={figure.caption}>
      <span class="text-text-subtle">{figure.label}</span>
      <span class="font-semibold tabular-nums">{money(figure.amountMinor / 100)}</span>
    </span>
  {/each}
{/snippet}

<section class="flex min-h-0 flex-col gap-12">
  <div class="flex flex-wrap items-center justify-end gap-8">
    {#if grid.isFiltered}
      <Button
        variant="secondary"
        size="sm"
        title="Clear all filters and show all {grid.totalRowCount} entries"
        onclick={() => grid.clearAllFilters()}
      >
        <FunnelX class="size-16" aria-hidden="true" />
        Clear Filters
      </Button>
    {/if}
    <Button size="sm" title="Record time on this matter. It saves as a draft." onclick={openLogTime}>
      <Plus class="size-16" aria-hidden="true" />
      Log Time
    </Button>
    <DataTable.GridColumnsMenu {grid} />
    <Button
      variant="secondary"
      size="icon"
      aria-pressed={panelOpen}
      title="Show or hide the details panel"
      aria-label="Show or hide the details panel"
      onclick={() => panelPreference.set(panelOpen ? "closed" : "open")}
    >
      <PanelRight class="size-16" aria-hidden="true" />
    </Button>
  </div>

  {#if actionFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>Nothing Changed</Alert.Title>
      <Alert.Description>{actionFailure}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="min-h-0 flex-1">
    <Resizable.PaneGroup direction="horizontal" autoSaveId="matter-time-panes">
      <Resizable.Pane defaultSize={panelOpen ? 72 : 100} minSize={40}>
        <RecordMenu
          {menu}
          onAction={(action) => void runMenuAction(action)}
          onChoice={(_flyout, choice) => copyMenuValue(choice.identifier)}
        >
          <!-- The re-target runs on the way up and does NOT swallow the event, so the menu the
               product uses everywhere is still the thing that opens. The role is presentational:
               this element adds no semantics of its own, it only notices where the pointer was. -->
          <div role="presentation" oncontextmenu={retargetSelection}>
            <!-- The list scrolls inside itself once it is taller than the screen, so a long ledger
                 never pushes its own counts strip out of reach. -->
            <DataTable.Grid
              {grid}
              {cell}
              class="max-h-svh"
              caption="Time recorded on this matter"
              empty={emptyLedger}
              {loading}
            />
          </div>
        </RecordMenu>
      </Resizable.Pane>
      {#if panelOpen}
        <Resizable.Handle withHandle />
        <Resizable.Pane defaultSize={28} minSize={18} maxSize={44}>
          <TimeDetailsPanel
            {entries}
            selected={selectedEntries}
            {currency}
            onOpen={(entry) => openRecord(entry, canWorkDraft(entry).allowed)}
            onPrint={print}
            onLetGo={() => grid.clearSelection()}
          />
        </Resizable.Pane>
      {/if}
    </Resizable.PaneGroup>
  </div>

  <DataTable.GridFooter {grid} end={footerEnd} />
</section>

<TimeRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  entry={windowEntry}
  {matterId}
  {matterTitle}
  {members}
  {sessionUserId}
  {canWorkDraft}
  onSaved={onChanged}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
