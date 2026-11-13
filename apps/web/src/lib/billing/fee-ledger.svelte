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
   * panel, one record window, one footer grammar. The frame, the acts row, the counts strip and
   * the pane toggle are the money surface's (apps/web/src/lib/money/), the same on every money
   * section; what this file contributes is the columns, the cells, the figures, the verbs and the
   * panel beside the list. Every behaviour a reader has learned on the other ledgers is the
   * behaviour they get here.
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
   * THE STORE IS REAL NOW. The rows are `fee_entry` rows read through the fee routes, and every
   * verb on this surface writes: record, edit, submit, approve, kick back, delete a draft, void.
   * What is still unserved is named one place (fee-gaps.ts) and nowhere else — an entry number, the
   * files riding a record, the recorded history — and each says what it waits on rather than
   * showing a value nobody recorded.
   *
   * DELETING IS NOT VOIDING, and this is the first ledger with both. A draft nobody has seen is a
   * typing mistake and is removed; anything past draft is a record somebody may be asked to account
   * for and is withdrawn instead, staying on the ledger struck through. The menu offers both and
   * the refusal on the wrong one is where the difference gets taught.
   */
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { ApiOutcome, Failure } from "$lib/api/request.ts";
  import { MoneySurface, billHref, type MoneySurfaceDensity } from "$lib/money/index.ts";
  import {
    RecordDeleteDraftDialog,
    RecordKickBackDialog,
    RecordMenu,
    RecordVoidDialog,
  } from "$lib/records/index.ts";
  import { ledgerRecordMenu } from "$lib/records/ledger-record-menu.ts";
  import type { LedgerRecord } from "$lib/records/ledger-record-menu.ts";
  import type { RecordMenuAction, RecordMenuModel } from "$lib/records/record-menu-model.ts";
  import ReclassifyDialog from "$lib/records/reclassify-dialog.svelte";
  import { mayReclassify } from "$lib/records/reclassification.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
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
  import { gapReason, REVIEW_GATE_ENABLED } from "./fee-gaps.ts";
  import { feeEntrySheet } from "./fee-print-sheet.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import {
    approveFee,
    canWorkDraft,
    deleteDraftFee,
    kickBackFee,
    readFeeLedgerEntry,
    submitFee,
    voidFee,
    writeKey,
    type FeeAcknowledgement,
  } from "./fee-operations.ts";
  import {
    billingLabel,
    billingSentence,
    countsInTotals,
    feePosition,
    feeStatusKey,
    type FeeRecord,
  } from "./fee-record.ts";

  let {
    fees,
    loading = false,
    matterId,
    matterTitle,
    matterNumber,
    currency,
    permissions,
    openFeeId = null,
    onChanged,
    beneath = undefined,
  }: {
    /** Every fee on the matter, in every status: that is what a matter's fee record is. */
    fees: readonly FeeRecord[];
    loading?: boolean;
    matterId: string;
    matterTitle: string;
    matterNumber: string | null;
    currency: string;
    /** What this account may do, from the session bootstrap. Null while it has not been read. */
    permissions: readonly string[] | null;
    /** A fee to open on arrival — what a deep link into this section names. */
    openFeeId?: string | null;
    /** Something was written; the matter's fees want re-reading. */
    onChanged: () => void;
    /** Rendered by the surface directly above the counts strip. */
    beneath?: Snippet;
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
  let reclassifyFee = $state<FeeRecord | null>(null);
  let reclassifyOpen = $state(false);
  let kickBackTarget = $state<FeeRecord | null>(null);
  let kickBackOpen = $state(false);
  let voidTarget = $state<FeeRecord | null>(null);
  let voidOpen = $state(false);
  let deleteTarget = $state<FeeRecord | null>(null);
  let deleteOpen = $state(false);
  let actionFailure = $state<StatedFailure | null>(null);
  let actionNotice = $state<string | null>(null);

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

  const position = $derived(feePosition(grid.isFiltered ? grid.rowsInView : fees));

  function openRecord(fee: FeeRecord, editing: boolean): void {
    windowFee = fee;
    windowEditing = editing;
    windowOpen = true;
  }

  /*
   * The fee this ledger was asked to open, opened the way any fee opens: from the loaded page where
   * it is on it, else read by its id — a fee older than the first page opens all the same. Once per
   * id.
   */
  let honouredFeeId = $state<string | null>(null);
  $effect(() => {
    const wanted = openFeeId;
    if (wanted === null || loading || honouredFeeId === wanted) return;
    honouredFeeId = wanted;
    const loaded = fees.find((fee) => fee.id === wanted);
    if (loaded !== undefined) {
      openRecord(loaded, false);
      return;
    }
    void readFeeLedgerEntry(fetch, wanted).then((outcome) => {
      if (outcome.kind === "ok") openRecord(outcome.value, false);
    });
  });

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
      // The matter-scoped entry number is not served yet, so nothing offers to copy one.
      entryNumber: null,
      description: fee.description,
      amount: money(fee.amountMinor),
      invoiceId: fee.invoiceId,
    };
  }

  /*
   * The line naming one fee in a confirmation. The shared dialogs take it as a string rather than a
   * record, so they hold no fee vocabulary of their own; a null subject is how they read "nothing
   * is open".
   */
  function identify(fee: FeeRecord | null): string | null {
    if (fee === null) return null;
    return `${formatDate(fee.serviceDate)} · ${timekeeperText(fee)} · ${money(fee.amountMinor)}`;
  }

  const menu = $derived.by((): RecordMenuModel => {
    const target = menuScope[0];
    if (target === undefined) return [];
    return ledgerRecordMenu(menuScope.map(describeForMenu), describeForMenu(target), {
      recordNoun: { singular: "Fee", plural: "Fees" },
      reviewGateEnabled: REVIEW_GATE_ENABLED,
      // The bill a billed fee reached, and the draft-only delete the fee routes serve. Both are
      // declared rather than assumed, so a ledger that has neither keeps exactly the menu it had.
      opensTheBill: true,
      deletesDraft: true,
      reclassify: mayReclassify({
        kind: "fee",
        status: statusEntry(feeStatusKey(target.status)).label.toLowerCase(),
        // The bill's own NUMBER is not on the fee listing — the claim mirror carries its identifier
        // — so the refusal names the bill without quoting a number it cannot read.
        invoiceNumber: null,
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

  /** What a refused write says, in the reader's words rather than the transport's. */
  function refusalSentence(
    outcome: { kind: "problem"; failure: Failure } | { kind: "transport"; failure: Failure },
    what: string,
  ): StatedFailure {
    return stated(outcome.failure, `${what} was refused.`, `${what} is unchanged.`);
  }

  async function runChainVerb(
    targets: readonly FeeRecord[],
    verb: (feeEntryId: string) => Promise<ApiOutcome<FeeAcknowledgement>>,
    what: string,
    done: string,
  ): Promise<void> {
    actionFailure = null;
    actionNotice = null;
    const outcomes = await Promise.all(targets.map((fee) => verb(fee.id)));
    const refused = outcomes.find((outcome) => outcome.kind !== "ok");
    if (refused === undefined) {
      actionNotice = done;
    } else {
      actionFailure = refusalSentence(refused, what);
    }
    onChanged();
  }

  function submitFees(targets: readonly FeeRecord[]): void {
    if (targets.length === 0) return;
    void runChainVerb(
      targets,
      (id) => submitFee(fetch, id, writeKey()),
      targets.length === 1 ? "The fee" : "One of the fees",
      `Submitted ${targets.length} ${targets.length === 1 ? "draft" : "drafts"} for review. Each is locked until it is approved or kicked back.`,
    );
  }

  function approveFees(targets: readonly FeeRecord[]): void {
    if (targets.length === 0) return;
    void runChainVerb(
      targets,
      (id) => approveFee(fetch, id, writeKey()),
      targets.length === 1 ? "The fee" : "One of the fees",
      `Approved ${targets.length} ${targets.length === 1 ? "fee" : "fees"}. ${targets.length === 1 ? "It is" : "They are"} billable on the next bill.`,
    );
  }

  function runMenuAction(action: RecordMenuAction): void {
    const targets = menuScope;
    const first = targets[0];
    if (first === undefined) return;
    actionFailure = null;
    actionNotice = null;
    switch (action.identifier) {
      case "open":
        openRecord(first, canWorkDraft(first).allowed);
        return;
      case "duplicate":
        // Duplicating starts a new draft from this fee's fields. Until a duplicate route exists,
        // the window opens on a blank draft rather than one silently pre-filled from a record the
        // server was never asked to copy.
        openNew();
        return;
      case "submit":
        submitFees(targets.filter((fee) => fee.status === "draft"));
        return;
      case "approve":
        approveFees(targets.filter((fee) => fee.status === "submitted"));
        return;
      case "kickBack":
        kickBackTarget = targets.find((fee) => fee.status === "submitted") ?? null;
        kickBackOpen = kickBackTarget !== null;
        return;
      case "deleteDraft":
        deleteTarget = first;
        deleteOpen = true;
        return;
      case "void":
        voidTarget = first;
        voidOpen = true;
        return;
      case "reclassify":
        reclassifyFee = first;
        reclassifyOpen = true;
        return;
      case "print":
        print(first);
        return;
      case "openBill":
        // The bill lands on the matter's own Billing section with that bill open — the same place
        // the register would have opened it. The verb is refused where there is no bill, so
        // reaching here means there is one.
        if (first.invoiceId !== null) {
          void goto(billHref(matterId, first.invoiceId));
        }
        return;
      default:
        return;
    }
  }



  function copyMenuValue(identifier: string): void {
    const fee = menuScope[0];
    if (fee === undefined) return;
    const text =
      identifier === "description" ? fee.description : identifier === "amount" ? money(fee.amountMinor) : "";
    if (text !== "") void navigator.clipboard.writeText(text);
  }

  const sheet = $derived(
    printFee === null
      ? null
      : feeEntrySheet(printFee, {
          matterTitle,
          matterNumber,
          money: (amount) => formatMoney(amount, { currency }),
          ...printSheetDates(),
          instant: (isoInstant) => formatInstant(isoInstant),
          printedAt: formatInstant(new Date()),
        }),
  );

  /* The surface draws the notices band only while there is something to put in it. */
  const hasNotices = $derived(actionFailure !== null || actionNotice !== null);

  /*
   * The two figures this ledger ends with, as the shared strip reads them. The captions are the
   * whole reason the pair is not a bare total: "unbilled" and "billed" are positions in a process,
   * and a reader hovering either needs to know which.
   */
  const footerReading = $derived([
    {
      identifier: "unbilled",
      label: "unbilled",
      value: money(position.unbilledMinor),
      caption:
        "Billable fees not yet on a finalized bill. Add them to a draft bill on the Bills tab.",
    },
    {
      identifier: "billed",
      label: "billed",
      value: money(position.billedMinor),
      caption: "Fees on a finalized bill.",
    },
  ]);
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<FeeRecord>)}
  {#if isUnservedFeeColumn(column.id)}
    <span class="text-text-subtle" title={unservedFeeCellTitle(column.id)}>&mdash;</span>
  {:else if column.id === FEE_COLUMN_IDENTIFIERS.serviceDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.serviceDate)}</span>
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


<!-- The counts strip's trailing figures. The surface seats the pane toggle after them. -->
{#snippet figures()}
  <DataTable.GridFigures {grid} figures={footerReading} />
{/snippet}

<!--
  The notices band carries what a write just did, or why it was refused. No strip of facts joins it:
  the fee arrangement used to lead a row here and now lives in the matter's status window, behind
  the seal in the masthead, because it is a fact of the engagement rather than of the ledger and is
  rarely read. Recording a fee is the matter header's New Fee, not a button here
  (create-action.svelte.ts).
-->
{#snippet notices()}
  {#if actionFailure !== null}
    <FailureNotice
      failure={actionFailure.failure}
      title="Nothing Changed"
      fallback={actionFailure.fallback}
      whenSilent={actionFailure.whenSilent}
    />
  {/if}

  {#if actionNotice !== null}
    <Alert.Root variant="success">
      <Alert.Description>{actionNotice}</Alert.Description>
    </Alert.Root>
  {/if}
{/snippet}

{#snippet list({ density, tableClass, frame }: { density: MoneySurfaceDensity; tableClass: string; frame: "card" | "flush" })}
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
        {frame}
        class={tableClass}
        {density}
        caption="Fees recorded on this matter"
        {loading}
      />
    </div>
  </RecordMenu>
{/snippet}

{#snippet panel()}
  <FeeDetailsPanel
    {fees}
    selected={selectedFees}
    {money}
    onOpen={(fee) => openRecord(fee, canWorkDraft(fee).allowed)}
    onPrint={print}
    onLetGo={() => grid.clearSelection()}
  />
{/snippet}

<MoneySurface
  {matterId}
  section="fees"
  {grid}
  autoSaveId="matter-fees-panes"
  {panelOpen}
  onTogglePanel={(open) => panelPreference.set(open ? "open" : "closed")}
  notices={hasNotices ? notices : undefined}
  {list}
  {panel}
  {figures}
  {beneath}
/>

<FeeRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  fee={windowFee}
  {matterId}
  {matterTitle}
  {matterNumber}
  {currency}
  {canWorkDraft}
  onSaved={onChanged}
/>

<RecordKickBackDialog
  bind:open={kickBackOpen}
  noun="Fee"
  subject={identify(kickBackTarget)}
  commit={(reason) => kickBackFee(fetch, kickBackTarget?.id ?? "", reason, writeKey())}
  onKickedBack={onChanged}
/>

<RecordVoidDialog
  bind:open={voidOpen}
  noun="Fee"
  subject={identify(voidTarget)}
  consequence="The fee freezes and stops counting toward the matter's totals: a withdrawn charge was never owed."
  commit={() => voidFee(fetch, voidTarget?.id ?? "", writeKey())}
  onVoided={onChanged}
/>

<RecordDeleteDraftDialog
  bind:open={deleteOpen}
  noun="Fee"
  subject={identify(deleteTarget)}
  commit={() => deleteDraftFee(fetch, deleteTarget?.id ?? "", writeKey())}
  onDeleted={onChanged}
/>

{#if reclassifyFee !== null}
  <ReclassifyDialog
    bind:open={reclassifyOpen}
    from="fee"
    entryNumber={null}
    description={reclassifyFee.description}
    amountMinor={reclassifyFee.amountMinor}
    {money}
    moveDependency={gapReason("reclassify")}
  />
{/if}

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
