<script lang="ts">
  /*
   * The fee ledger: the agreement, and what it has charged.
   *
   * THE CAUSE ABOVE THE EFFECT. The agreement sits in one quiet band across the top; the charge
   * ledger beneath it is the page's subject. The band is not a header for the table — it is the fact
   * that produced every row in it, which is why it carries the one write this surface has.
   *
   * ONE TABLE, THE SAME ONE. This ledger and the bill register run the product's one grid, so a
   * reader who has learned to filter, reorder or pin on one of them has learned it on both.
   *
   * ITS ONE WRITE IS AMEND AGREEMENT. Everything else on this surface is a read: a fee line is
   * invoice evidence, and evidence is corrected beside itself, in the register, as a credit note.
   */
  import * as Card from "@magna-carta/design-system/card";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Resizable from "@magna-carta/design-system/resizable";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import { BILLING_PERMISSIONS, type ArrangementRecord } from "./billing-api.ts";
  import AmendAgreementDialog from "./amend-agreement-dialog.svelte";
  import FeeChargePanel from "./fee-charge-panel.svelte";
  import { feeChargeSheet } from "./fee-charge-print-sheet.ts";
  import {
    ARRANGEMENT_KIND_LABELS,
    arrangementTerms,
  } from "./fee-agreement.ts";
  import {
    FEE_CHARGE_GAPS,
    FEE_KIND_MEANINGS,
    feePosition,
    invoiceStandingLine,
    type FeeCharge,
  } from "./fee-charges.ts";
  import {
    FEE_COLUMN_IDENTIFIERS,
    FEE_LEDGER_INITIAL_SORT,
    NOT_ARRANGEMENT_COMPOSED,
    feeLedgerColumns,
    isUnservedFeeColumn,
  } from "./fee-columns.ts";
  import type { InvoiceRow } from "./invoice-standing.ts";

  let {
    charges,
    rows,
    arrangement,
    unbilledMinor,
    loading = false,
    matterId,
    matterTitle,
    matterNumber,
    currency,
    permissions,
    onShowBill,
    onAmended,
  }: {
    charges: readonly FeeCharge[];
    /** The bills behind the charges, so a charge can read its own standing off the bill it rides. */
    rows: readonly InvoiceRow[];
    arrangement: ArrangementRecord | null;
    unbilledMinor: number;
    loading?: boolean;
    matterId: string;
    matterTitle: string;
    matterNumber: string | null;
    currency: string;
    permissions: readonly string[] | null;
    /** Show one bill in the register beside this ledger. */
    onShowBill: (invoiceId: string) => void;
    onAmended: (record: ArrangementRecord) => void;
  } = $props();

  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-fee-details-panel", ["open", "closed"] as const, "open"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  let selectedCharges = $state<readonly FeeCharge[]>([]);
  let amendOpen = $state(false);
  let printCharge = $state<FeeCharge | null>(null);
  let printOpen = $state(false);

  const grid = DataTable.createDataTableGrid<FeeCharge>({
    columns: () => feeLedgerColumns(currency),
    rows: () => charges,
    rowKey: (charge) => charge.id,
    initialSort: FEE_LEDGER_INITIAL_SORT,
    itemNoun: { singular: "charge", plural: "charges" },
    onSelectionChange: (_keys, selected) => {
      selectedCharges = selected;
    },
  });

  const inForce = $derived(arrangement?.inForce ?? null);
  const position = $derived(
    feePosition(grid.isFiltered ? grid.rowsInView : charges, unbilledMinor),
  );

  const mayConfigure = $derived(
    permissions === null || permissions.includes(BILLING_PERMISSIONS.configure),
  );

  function rowOf(invoiceId: string): InvoiceRow | null {
    return rows.find((row) => row.summary.id === invoiceId) ?? null;
  }

  const sheet = $derived.by(() => {
    const charge = printCharge;
    if (charge === null) return null;
    const row = rowOf(charge.invoiceId);
    return feeChargeSheet(charge, {
      matterTitle,
      matterNumber,
      money,
      date: (isoDate) => formatDate(isoDate),
      invoiceStandingLine:
        row === null
          ? "The bill behind this charge was not read."
          : invoiceStandingLine(row, (isoDate) => formatDate(isoDate)),
      printedAt: formatInstant(new Date()),
    });
  });
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<FeeCharge>)}
  {#if isUnservedFeeColumn(column.id)}
    <span class="text-text-subtle" title="Not built yet. Waiting on {FEE_CHARGE_GAPS.drawnFrom}."
      >—</span
    >
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.kind}
    <span class="whitespace-nowrap" title={FEE_KIND_MEANINGS[row.kind]}>{text}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.narrative}
    <span class="block truncate" title={row.narrative}>{row.narrative}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.arrangement}
    {#if row.arrangementLabel === null}
      <span class="text-text-subtle" title={NOT_ARRANGEMENT_COMPOSED}>—</span>
    {:else}
      <span class="whitespace-nowrap">{row.arrangementLabel}</span>
    {/if}
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.amount}
    <span class="whitespace-nowrap tabular-nums">{text}</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.standing}
    <Badge {...statusBadgeAttributes(row.standing)}>{statusEntry(row.standing).label}</Badge>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.date}
    <span class="whitespace-nowrap tabular-nums">{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet emptyLedger()}
  <EmptyState title="No Fee Charges Yet">
    The matter bills {inForce === null
      ? "hourly, because no agreement was recorded"
      : ARRANGEMENT_KIND_LABELS[inForce.kind].toLowerCase()} under the agreement above. Fee charges
    appear when a draft bill composes them: from unbilled time under an hourly agreement, or from the
    agreement itself for a flat or contingency fee.
  </EmptyState>
{/snippet}

{#snippet footerEnd()}
  {#if grid.isFiltered}
    <span class="text-text-link" title="Figures over the rows in view only">In view:</span>
  {:else}
    <span
      class="inline-flex items-baseline gap-4"
      title="Billable time on this matter that no bill has taken up, priced at its resolved rates. It becomes the next fee line when a draft bill claims it."
    >
      <span class="font-semibold tabular-nums">{money(position.unbilledMinor)}</span>
      <span class="text-text-subtle">unbilled fee value</span>
    </span>
    <span aria-hidden="true">·</span>
  {/if}
  <span
    class="inline-flex items-baseline gap-4"
    title="Fee charges on this matter's bills, net of discounts."
  >
    <span class="font-semibold tabular-nums">{money(position.billedMinor)}</span>
    <span class="text-text-subtle">billed</span>
  </span>
  <span aria-hidden="true">·</span>
  <span
    class="inline-flex items-baseline gap-4"
    title="Fees the client has actually paid, net of the credit notes recorded beside the bills."
  >
    <span class="font-semibold tabular-nums">{money(position.collectedMinor)}</span>
    <span class="text-text-subtle">collected</span>
  </span>
{/snippet}

<section class="flex min-h-0 flex-1 flex-col gap-12">
  <!-- The agreement: the cause, one quiet band above the effect. -->
  <Card.Root class="gap-8 py-12">
    <Card.Content class="flex flex-wrap items-baseline gap-12 px-12">
      <span class="text-xs text-text-subtle uppercase">The Agreement</span>
      <Card.Title class="text-lg">
        {inForce === null ? "Hourly" : ARRANGEMENT_KIND_LABELS[inForce.kind]}
      </Card.Title>
      <span class="min-w-0 flex-1 text-xs text-text-muted">
        {#if inForce === null}
          Nothing was recorded, and a matter with no agreement is billed hourly.
        {:else}
          Version <span class="tabular-nums">{inForce.version}</span> · in force since
          <span class="tabular-nums">{formatDate(inForce.validFrom)}</span>
        {/if}
        · {arrangementTerms(inForce, money)}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={!mayConfigure}
        title={mayConfigure
          ? "Record an amendment as a new version of the agreement. The version in force stays on the record with the dates it governed."
          : `Amending the fee agreement needs the ${BILLING_PERMISSIONS.configure} capability, which this account does not hold.`}
        onclick={() => (amendOpen = true)}
      >
        <SquarePen class="size-16" aria-hidden="true" />
        Amend Agreement
      </Button>
    </Card.Content>
  </Card.Root>

  <div class="flex flex-wrap items-center justify-end gap-8">
    {#if grid.isFiltered}
      <Button
        variant="secondary"
        size="sm"
        title="Clear all filters and show all {grid.totalRowCount} charges"
        onclick={() => grid.clearAllFilters()}
      >
        <FunnelX class="size-16" aria-hidden="true" />
        Clear Filters
      </Button>
    {/if}
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

  <div class="min-h-0 flex-1">
    <Resizable.PaneGroup direction="horizontal" autoSaveId="matter-fees-panes">
      <Resizable.Pane defaultSize={panelOpen ? 66 : 100} minSize={40}>
        <DataTable.Grid
          {grid}
          {cell}
          class="max-h-svh"
          caption="Fee charges on this matter"
          empty={emptyLedger}
          {loading}
        />
      </Resizable.Pane>
      {#if panelOpen}
        <Resizable.Handle withHandle />
        <Resizable.Pane defaultSize={34} minSize={22} maxSize={50}>
          <FeeChargePanel
            {charges}
            selected={selectedCharges}
            {arrangement}
            {unbilledMinor}
            {currency}
            {rowOf}
            onPrint={(charge) => {
              printCharge = charge;
              printOpen = true;
            }}
            {onShowBill}
            onLetGo={() => grid.clearSelection()}
          />
        </Resizable.Pane>
      {/if}
    </Resizable.PaneGroup>
  </div>

  <DataTable.GridFooter {grid} end={footerEnd} />
</section>

<AmendAgreementDialog bind:open={amendOpen} {arrangement} {matterId} onRecorded={onAmended} />

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
