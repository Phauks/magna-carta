<script lang="ts">
  /*
   * The matter's Trust ledger: the list is the screen.
   *
   * A TRUST MOVEMENT IS CLIENT MONEY THAT MOVED. Every row here is one of three facts: a deposit
   * into this matter's trust ledger, a disbursement out of it to a payee, or a transfer between
   * two of this client's matters inside the same trust account. Each one names how the money
   * moved, why, who wrote it down and, where a release took one, who released it and on what
   * footing. Nothing on this screen is a draft, is edited or is voided: a movement that reached
   * the ledger is a fact the firm answers for, and a mistake is corrected by a further movement.
   *
   * THE SAME SURFACE AS TIME, FEES, COSTS AND BILLING. One table machinery, one details panel, one
   * money surface. What this file contributes is the columns, the words and the figures; every
   * behaviour a reader has learned on the other ledgers is the behaviour they get here. The frame
   * around the list is the money surface's, described once in apps/web/src/lib/money/CLAUDE.md.
   *
   * TWO ALTITUDES, NOT THREE. The LIST is what a person came for. The PANEL beside it is the
   * smaller details, and it opens from its own control alone: clicking a row selects it and does
   * nothing else. There is no record window, because there is nothing about one movement that the
   * panel cannot state and nothing about it anybody may change.
   *
   * THIS SURFACE CANNOT NAME A TRUST ACCOUNT YET (trust-gaps.ts). The ledger read, the deposit, the
   * disbursement and the transfer each take one of the firm's trust accounts; the listing exists
   * (the report screen reads it) and this ledger is not yet wired to it. The surface is built whole
   * against the record a movement IS, the list stands empty and says why, and every write renders
   * where the design puts it, refused, naming what it waits on.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import Copy from "@lucide/svelte/icons/copy";
  import { MoneySurface, type MoneySurfaceDensity } from "$lib/money/index.ts";
  import {
    RecordMenu,
    menuOf,
    oneRecordGesture,
    type RecordMenuChoice,
    type RecordMenuModel,
  } from "$lib/records/index.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import type { TrustMatterLedger, TrustMovementRecord } from "./trust-api.ts";
  import {
    TRUST_COLUMN_IDENTIFIERS,
    TRUST_LEDGER_INITIAL_SORT,
    trustLedgerColumns,
  } from "./trust-columns.ts";
  import TrustDetailsPanel from "./trust-details-panel.svelte";
  import { footerFigures, ledgerCurrency } from "./trust-figures.ts";
  import { gapCellTitle, gapReason } from "./trust-gaps.ts";
  import {
    authorizedByText,
    authorizedByTitle,
    counterpartyText,
    kindLabel,
    kindSentence,
  } from "./trust-vocabulary.ts";

  let {
    movements,
    ledger,
    loading = false,
    matterId,
    matterTitle,
    matterNumber,
  }: {
    /** Every movement on the matter, in effective-date order: that is what a trust ledger is. */
    movements: readonly TrustMovementRecord[];
    /** The ledger read the movements came from, for the position it states. Null until served. */
    ledger: TrustMatterLedger | null;
    loading?: boolean;
    matterId: string;
    matterTitle: string;
    matterNumber: string | null;
  } = $props();

  const currency = $derived(ledgerCurrency(movements));
  const ownNode = $derived(ledger?.trustLedgerNodeId ?? null);
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  /* The panel's open state is the reader's, and it survives leaving the tab and coming back. */
  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-trust-details-panel", ["open", "closed"] as const, "closed"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  let selectedMovements = $state<readonly TrustMovementRecord[]>([]);

  const grid = DataTable.createDataTableGrid<TrustMovementRecord>({
    columns: () => trustLedgerColumns(currency, ownNode),
    rows: () => movements,
    rowKey: (movement) => movement.id,
    initialSort: TRUST_LEDGER_INITIAL_SORT,
    itemNoun: { singular: "movement", plural: "movements" },
    onSelectionChange: (_keys, rows) => {
      selectedMovements = rows;
    },
    // A row's own gesture opens it everywhere else in the product; here there is nothing to open,
    // so activating a row shows its details in the panel rather than doing nothing at all.
    onActivate: () => {
      panelPreference.set("open");
    },
  });

  const stripFigures = $derived(
    footerFigures(ledger, grid.isFiltered ? grid.rowsInView : movements, {
      filtered: grid.isFiltered,
    }),
  );

  /*
   * The one create action this surface has, exported for the section page: the matter header's
   * create control is the only button that records anything here (create-action.svelte.ts), so
   * the ledger keeps no button of its own and answers the header's press. Until the firm's trust
   * accounts can be read there is no account to post a deposit into, so the page claims the
   * control with that refusal and this does nothing; the deposit window arrives with the read.
   */
  export function openNew(): void {
    // Nothing to open yet: the deposit form waits on the account read (trust-gaps.ts, `deposit`).
  }

  /*
   * What the menu speaks for. Right-clicking inside the selection speaks for all of it; right-
   * clicking outside re-targets that one row first, so the scope comes from the selection.
   *
   * COPY IS THE WHOLE MENU. A movement takes no verb, so the menu offers only the values worth
   * putting on the clipboard, and is absent rather than empty over nothing.
   */
  let contextTarget = $state<TrustMovementRecord | null>(null);
  const menuScope = $derived(
    selectedMovements.length > 0
      ? selectedMovements
      : contextTarget === null
        ? []
        : [contextTarget],
  );

  const menu = $derived.by((): RecordMenuModel => {
    const target = menuScope[0];
    if (target === undefined) return [];
    const choices: RecordMenuChoice[] = [];
    if (target.reference !== null) {
      choices.push({ identifier: "reference", label: `Reference: ${target.reference}` });
    }
    choices.push({ identifier: "purpose", label: "Purpose" });
    choices.push({ identifier: "amount", label: `Amount: ${money(target.amountMinor)}` });
    return menuOf([
      {
        identifier: "record",
        items: [
          {
            kind: "flyout",
            identifier: "copyValue",
            label: "Copy",
            icon: Copy,
            choices,
            ...oneRecordGesture(menuScope.length, "Copying a value works on one record at a time."),
          },
        ],
      },
    ]);
  });

  /** Re-target the selection to the row under the pointer, without swallowing the menu's own event. */
  function retargetSelection(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest("[data-grid-row]") : null;
    const key = element?.getAttribute("data-grid-row") ?? null;
    if (key === null) return;
    contextTarget = movements.find((movement) => movement.id === key) ?? null;
    if (!grid.isSelected(key)) grid.rowClick(key, { repeated: true });
  }

  function copyMenuValue(identifier: string): void {
    const movement = menuScope[0];
    if (movement === undefined) return;
    const text =
      identifier === "reference"
        ? (movement.reference ?? "")
        : identifier === "purpose"
          ? movement.purpose
          : money(movement.amountMinor);
    if (text !== "") void navigator.clipboard.writeText(text);
  }

  const caption = $derived(
    matterNumber === null
      ? `Trust movements on ${matterTitle}`
      : `Trust movements on ${matterNumber}, ${matterTitle}`,
  );

  /** A figure the read has not stated yet reads as a dash, never as nothing. */
  const UNSERVED_FIGURE = "—";
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<TrustMovementRecord>)}
  {#if column.id === TRUST_COLUMN_IDENTIFIERS.effectiveDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.effectiveDate)}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.kind}
    <span title={kindSentence(row.kind)}>{kindLabel(row.kind)}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.reference}
    {#if row.reference === null}
      <span class="text-text-muted">&mdash;</span>
    {:else}
      <span class="block truncate tabular-nums" title={row.reference}>{row.reference}</span>
    {/if}
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.counterparty}
    {@const counterparty = counterpartyText(row, ownNode)}
    <span class="block truncate" title={counterparty}>{counterparty}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.purpose}
    <span class="block truncate" title={row.purpose}>{row.purpose}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.amountIn || column.id === TRUST_COLUMN_IDENTIFIERS.amountOut}
    {#if text === ""}
      <span class="text-text-subtle">&mdash;</span>
    {:else}
      <span class="whitespace-nowrap tabular-nums">{text}</span>
    {/if}
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.recordedBy}
    <span class="block truncate tabular-nums" title={gapCellTitle("memberNames")}>
      {row.recordedBy}
    </span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.authorizedBy}
    <span
      class={row.authorizedBy === null ? "text-text-muted" : "block truncate tabular-nums"}
      title={authorizedByTitle(row)}
    >
      {authorizedByText(row)}
    </span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.recordedAt}
    <span class="whitespace-nowrap tabular-nums">{formatInstant(row.recordedAt)}</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet emptyLedger()}
  <EmptyState title="No Trust Movements Yet">
    Deposits into this matter&rsquo;s trust ledger, disbursements out of it and transfers between
    this client&rsquo;s matters land here, each with who recorded it and who released it. New
    Deposit, at the top of the matter, records the first.
  </EmptyState>
{/snippet}

<!-- The one honest line about why this ledger stands empty: nothing can name a trust account. -->
{#snippet notices()}
  <p class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
    <MaturityBadge stage="soon" />
    {soonDependencySentence(gapReason("account"))}
  </p>
{/snippet}

{#snippet list({ density, tableClass }: { density: MoneySurfaceDensity; tableClass: string })}
  <RecordMenu
    class="flex min-h-0 flex-1 flex-col"
    {menu}
    onAction={() => undefined}
    onChoice={(_flyout, choice) => copyMenuValue(choice.identifier)}
  >
    <!-- The re-target runs on the way up and does NOT swallow the event, so the menu the product
         uses everywhere is still the thing that opens. -->
    <div class="flex min-h-0 flex-1 flex-col" role="presentation" oncontextmenu={retargetSelection}>
      <DataTable.Grid
        {grid}
        {cell}
        class={tableClass}
        {density}
        {caption}
        empty={emptyLedger}
        {loading}
      />
    </div>
  </RecordMenu>
{/snippet}

{#snippet panel()}
  <TrustDetailsPanel
    {ledger}
    {movements}
    selected={selectedMovements}
    {money}
    onLetGo={() => grid.clearSelection()}
  />
{/snippet}

<!-- The position is the ledger's and holds still under a filter, so no "In view:" prefix: the
     figure that IS over the rows in view says so in its own label. -->
{#snippet figures()}
  {#each stripFigures as figure, index (figure.identifier)}
    {#if index > 0}<span aria-hidden="true">·</span>{/if}
    <span
      class="inline-flex items-baseline gap-4"
      title={figure.amountMinor === null ? gapCellTitle("account") : figure.caption}
    >
      <span class="text-text-subtle">{figure.label}</span>
      {#if figure.amountMinor === null}
        <span class="text-text-subtle">{UNSERVED_FIGURE}</span>
      {:else}
        <span class="font-semibold tabular-nums">{money(figure.amountMinor)}</span>
      {/if}
    </span>
  {/each}
{/snippet}

<MoneySurface
  {matterId}
  section="trust"
  {grid}
  autoSaveId="matter-trust-panes"
  {panelOpen}
  onTogglePanel={(open) => panelPreference.set(open ? "open" : "closed")}
  {notices}
  {list}
  {panel}
  {figures}
/>
