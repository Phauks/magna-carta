<script lang="ts">
  /*
   * The matter's Fees ledger: the list is the screen.
   *
   * A FEE IS A FLAT CHARGE FOR PROFESSIONAL SERVICES, RECORDED BY HAND. Every row here is a dated
   * work-in-progress record somebody typed — date, timekeeper, description, amount, disposition —
   * riding the same chain as a time entry and a cost, and claimed onto a draft invoice exactly as
   * either of those is. Nothing on this screen is computed from time entries, drawn out of them, or
   * consolidated from them.
   *
   * THE SAME SURFACE AS TIME AND COSTS. One table machinery, one status register, one details
   * panel, one record window, one footer grammar. What this file contributes is the columns, the
   * words and the arrangement strip; every behaviour a reader has learned on the other two ledgers
   * is the behaviour they get here.
   *
   * THREE ALTITUDES, AND THEY STAY IN THEIR PLACES. The LIST is what a person came for. The PANEL
   * beside it is the smaller details, and it opens from its own control alone — clicking a row
   * selects it and does nothing else. The RECORD WINDOW is where everything about one fee lives,
   * and it opens by double-click, by the row menu's Open, and by the panel's Open.
   *
   * THE ARRANGEMENT STRIP IS COMPACTED TO THE FACTS THAT MATTER: which version is in force, since
   * when, and the two verbs. No genre label, no rate-resolution sentence, no recorded-by. The terms
   * and the version history live behind View.
   *
   * NOTHING SERVES A FEE RECORD YET (fee-gaps.ts). The surface is built whole against the record a
   * fee IS, the list stands empty and says why, and every write renders where the design puts it,
   * refused, naming what it waits on.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Eye from "@lucide/svelte/icons/eye";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import { LedgerPanes, RecordMenu } from "$lib/records/index.ts";
  import { ledgerRecordMenu } from "$lib/records/ledger-record-menu.ts";
  import type { LedgerRecord } from "$lib/records/ledger-record-menu.ts";
  import type { RecordMenuAction, RecordMenuModel } from "$lib/records/record-menu-model.ts";
  import ReclassifyDialog from "$lib/records/reclassify-dialog.svelte";
  import { mayReclassify } from "$lib/records/reclassification.ts";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import { BILLING_PERMISSIONS, type ArrangementRecord } from "./billing-api.ts";
  import AmendAgreementDialog from "./amend-agreement-dialog.svelte";
  import ArrangementDialog from "./arrangement-dialog.svelte";
  import FeeDetailsPanel from "./fee-details-panel.svelte";
  import FeeRecordWindow from "./fee-record-window.svelte";
  import {
    FEE_COLUMN_IDENTIFIERS,
    FEE_LEDGER_INITIAL_SORT,
    feeLedgerColumns,
    isUnservedFeeColumn,
    timekeeperText,
    unservedFeeCellTitle,
  } from "./fee-columns.ts";
  import { gapCellTitle, gapReason, REVIEW_GATE_ENABLED } from "./fee-gaps.ts";
  import { feeEntrySheet } from "./fee-print-sheet.ts";
  import {
    billingLabel,
    billingSentence,
    countsInTotals,
    entryNumberTitle,
    feePosition,
    feeStatusKey,
    incompleteNote,
    type FeeRecord,
  } from "./fee-record.ts";

  let {
    fees,
    arrangement,
    loading = false,
    matterId,
    matterTitle,
    matterNumber,
    currency,
    permissions,
    onAmended,
  }: {
    /** Every fee on the matter, in every status: that is what a matter's fee record is. */
    fees: readonly FeeRecord[];
    arrangement: ArrangementRecord | null;
    loading?: boolean;
    matterId: string;
    matterTitle: string;
    matterNumber: string | null;
    currency: string;
    permissions: readonly string[] | null;
    onAmended: (record: ArrangementRecord) => void;
  } = $props();

  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  /* The panel's open state is the reader's, and it survives leaving the tab and coming back. */
  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-fee-details-panel", ["open", "closed"] as const, "open"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  let selectedFees = $state<readonly FeeRecord[]>([]);
  let windowOpen = $state(false);
  let windowEditing = $state(false);
  let windowFee = $state<FeeRecord | null>(null);
  let printFee = $state<FeeRecord | null>(null);
  let printOpen = $state(false);
  let amendOpen = $state(false);
  let arrangementOpen = $state(false);
  let reclassifyFee = $state<FeeRecord | null>(null);
  let reclassifyOpen = $state(false);

  const grid = DataTable.createDataTableGrid<FeeRecord>({
    columns: () => feeLedgerColumns(currency),
    rows: () => fees,
    rowKey: (fee) => fee.id,
    initialSort: FEE_LEDGER_INITIAL_SORT,
    itemNoun: { singular: "fee", plural: "fees" },
    // A void stays on the ledger with its chip, reads quieter, and counts toward nothing.
    totalIncludes: countsInTotals,
    rowMark: (fee) => (fee.status === "void" ? { quiet: true } : undefined),
    onSelectionChange: (_keys, rows) => {
      selectedFees = rows;
    },
    onActivate: (fee) => {
      openRecord(fee, canWorkDraft(fee).allowed);
    },
  });

  const inForce = $derived(arrangement?.inForce ?? null);
  const position = $derived(feePosition(grid.isFiltered ? grid.rowsInView : fees));

  const mayConfigure = $derived(
    permissions === null || permissions.includes(BILLING_PERMISSIONS.configure),
  );
  const amendRefusal = `Amending the fee arrangement needs the ${BILLING_PERMISSIONS.configure} capability, which this account does not hold.`;

  /**
   * Whose draft this is to work.
   *
   * The chain is the honest answer this surface can give: a draft is editable and everything past
   * it is not. The "only the person who recorded it" gate arrives with the recorder on the listing.
   */
  function canWorkDraft(fee: FeeRecord): { allowed: boolean; reason: string } {
    if (fee.status !== "draft") {
      return { allowed: false, reason: statusEntry(feeStatusKey(fee.status)).meaning };
    }
    return { allowed: true, reason: "Change any part of this draft." };
  }

  function openRecord(fee: FeeRecord, editing: boolean): void {
    windowFee = fee;
    windowEditing = editing;
    windowOpen = true;
  }

  /*
   * The one create action this surface has, exported for the section page: the matter header's
   * create control is the only button that opens a blank record here (create-action.svelte.ts),
   * so the ledger keeps no button of its own and answers the header's press instead.
   */
  export function openNew(): void {
    windowFee = null;
    windowEditing = true;
    windowOpen = true;
  }

  function print(fee: FeeRecord): void {
    printFee = fee;
    printOpen = true;
  }

  /*
   * What the menu speaks for. Right-clicking inside the selection speaks for all of it; right-
   * clicking outside re-targets that one row first, so the scope comes from the selection.
   */
  let contextTarget = $state<FeeRecord | null>(null);
  const menuScope = $derived(
    selectedFees.length > 0 ? selectedFees : contextTarget === null ? [] : [contextTarget],
  );

  function describeForMenu(fee: FeeRecord): LedgerRecord {
    return {
      identifier: fee.id,
      status: feeStatusKey(fee.status),
      entryNumber: fee.entryNumber,
      description: fee.description,
      amount: fee.amountMinor === null ? "Not recorded" : money(fee.amountMinor),
    };
  }

  const menu = $derived.by((): RecordMenuModel => {
    const target = menuScope[0];
    if (target === undefined) return [];
    return ledgerRecordMenu(menuScope.map(describeForMenu), describeForMenu(target), {
      recordNoun: { singular: "Fee", plural: "Fees" },
      reviewGateEnabled: REVIEW_GATE_ENABLED,
      reclassify: mayReclassify({
        kind: "fee",
        status: statusEntry(feeStatusKey(target.status)).label.toLowerCase(),
        invoiceNumber: target.invoiceNumber,
        // Nothing serves the claims a draft invoice holds, so the refusal that names one cannot be
        // stated here yet. The move itself is refused for its own missing route either way.
        claimedByDraftInvoice: false,
        mayWork: canWorkDraft(target).allowed,
        workersDescription: "the person who recorded it",
        amountMinor: target.amountMinor,
      }),
    });
  });

  /** Re-target the selection to the row under the pointer, without swallowing the menu's own event. */
  function retargetSelection(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest("[data-grid-row]") : null;
    const key = element?.getAttribute("data-grid-row") ?? null;
    if (key === null) return;
    contextTarget = fees.find((fee) => fee.id === key) ?? null;
    if (!grid.isSelected(key)) grid.rowClick(key, { repeated: true });
  }

  function runMenuAction(action: RecordMenuAction): void {
    const first = menuScope[0];
    if (first === undefined) return;
    switch (action.identifier) {
      case "open":
        openRecord(first, canWorkDraft(first).allowed);
        return;
      case "duplicate":
        // Duplicating starts a new draft from this fee's fields. Until a fee store exists, the
        // window opens on a blank draft rather than one pre-filled from a record nothing can copy.
        openNew();
        return;
      case "reclassify":
        reclassifyFee = first;
        reclassifyOpen = true;
        return;
      case "print":
        print(first);
        return;
      default:
        return;
    }
  }

  function copyMenuValue(identifier: string): void {
    const fee = menuScope[0];
    if (fee === undefined) return;
    const text =
      identifier === "entryNumber"
        ? (fee.entryNumber ?? "")
        : identifier === "description"
          ? fee.description
          : fee.amountMinor === null
            ? ""
            : money(fee.amountMinor);
    if (text !== "") void navigator.clipboard.writeText(text);
  }

  const sheet = $derived(
    printFee === null
      ? null
      : feeEntrySheet(printFee, {
          matterTitle,
          matterNumber,
          money: (amount) => formatMoney(amount, { currency }),
          date: (isoDate) => formatDate(isoDate),
          printedAt: formatInstant(new Date()),
        }),
  );
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<FeeRecord>)}
  {#if isUnservedFeeColumn(column.id) && column.id !== FEE_COLUMN_IDENTIFIERS.entryNumber}
    <span class="text-text-subtle" title={unservedFeeCellTitle(column.id)}>&mdash;</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.feeDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.feeDate)}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.entryNumber}
    {#if row.entryNumber === null}
      <span class="text-text-subtle" title={gapCellTitle("entryNumber")}>&mdash;</span>
    {:else}
      <span class="whitespace-nowrap tabular-nums" title={entryNumberTitle(row)}>
        {row.entryNumber}
      </span>
    {/if}
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.timekeeper}
    <span class="block truncate">{timekeeperText(row)}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.description}
    <span class="block truncate" title={row.description}>{row.description}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.amount}
    {#if row.incomplete || row.amountMinor === null}
      <span class="whitespace-nowrap text-status-warning-subtle-foreground" title={incompleteNote(row)}>
        Needs an amount
      </span>
    {:else}
      <span class="whitespace-nowrap tabular-nums">{money(row.amountMinor)}</span>
    {/if}
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

{#snippet emptyLedger()}
  <EmptyState title="No Fees Recorded Yet">
    Flat charges for professional services land here &mdash; recorded by hand, and billed like any
    other work in progress. A fee is never computed from time entries. New Fee, at the top of the
    matter, records the first.
  </EmptyState>
{/snippet}

{#snippet footerEnd()}
  {#if grid.isFiltered}
    <span class="text-text-link" title="Figures over the rows in view only">In view:</span>
  {/if}
  <span
    class="inline-flex items-baseline gap-4"
    title="Billable fees no finalized invoice has taken up. A draft bill claims them on the Bills tab."
  >
    <span class="text-text-subtle">unbilled</span>
    <span class="font-semibold tabular-nums">{money(position.unbilledMinor)}</span>
  </span>
  <span aria-hidden="true">·</span>
  <span
    class="inline-flex items-baseline gap-4"
    title="Fees a finalized invoice has taken up."
  >
    <span class="text-text-subtle">billed</span>
    <span class="font-semibold tabular-nums">{money(position.billedMinor)}</span>
  </span>
{/snippet}

<section class="flex min-h-0 flex-1 flex-col gap-12">
  <!--
    ONE ROW. The arrangement's facts lead and every verb this screen has trails them: View and Amend
    read and change the arrangement, and the pane toggle ends the row as it does on every ledger.
    Two rows split one set of controls across two lines and spent a row of the screen saying
    nothing — the arrangement is a strip of facts, not a section with a toolbar of its own.
    Recording a fee is the matter header's New Fee, not a button here (create-action.svelte.ts).
  -->
  <div class="flex flex-wrap items-center gap-8 text-sm">
    {#if inForce === null}
      <span class="text-text-muted">
        No arrangement recorded &mdash; this matter is billed hourly.
      </span>
    {:else}
      <span>Arrangement <span class="font-semibold tabular-nums">v{inForce.version}</span></span>
      <span aria-hidden="true" class="text-text-subtle">·</span>
      <span class="text-text-muted">
        in force since <span class="tabular-nums">{formatDate(inForce.validFrom)}</span>
      </span>
    {/if}
    <span class="flex flex-1 flex-wrap items-center justify-end gap-8">
      {#if grid.isFiltered}
        <Button
          variant="secondary"
          size="sm"
          title="Clear all filters and show all {grid.totalRowCount} fees"
          onclick={() => grid.clearAllFilters()}
        >
          <FunnelX class="size-16" aria-hidden="true" />
          Clear Filters
        </Button>
      {/if}
      <Button
        variant="secondary"
        size="sm"
        title="The arrangement in force: what it is billed as, its terms, and every prior version"
        onclick={() => (arrangementOpen = true)}
      >
        <Eye class="size-16" aria-hidden="true" />
        View
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!mayConfigure}
        title={mayConfigure
          ? "Record an amendment as a new version. The version in force stays on the record with the dates it governed."
          : amendRefusal}
        onclick={() => (amendOpen = true)}
      >
        <SquarePen class="size-16" aria-hidden="true" />
        Amend
      </Button>
      <!-- The pane toggle is the file manager's, to the glyph: a quiet chrome affordance with no
           border of its own, and last in the row on every ledger. -->
      <Button
        variant="ghost"
        size="icon"
        aria-pressed={panelOpen}
        title="Show or hide the details panel"
        aria-label="Show or hide the details panel"
        onclick={() => panelPreference.set(panelOpen ? "closed" : "open")}
      >
        <PanelRight class="size-16" aria-hidden="true" />
      </Button>
    </span>
  </div>

  <!-- The one honest line about why this ledger stands empty: the record it lists is not served. -->
  <p class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
    <MaturityBadge stage="soon" />
    {soonDependencySentence(gapReason("store"))}
  </p>

  <LedgerPanes autoSaveId="matter-fees-panes" {panelOpen}>
    {#snippet list()}
      <RecordMenu
        class="flex min-h-0 flex-1 flex-col"
        {menu}
        onAction={runMenuAction}
        onChoice={(_flyout, choice) => copyMenuValue(choice.identifier)}
      >
        <!-- The re-target runs on the way up and does NOT swallow the event, so the menu the
             product uses everywhere is still the thing that opens. -->
        <div class="flex min-h-0 flex-1 flex-col" role="presentation" oncontextmenu={retargetSelection}>
          <DataTable.Grid
            {grid}
            {cell}
            class="min-h-0 flex-1"
            caption="Fees recorded on this matter"
            empty={emptyLedger}
            {loading}
          />
        </div>
      </RecordMenu>
    {/snippet}
    {#snippet panel()}
      <FeeDetailsPanel
        {fees}
        selected={selectedFees}
        {arrangement}
        {money}
        onOpen={(fee) => openRecord(fee, canWorkDraft(fee).allowed)}
        onPrint={print}
        onViewArrangement={() => (arrangementOpen = true)}
        onLetGo={() => grid.clearSelection()}
      />
    {/snippet}
  </LedgerPanes>

  <DataTable.GridFooter {grid} end={footerEnd} />
</section>

<FeeRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  fee={windowFee}
  {matterTitle}
  {matterNumber}
  {currency}
  {canWorkDraft}
/>

{#if reclassifyFee !== null}
  <ReclassifyDialog
    bind:open={reclassifyOpen}
    from="fee"
    entryNumber={reclassifyFee.entryNumber}
    description={reclassifyFee.description}
    amountMinor={reclassifyFee.amountMinor}
    {money}
    moveDependency={gapReason("reclassify")}
  />
{/if}

<ArrangementDialog
  bind:open={arrangementOpen}
  {arrangement}
  {matterTitle}
  {matterNumber}
  {money}
  canAmend={mayConfigure}
  {amendRefusal}
  onAmend={() => {
    arrangementOpen = false;
    amendOpen = true;
  }}
/>

<AmendAgreementDialog bind:open={amendOpen} {arrangement} {matterId} onRecorded={onAmended} />

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
