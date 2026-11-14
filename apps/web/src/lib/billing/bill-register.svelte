<script lang="ts">
  /*
   * The bill register: every bill this matter's client has been given, and this matter's share of
   * each.
   *
   * THE LIST IS THE SCREEN. What a person came for is the list; the panel beside it is the smaller
   * details and opens from its own control alone, so clicking a row selects it and does nothing
   * else. Every dialog on this surface is a decision about money and opens over the list rather than
   * navigating away from it.
   *
   * ONE TABLE, ONE FRAME. Sorting, the in-header filters, show/hide, drag-reorder, pinning, resize,
   * selection, the totals row and the filtered-empty state are the product's one grid. The frame
   * around it, the acts row, the counts strip and the pane toggle are the money surface's
   * (apps/web/src/lib/money/), the same on every money section. This file declares columns, cells,
   * figures and verbs, and the panel beside the list; it decides none of that behaviour.
   *
   * THE ROWS AND THE FIGURES ARE BOTH THIS MATTER'S. An invoice belongs to one client and may bill
   * several of that client's matters, so the listing is asked for this matter: the rows are the
   * bills that charge it, drafts included, and the leading money column is THIS MATTER'S share of
   * each rather than the document's total. The register was client-wide before the listing could be
   * narrowed, and presenting a client-wide list under a matter's heading misstated every figure on
   * the screen — the Total (all matters) column is where the document's own total still reads.
   */
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FileMinus from "@lucide/svelte/icons/file-minus";
  import { MoneySurface, type MoneySurfaceDensity } from "$lib/money/index.ts";
  import { RecordMenu, type RecordMenuAction } from "$lib/records/index.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import type { CostSummary } from "$lib/matters/cost-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import {
    addInvoiceClaims,
    applyClientCredit,
    billingFailure,
    listInvoiceDeliveries,
    type ClientCredit,
    type InvoiceDelivery,
    type InvoiceLine,
    type MatterUnbilled,
  } from "./billing-api.ts";
  import { billActions, billRecordMenu, type BillActionContext } from "./bill-actions.ts";
  import {
    BILL_COLUMN_IDENTIFIERS,
    BILL_REGISTER_INITIAL_SORT,
    NOT_APPLICABLE,
    absentShareTitle,
    billColumns,
    draftShareTitle,
  } from "./bill-columns.ts";
  import { billFigures } from "./bill-figures.ts";
  import BillDetailsPanel from "./bill-details-panel.svelte";
  import InvoiceWindow from "./invoice-window.svelte";
  import ApplyTrustFundsDialog from "./apply-trust-funds-dialog.svelte";
  import CreditNoteDialog from "./credit-note-dialog.svelte";
  import DraftBillDialog from "./draft-bill-dialog.svelte";
  import FinalizeBillDialog from "./finalize-bill-dialog.svelte";
  import InvoiceLineDialog from "./invoice-line-dialog.svelte";
  import RecordDeliveryDialog from "./record-delivery-dialog.svelte";
  import VoidDraftDialog from "./void-draft-dialog.svelte";
  import WriteOffDialog from "./write-off-dialog.svelte";
  import {
    civilToday,
    creditedMinor,
    deliveryReading,
    invoiceReference,
    invoiceStanding,
    matterShareMinor,
    matterUnpaidMinor,
    overdueDays,
    type InvoiceRow,
  } from "./invoice-standing.ts";

  let {
    rows,
    loading = false,
    matterId,
    matterTitle,
    matterNumber,
    clientEntityId,
    clientName,
    currency,
    unbilled,
    unbilledTime,
    unbilledCosts,
    clientCredits,
    permissions,
    onChanged,
    beneath = undefined,
  }: {
    /** Every bill of this matter's client, with whatever of each one's detail has been read. */
    rows: readonly InvoiceRow[];
    loading?: boolean;
    matterId: string;
    matterTitle: string;
    matterNumber: string | null;
    clientEntityId: string | null;
    clientName: string;
    currency: string;
    unbilled: MatterUnbilled | null;
    unbilledTime: readonly TimeEntrySummary[];
    unbilledCosts: readonly CostSummary[];
    clientCredits: readonly ClientCredit[];
    permissions: readonly string[] | null;
    /** Something was written; the matter's billing wants re-reading. */
    onChanged: () => void;
    /** Rendered by the surface directly above the counts strip: the page's "more bills" line. */
    beneath?: Snippet;
  } = $props();

  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });
  const today = civilToday();

  /* The panel's open state is the reader's, and it survives leaving the tab and coming back. */
  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-billing-details-panel", ["open", "closed"] as const, "open"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  let selectedRows = $state<readonly InvoiceRow[]>([]);
  const soleRow = $derived(selectedRows.length === 1 ? (selectedRows[0] ?? null) : null);

  let actionFailure = $state<StatedFailure | null>(null);
  let actionNotice = $state<string | null>(null);
  let claiming = $state<string | null>(null);

  let draftOpen = $state(false);

  /*
   * The one create action this surface has, exported for the section page: the matter header's
   * create control is the only button that opens a blank record here (create-action.svelte.ts),
   * so the ledger keeps no button of its own and answers the header's press instead.
   */
  export function openNew(): void {
    draftOpen = true;
  }
  let finalizeOpen = $state(false);
  let voidOpen = $state(false);
  let deliveryOpen = $state(false);
  let trustOpen = $state(false);
  let creditNoteOpen = $state(false);
  let writeOffOpen = $state(false);
  let lineOpen = $state(false);
  let editingLine = $state<InvoiceLine | null>(null);

  /* The bill the invoice window is showing. Opening is an explicit gesture; selecting is not. */
  let windowOpen = $state(false);
  let windowRow = $state<InvoiceRow | null>(null);

  /* The selected bill's delivery attempts, read when the selection lands on a finalized bill. */
  let deliveries = $state<readonly InvoiceDelivery[] | null>(null);
  let deliveriesFor = $state<string | null>(null);

  $effect(() => {
    const bill = windowOpen ? openRow : soleRow;
    if (bill === null || bill.summary.status !== "final") {
      deliveries = null;
      deliveriesFor = null;
      return;
    }
    if (deliveriesFor === bill.summary.id) return;
    deliveriesFor = bill.summary.id;
    deliveries = null;
    void (async () => {
      const outcome = await listInvoiceDeliveries(fetch, bill.summary.id);
      if (deliveriesFor !== bill.summary.id) return;
      deliveries = outcome.kind === "ok" ? outcome.value.data : [];
    })();
  });

  const grid = DataTable.createDataTableGrid<InvoiceRow>({
    // This register always stands inside a matter — the firm's own register is its own screen
    // (routes/(app)/billing), built on the same columns with the firm scope.
    columns: () => billColumns({ scope: { kind: "matter", matterId, clientName }, currency }),
    rows: () => rows,
    rowKey: (row) => row.summary.id,
    initialSort: BILL_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "bill", plural: "bills" },
    // A voided draft stays on the register with its chip and counts toward nothing: it never
    // charged anybody anything.
    totalIncludes: (row) => row.summary.status !== "void",
    onSelectionChange: (_keys, selected) => {
      selectedRows = selected;
    },
    onActivate: (row) => {
      openInvoice(row);
    },
  });

  /* The window follows the bill it was opened on, so a re-read after a write reaches it. */
  const openRow = $derived.by((): InvoiceRow | null => {
    const showing = windowRow;
    if (showing === null) return null;
    return rows.find((row) => row.summary.id === showing.summary.id) ?? showing;
  });

  function openInvoice(row: InvoiceRow): void {
    windowRow = row;
    windowOpen = true;
  }

  /*
   * A bill named in the address opens itself once the register carries it.
   *
   * This is what makes a bill reachable from outside its own register: a billed cost's Open The
   * Bill lands here with the invoice named, and a member who sends the address sends the document
   * rather than a register and an instruction to go looking. It fires once per named bill, so
   * closing the window does not immediately reopen it.
   */
  let addressOpened: string | null = null;
  $effect(() => {
    const named = page.url.searchParams.get("invoice");
    if (named === null || named === addressOpened) return;
    const row = rows.find((candidate) => candidate.summary.id === named);
    if (row === undefined) return;
    addressOpened = named;
    openInvoice(row);
  });

  const figures = $derived(
    billFigures(grid.isFiltered ? grid.rowsInView : rows, {
      unbilled,
      filtered: grid.isFiltered,
      money,
    }),
  );

  /** The open credit this client is carrying, which a bill can be set against. */
  const openCredit = $derived(clientCredits.find((credit) => credit.remainingMinor > 0) ?? null);

  const actionContext = $derived<BillActionContext>({
    matterId,
    permissions,
    openClientCreditMinor: openCredit?.remainingMinor ?? null,
    money,
  });

  const aDraftIsOpen = $derived(rows.some((row) => row.summary.status === "draft"));

  /*
   * A bill belongs to a client, so a matter whose party record names none is warned before
   * anything else on the surface; the warning waits for the read, because "not read yet" and
   * "names nobody" are different facts. The surface draws the notices band only when this is true.
   */
  const clientUnnamed = $derived(clientEntityId === null && !loading);
  const hasNotices = $derived(clientUnnamed || actionFailure !== null || actionNotice !== null);

  /*
   * What the row menu speaks for. Right-clicking inside the selection speaks for it; right-clicking
   * outside re-targets that one row first, so the scope always comes from the selection.
   */
  let contextTarget = $state<InvoiceRow | null>(null);
  const menuTarget = $derived(soleRow ?? contextTarget);
  const menu = $derived(menuTarget === null ? [] : billRecordMenu(menuTarget, actionContext));

  function retargetSelection(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest("[data-grid-row]") : null;
    const key = element?.getAttribute("data-grid-row") ?? null;
    if (key === null) return;
    contextTarget = rows.find((row) => row.summary.id === key) ?? null;
    if (!grid.isSelected(key)) grid.rowClick(key, { repeated: true });
  }

  /*
   * An act runs against whatever the reader is looking at: the bill in the window when one is open,
   * and the selected or right-clicked row otherwise. One resolution, so the window's action bar and
   * the row menu can never act on two different bills.
   */
  function actionTarget(): InvoiceRow | null {
    return windowOpen ? openRow : menuTarget;
  }

  function runAction(action: RecordMenuAction): void {
    const target = actionTarget();
    if (target === null) return;
    actionFailure = null;
    actionNotice = null;
    switch (action.identifier) {
      case "open":
        openInvoice(target);
        return;
      case "copyNumber":
        if (target.summary.invoiceNumber !== null) {
          void navigator.clipboard.writeText(target.summary.invoiceNumber);
          actionNotice = `Copied ${target.summary.invoiceNumber}.`;
        }
        return;
      case "finalize":
        finalizeOpen = true;
        return;
      case "voidDraft":
        voidOpen = true;
        return;
      case "recordDelivery":
        deliveryOpen = true;
        return;
      case "applyTrust":
        trustOpen = true;
        return;
      case "applyClientCredit":
        void setCreditAgainst(target);
        return;
      case "writeOff":
        writeOffOpen = true;
        return;
      case "creditNote":
        creditNoteOpen = true;
        return;
      default:
        return;
    }
  }

  /*
   * Setting an open client credit against a bill. No money moves in either direction: the debt and
   * the credit cancel, bounded by whichever of them is smaller.
   */
  async function setCreditAgainst(target: InvoiceRow): Promise<void> {
    const credit = openCredit;
    if (credit === null) return;
    const owed = matterUnpaidMinor(target, matterId) ?? 0;
    const amountMinor = Math.min(credit.remainingMinor, owed);
    if (amountMinor <= 0) return;
    const outcome = await applyClientCredit(
      fetch,
      credit.id,
      { invoiceId: target.summary.id, matterId, amountMinor, effectiveDate: today },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      actionNotice = `Set ${money(amountMinor)} of the client's credit against ${invoiceReference(target)}.`;
      onChanged();
      return;
    }
    actionFailure = billingFailure(outcome, "Nothing was set against this bill.");
  }

  /** Claim one piece of unbilled work onto the selected draft. */
  async function claim(request: {
    sourceKind: "time_entry" | "cost_entry";
    sourceId: string;
  }): Promise<void> {
    const draft = actionTarget();
    if (draft === null || claiming !== null) return;
    claiming = request.sourceId;
    actionFailure = null;
    const outcome = await addInvoiceClaims(fetch, draft.summary.id, [request], crypto.randomUUID());
    claiming = null;
    if (outcome.kind === "ok") {
      actionNotice = "Claimed onto the draft.";
      onChanged();
      return;
    }
    actionFailure = billingFailure(
      outcome,
      "Nothing was claimed. Work another draft already holds is refused by name.",
    );
  }

  /** Claim everything of one kind. The whole set goes in one write, so it lands or it does not. */
  async function claimAll(sourceKind: "time_entry" | "cost_entry"): Promise<void> {
    const draft = actionTarget();
    if (draft === null || claiming !== null) return;
    const sources =
      sourceKind === "time_entry"
        ? unbilledTime.map((entry) => entry.id)
        : unbilledCosts.map((cost) => cost.id);
    if (sources.length === 0) return;
    claiming = "all";
    actionFailure = null;
    const outcome = await addInvoiceClaims(
      fetch,
      draft.summary.id,
      sources.map((sourceId) => ({ sourceKind, sourceId })),
      crypto.randomUUID(),
    );
    claiming = null;
    if (outcome.kind === "ok") {
      actionNotice = `Claimed all unbilled ${sourceKind === "time_entry" ? "time" : "costs"} onto the draft.`;
      onChanged();
      return;
    }
    actionFailure = billingFailure(
      outcome,
      "Nothing was claimed. A claim held by another draft is refused, and the whole batch stands or falls together.",
    );
  }

  function openLineEditor(line: InvoiceLine): void {
    editingLine = line;
    lineOpen = true;
  }

  /*
   * The domain figures as the shared strip reads them: the money is turned into text HERE, in the
   * matter's own currency, because the strip owns the arrangement and never the formatting.
   */
  const footerReading = $derived(
    figures.map((figure) => ({
      identifier: figure.identifier,
      label: figure.label,
      value: money(figure.amountMinor),
      caption: figure.caption,
    })),
  );
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<InvoiceRow>)}
  {#if column.id === BILL_COLUMN_IDENTIFIERS.invoiceNumber}
    <span class="font-mono whitespace-nowrap">{invoiceReference(row)}</span>
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.standing}
    {@const standing = invoiceStanding(row)}
    <span class="inline-flex items-center gap-4 whitespace-nowrap">
      <Badge {...statusBadgeAttributes(standing)}>{statusEntry(standing).label}</Badge>
      {#if creditedMinor(row) > 0}
        <FileMinus
          class="size-12 text-text-link"
          aria-label="Corrected by a credit note recorded beside it"
        />
      {/if}
    </span>
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.dueDate}
    {@const late = overdueDays(row, today)}
    {#if late > 0 && row.summary.dueDate !== null}
      <span
        class="font-semibold whitespace-nowrap text-status-danger-subtle-foreground tabular-nums"
        title="Unpaid {late} days past due."
      >
        {formatDate(row.summary.dueDate)} · {late}d
      </span>
    {:else}
      <span class="whitespace-nowrap tabular-nums">{text}</span>
    {/if}
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.matterShare}
    {@const share = matterShareMinor(row, matterId)}
    {#if share === null}
      <span
        class="text-text-subtle"
        title={row.summary.status === "draft"
          ? "This draft's lines have not been read yet."
          : absentShareTitle(row)}>{NOT_APPLICABLE}</span
      >
    {:else if row.summary.status === "draft"}
      <span class="whitespace-nowrap tabular-nums" title={draftShareTitle()}>{money(share)}</span>
    {:else}
      <span class="whitespace-nowrap tabular-nums">{money(share)}</span>
    {/if}
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.matterUnpaid}
    {@const owed = matterUnpaidMinor(row, matterId)}
    {#if owed === null}
      <span class="text-text-subtle" title={absentShareTitle(row)}>{NOT_APPLICABLE}</span>
    {:else}
      <span class="whitespace-nowrap tabular-nums">{money(owed)}</span>
    {/if}
  {:else if column.id === BILL_COLUMN_IDENTIFIERS.delivered}
    {@const reading = deliveryReading(row, (isoDate) => formatDate(isoDate))}
    <span
      class="whitespace-nowrap {reading.key === 'delivered' ? '' : 'text-text-muted'}"
      title={reading.title}>{reading.text}</span
    >
  {:else}
    {text}
  {/if}
{/snippet}


<!-- The counts strip's trailing figures. The surface seats the pane toggle after them. -->
{#snippet figuresStrip()}
  <DataTable.GridFigures {grid} figures={footerReading} />
{/snippet}

<!-- The notices band: the missing client first, because it governs every act below it, then the
     last act's failure or its confirmation. Passed to the surface only while one of them is on. -->
{#snippet notices()}
  <div class="flex flex-col gap-12">
    {#if clientUnnamed}
      <Alert.Root variant="warning">
        <Alert.Title>This Matter Names No Client</Alert.Title>
        <Alert.Description>
          This matter has no client yet. You can still record the agreement, but nothing can be billed until a client is added on the Parties tab.
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if actionFailure !== null}
      <FailureNotice
        failure={actionFailure.failure}
        title="Nothing Changed"
        fallback={actionFailure.fallback}
      />
    {:else if actionNotice !== null}
      <Alert.Root variant="info">
        <Alert.Title>Recorded</Alert.Title>
        <Alert.Description>{actionNotice}</Alert.Description>
      </Alert.Root>
    {/if}
  </div>
{/snippet}

{#snippet list({ density, tableClass, frame }: { density: MoneySurfaceDensity; tableClass: string; frame: "card" | "flush" })}
  <RecordMenu
    class="flex min-h-0 flex-1 flex-col"
    {menu}
    onAction={runAction}
    onChoice={() => undefined}
  >
    <!-- The re-target runs on the way up and does NOT swallow the event, so the menu the
         product uses everywhere is still the thing that opens. -->
    <div class="flex min-h-0 flex-1 flex-col" role="presentation" oncontextmenu={retargetSelection}>
      <DataTable.Grid
        {grid}
        {cell}
        {frame}
        class={tableClass}
        {density}
        caption="Bills this matter's client has been given"
        {loading}
      />
    </div>
  </RecordMenu>
{/snippet}

{#snippet panel()}
  <BillDetailsPanel
    row={openRow ?? soleRow}
    selectedCount={selectedRows.length}
    {matterId}
    {clientName}
    {today}
    {figures}
    {money}
    onOpenInvoice={openInvoice}
    onLetGo={() => grid.clearSelection()}
  />
{/snippet}

<!-- An invoice's details are a bigger read than a time entry's, so this one pane opens wider:
     a number handed to the shared surface, never a frame of its own. -->
<MoneySurface
  {matterId}
  section="billing"
  {grid}
  autoSaveId="matter-billing-panes"
  panelSize={34}
  panelMinSize={22}
  panelMaxSize={50}
  {panelOpen}
  onTogglePanel={(open) => panelPreference.set(open ? "open" : "closed")}
  notices={hasNotices ? notices : undefined}
  {list}
  {panel}
  figures={figuresStrip}
  {beneath}
/>

{#if clientEntityId !== null}
  <DraftBillDialog
    bind:open={draftOpen}
    {clientEntityId}
    {clientName}
    {matterNumber}
    {aDraftIsOpen}
    onOpened={() => {
      actionNotice = "Draft opened. Claim work onto it from the details panel.";
      onChanged();
    }}
  />
{/if}

<FinalizeBillDialog
  bind:open={finalizeOpen}
  row={openRow ?? soleRow}
  {money}
  onFinalized={(invoiceNumber) => {
    actionNotice = `Finalized as ${invoiceNumber}: the receivable posted and the work locked.`;
    onChanged();
  }}
/>

<VoidDraftDialog
  bind:open={voidOpen}
  row={openRow ?? soleRow}
  onVoided={() => {
    actionNotice = "Draft voided. Its work returned to unbilled.";
    onChanged();
  }}
/>

<RecordDeliveryDialog
  bind:open={deliveryOpen}
  row={openRow ?? soleRow}
  onRecorded={() => {
    actionNotice = "Delivery recorded.";
    deliveriesFor = null;
    onChanged();
  }}
/>

<ApplyTrustFundsDialog
  bind:open={trustOpen}
  row={openRow ?? soleRow}
  {matterId}
  {money}
  formatDate={(isoDate) => formatDate(isoDate)}
/>

<CreditNoteDialog
  bind:open={creditNoteOpen}
  row={openRow ?? soleRow}
  {matterId}
  {money}
  onIssued={(clientCreditMinor) => {
    actionNotice =
      clientCreditMinor > 0
        ? `Credit note issued. ${money(clientCreditMinor)} opened as a client credit the firm owes back.`
        : "Credit note issued.";
    onChanged();
  }}
/>

<WriteOffDialog
  bind:open={writeOffOpen}
  row={openRow ?? soleRow}
  {matterId}
  {money}
  onWrittenOff={(amountMinor) => {
    actionNotice = `Wrote off ${money(amountMinor)}.`;
    onChanged();
  }}
/>

<InvoiceWindow
  bind:open={windowOpen}
  row={openRow}
  {matterId}
  {matterTitle}
  {matterNumber}
  {clientName}
  {currency}
  {today}
  {actionContext}
  {deliveries}
  {clientCredits}
  {unbilledTime}
  {unbilledCosts}
  {claiming}
  onAction={(identifier) => {
    const target = actionTarget();
    if (target === null) return;
    const action = billActions(target, actionContext).find(
      (candidate) => candidate.identifier === identifier,
    );
    if (action !== undefined) runAction(action);
  }}
  onEditLine={openLineEditor}
  onClaim={(request) => void claim(request)}
  onClaimAll={(kind) => void claimAll(kind)}
/>

<InvoiceLineDialog
  bind:open={lineOpen}
  invoiceId={(openRow ?? soleRow)?.summary.id ?? null}
  invoiceNumber={(openRow ?? soleRow)?.summary.invoiceNumber ?? null}
  line={editingLine}
  onSaved={() => {
    actionNotice = "Line updated. The entry it was composed from is unchanged.";
    onChanged();
  }}
/>
