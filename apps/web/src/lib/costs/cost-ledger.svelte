<script lang="ts">
  /*
   * The matter's Cost ledger: the list is the screen.
   *
   * Three altitudes, and they stay in their places. The LIST is what a person came for. The PANEL
   * beside it is the smaller details, and it opens from its own control alone — clicking a row
   * selects it and does nothing else, which is what lets a reader pick a range without the screen
   * rearranging itself. The RECORD WINDOW is where everything about one cost lives, and it opens by
   * double-click, by the row menu, or by the panel's Open.
   *
   * ONE TABLE. Sorting, the in-header filters, show/hide, drag-reorder, pinning, resize, selection,
   * the totals row, the filtered-empty state and the counts strip are all the product's one grid;
   * this file declares cells and verbs, and decides none of that behaviour.
   *
   * THE FRAME IS THE MONEY SURFACE'S (apps/web/src/lib/money/). The toolbar under the section strip,
   * the acts row with the way out of a filter, the counts strip and the pane toggle are drawn once
   * there, for every money section; this file declares its columns, its cells, its figures, its
   * verbs and its panel, and hands them over. Review, where the firm runs review, is the one act
   * this ledger adds to that row.
   *
   * THE REVIEW VOCABULARY IS ABSENT, NOT DISABLED. Whether a firm runs review is a firm setting and
   * it is not served, so the lifecycle reads draft to billed, nothing solicits a submission, and no
   * Review control appears. A disabled "Submit" would be soliciting a workflow this firm has not
   * been asked about, and the Time tab reads the same setting the same way — one matter must not
   * show two different firms.
   *
   * WHAT THE FOOTER CARRIES IS WHAT NO COLUMN CARRIES. Unbilled, billed, absorbed — where the money
   * has got to, and the firm's own decision to absorb some of it kept visible. It states figures
   * and nothing else: the link from a cost to its bill belongs on the cost.
   */
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import { MoneySurface, billHref, type MoneySurfaceDensity } from "$lib/money/index.ts";
  import {
    RecordKickBackDialog,
    RecordMenu,
    RecordVoidDialog,
    type RecordMenuAction,
    type RecordMenuModel,
  } from "$lib/records/index.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import { costStatusKey } from "$lib/matters/cost-api.ts";
  import type { ApiOutcome, Failure } from "$lib/api/request.ts";
  import CostDetailsPanel from "./cost-details-panel.svelte";

  import CostRecordWindow from "./cost-record-window.svelte";
  import CostReviewWindow from "./cost-review-window.svelte";

  import {
    COST_COLUMN_IDENTIFIERS,
    costLedgerColumns,
    expenseCodeReading,
    expenseCodeText,
    isUnservedColumn,
    unservedCellTitle,
  } from "./cost-columns.ts";
  import { ExpenseCodeCatalogue } from "./cost-expense-codes.svelte.ts";
  import { footerFigures, ledgerCurrency, submittedCount } from "./cost-figures.ts";
  import { REVIEW_GATE_ENABLED, gapCellTitle } from "./cost-gaps.ts";
  import { costEntrySheet } from "./cost-print-sheet.ts";
  import { costRecordMenu, type CostMenuRecord } from "./cost-record-menu.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import {
    approveCost,
    canWorkDraft,
    kickBackCost,
    readCostLedgerEntry,
    submitCost,
    voidCost,
    writeKey,
    type CostAcknowledgement,
    type CostLedgerEntry,
  } from "./cost-operations.ts";
  import {
    ABSORBED_MEANING,
    GONE_PAYEE_NOTE,
    billingLabel,
    countsInTotals,
    payeeState,
    payeeText,
  } from "./cost-vocabulary.ts";

  let {
    costs,
    matterId,
    matterTitle,
    matterNumber = null,
    permissions = null,
    loading = false,
    openCostId = null,
    onChanged,
    beneath = undefined,
  }: {
    /** Every cost on the matter, in every status: that is what a matter's cost record is. */
    costs: readonly CostLedgerEntry[];
    matterId: string;
    matterTitle: string;
    matterNumber?: string | null;
    /** What this account may do, from the session bootstrap. Null while it has not been read. */
    permissions?: readonly string[] | null;
    loading?: boolean;
    /** A cost to open on arrival — what a deep link into this section names. */
    openCostId?: string | null;
    /** Something was written; the matter's costs want re-reading. */
    onChanged: () => void;
    /** What the page puts directly above the counts strip: its Load more control. */
    beneath?: Snippet;
  } = $props();

  /** The permission the approve and kick-back routes are gated on. */
  const APPROVE_COSTS_PERMISSION = "costs:approve";
  const canApprove = $derived(permissions === null || permissions.includes(APPROVE_COSTS_PERMISSION));

  const expenseCodes = new ExpenseCodeCatalogue();
  $effect(() => {
    void expenseCodes.load(fetch);
  });

  const currency = $derived(ledgerCurrency(costs));
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  /* The panel's open state is the reader's, and it survives leaving the tab and coming back. */
  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-cost-details-panel", ["open", "closed"] as const, "closed"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  let selectedCosts = $state<readonly CostLedgerEntry[]>([]);
  let windowOpen = $state(false);
  let windowEditing = $state(false);
  let windowEntry = $state<CostLedgerEntry | null>(null);
  let printEntry = $state<CostLedgerEntry | null>(null);
  let printOpen = $state(false);
  let reviewOpen = $state(false);
  let reviewQueue = $state<readonly CostLedgerEntry[]>([]);
  let kickBackTarget = $state<CostLedgerEntry | null>(null);
  let kickBackOpen = $state(false);
  let voidTarget = $state<CostLedgerEntry | null>(null);
  let voidOpen = $state(false);
  let actionFailure = $state<StatedFailure | null>(null);
  let actionNotice = $state<string | null>(null);

  const grid = DataTable.createDataTableGrid<CostLedgerEntry>({
    columns: () =>
      costLedgerColumns({ currency, expenseCodeLabels: expenseCodes.labelFor }),
    rows: () => costs,
    rowKey: (cost) => cost.id,
    initialSort: { columnId: COST_COLUMN_IDENTIFIERS.incurredDate, direction: "descending" },
    itemNoun: { singular: "cost", plural: "costs" },
    // A void stays on the ledger with its chip, reads quieter, and counts toward nothing.
    totalIncludes: countsInTotals,
    rowMark: (cost) => (cost.status === "void" ? { quiet: true } : undefined),
    onSelectionChange: (_keys, rows) => {
      selectedCosts = rows;
    },
    onActivate: (cost) => {
      openRecord(cost, canWorkDraft(cost).allowed);
    },
  });

  function openRecord(cost: CostLedgerEntry, editing: boolean): void {
    windowEntry = cost;
    windowEditing = editing;
    windowOpen = true;
  }

  /*
   * The cost this ledger was asked to open, opened the way any cost opens: from the loaded page
   * where it is on it, else read by its id — a cost older than the first page opens all the same.
   * Once per id.
   */
  let honouredCostId = $state<string | null>(null);
  $effect(() => {
    const wanted = openCostId;
    if (wanted === null || loading || honouredCostId === wanted) return;
    honouredCostId = wanted;
    const loaded = costs.find((cost) => cost.id === wanted);
    if (loaded !== undefined) {
      openRecord(loaded, false);
      return;
    }
    void readCostLedgerEntry(fetch, wanted).then((outcome) => {
      if (outcome.kind === "ok") openRecord(outcome.value, false);
    });
  });

  /*
   * The one create action this surface has, exported for the section page: the matter header's
   * create control is the only button that opens a blank record here (create-action.svelte.ts),
   * so the ledger keeps no button of its own and answers the header's press instead.
   */
  export function openNew(): void {
    windowEntry = null;
    windowEditing = true;
    windowOpen = true;
  }

  function print(cost: CostLedgerEntry): void {
    printEntry = cost;
    printOpen = true;
  }

  function openReview(): void {
    reviewQueue = costs.filter((cost) => cost.status === "submitted");
    if (reviewQueue.length === 0) return;
    reviewOpen = true;
  }

  const waitingForReview = $derived(submittedCount(costs));

  /*
   * What the menu speaks for. Right-clicking inside the selection speaks for all of it; right-
   * clicking outside re-targets that one row first, so the scope comes from the selection and the
   * right-clicked row is only the fallback for the instant before the re-target lands.
   */
  let contextTarget = $state<CostLedgerEntry | null>(null);
  const menuScope = $derived(
    selectedCosts.length > 0 ? selectedCosts : contextTarget === null ? [] : [contextTarget],
  );

  function describeForMenu(cost: CostLedgerEntry): CostMenuRecord {
    return {
      identifier: cost.id,
      status: costStatusKey(cost.status),
      // The matter-scoped entry number is not served yet, so nothing offers to copy one.
      entryNumber: null,
      description: cost.description,
      amount: money(cost.amountMinor),
      invoiceId: cost.invoiceId ?? null,
    };
  }

  const menu = $derived.by((): RecordMenuModel => {
    const target = menuScope[0];
    if (target === undefined) return [];
    return costRecordMenu(menuScope.map(describeForMenu), describeForMenu(target), {
      reviewGateEnabled: REVIEW_GATE_ENABLED,
    });
  });

  /** Re-target the selection to the row under the pointer, without swallowing the menu's own event. */
  function retargetSelection(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest("[data-grid-row]") : null;
    const key = element?.getAttribute("data-grid-row") ?? null;
    if (key === null) return;
    contextTarget = costs.find((cost) => cost.id === key) ?? null;
    if (!grid.isSelected(key)) grid.rowClick(key, { repeated: true });
  }

  /*
   * The line naming one cost in a confirmation. The shared dialogs take it as a string rather than
   * a record, so they hold no cost vocabulary of their own; a null subject is how they read
   * "nothing is open".
   */
  function identify(cost: CostLedgerEntry | null): string | null {
    if (cost === null) return null;
    return `${formatDate(cost.incurredDate)} · ${payeeText(cost)} · ${money(cost.amountMinor)}`;
  }

  /** What a refused write says, in the reader's words rather than the transport's. */
  function refusalSentence(
    outcome: { kind: "problem"; failure: Failure } | { kind: "transport"; failure: Failure },
    what: string,
  ): StatedFailure {
    return stated(outcome.failure, `${what} was refused.`, `${what} is unchanged.`);
  }

  async function runChainVerb(
    targets: readonly CostLedgerEntry[],
    verb: (costEntryId: string) => Promise<ApiOutcome<CostAcknowledgement>>,
    what: string,
    done: string,
  ): Promise<void> {
    actionFailure = null;
    actionNotice = null;
    const outcomes = await Promise.all(targets.map((cost) => verb(cost.id)));
    const refused = outcomes.find((outcome) => outcome.kind !== "ok");
    if (refused === undefined) {
      actionNotice = done;
    } else {
      actionFailure = refusalSentence(refused, what);
    }
    onChanged();
  }

  function submitCosts(targets: readonly CostLedgerEntry[]): void {
    if (targets.length === 0) return;
    void runChainVerb(
      targets,
      (id) => submitCost(fetch, id, writeKey()),
      targets.length === 1 ? "The cost" : "One of the costs",
      `Submitted ${targets.length} ${targets.length === 1 ? "draft" : "drafts"} for review. Each is locked until it is approved or kicked back.`,
    );
  }

  function approveCosts(targets: readonly CostLedgerEntry[]): void {
    if (targets.length === 0) return;
    void runChainVerb(
      targets,
      (id) => approveCost(fetch, id, writeKey()),
      targets.length === 1 ? "The cost" : "One of the costs",
      `Approved ${targets.length} ${targets.length === 1 ? "cost" : "costs"}. ${targets.length === 1 ? "It is" : "They are"} billable on the next bill.`,
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
        // Duplicating starts a new draft from this cost's fields. Until a duplicate route exists,
        // the window opens on a blank draft rather than one silently pre-filled from a record the
        // server was never asked to copy.
        openNew();
        return;
      case "submit":
        submitCosts(targets.filter((cost) => cost.status === "draft"));
        return;
      case "approve":
        approveCosts(targets.filter((cost) => cost.status === "submitted"));
        return;
      case "kickBack":
        kickBackTarget = targets.find((cost) => cost.status === "submitted") ?? null;
        kickBackOpen = kickBackTarget !== null;
        return;
      case "void":
        voidTarget = first;
        voidOpen = true;
        return;
      case "print":
        print(first);
        return;
      case "openBill":
        // The bill lands on the matter's own Billing section with that bill open — the same place
        // the register would have opened it, so a reader arrives where they would have navigated.
        // The verb is refused where there is no bill, so reaching here means there is one.
        if (first.invoiceId != null) {
          void goto(billHref(matterId, first.invoiceId));
        }
        return;
      default:
        return;
    }
  }

  function copyMenuValue(identifier: string): void {
    const cost = menuScope[0];
    if (cost === undefined) return;
    const text =
      identifier === "description"
        ? cost.description
        : identifier === "amount"
          ? money(cost.amountMinor)
          : "";
    if (text !== "") void navigator.clipboard.writeText(text);
  }

  const figures = $derived(
    footerFigures(grid.isFiltered ? grid.rowsInView : costs, { filtered: grid.isFiltered }),
  );

  const sheet = $derived(
    printEntry === null
      ? null
      : costEntrySheet(printEntry, {
          matterTitle,
          matterNumber,
          money: (amount) => formatMoney(amount, { currency }),
          ...printSheetDates(),
          instant: (isoInstant) => formatInstant(isoInstant),
          printedAt: formatInstant(new Date()),
          expenseCodeLabels: expenseCodes.labelFor,
          source: printEntry.source,
        }),
  );

  const reviewTitle = $derived(
    waitingForReview === 0
      ? "Nothing is waiting for review"
      : `Go through the ${waitingForReview} submitted ${waitingForReview === 1 ? "cost" : "costs"} one by one: approve, kick back, or skip`,
  );

  /* The surface draws the notices band only while there is something to put in it. */
  const hasNotices = $derived(
    actionFailure !== null || actionNotice !== null || expenseCodes.refused,
  );

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

{#snippet cell({ row, column, text }: DataTable.GridCellContext<CostLedgerEntry>)}
  {#if isUnservedColumn(column.id)}
    <span class="text-text-subtle" title={unservedCellTitle(column.id)}>—</span>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.incurredDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.incurredDate)}</span>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.payee}
    {@const state = payeeState(row)}
    {#if state.kind === "unrecorded"}
      <span class="text-text-muted">Not recorded</span>
    {:else if state.kind === "gone"}
      <span class="text-text-subtle" title={GONE_PAYEE_NOTE}>No longer in the directory</span>
    {:else}
      <span class="block truncate" title={state.name}>{state.name}</span>
    {/if}
  {:else if column.id === COST_COLUMN_IDENTIFIERS.description}
    <span class="block truncate" title={row.description}>{row.description}</span>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.expenseCode}
    {@const reading = expenseCodeReading(row, expenseCodes.labelFor)}
    {#if reading === null}
      <span class="text-text-muted">&mdash;</span>
    {:else}
      <span class="tabular-nums" title={expenseCodeText(row, expenseCodes.labelFor)}>
        {reading.code}
      </span>
    {/if}
  {:else if column.id === COST_COLUMN_IDENTIFIERS.amount}
    <span class="whitespace-nowrap tabular-nums">
      {money(row.amountMinor)}
      {#if !row.billable}
        <span class="text-text-muted" title={ABSORBED_MEANING}>(absorbed)</span>
      {/if}
    </span>
  {:else if column.id === COST_COLUMN_IDENTIFIERS.billing}
    {#if row.billable}
      {billingLabel(true)}
    {:else}
      <span class="text-text-muted" title={ABSORBED_MEANING}>{billingLabel(false)}</span>
    {/if}
  {:else if column.id === COST_COLUMN_IDENTIFIERS.status}
    <Badge {...statusBadgeAttributes(costStatusKey(row.status))}>
      {statusEntry(costStatusKey(row.status)).label}
    </Badge>
  {:else}
    {text}
  {/if}
{/snippet}


{#snippet ledgerFigures()}
  <DataTable.GridFigures {grid} figures={footerReading} />
{/snippet}

<!-- Review is the one act this ledger adds to the surface's row, where the firm runs review. -->
{#snippet acts()}
  <Button
    variant="secondary"
    size="sm"
    disabled={waitingForReview === 0}
    title={reviewTitle}
    onclick={openReview}
  >
    <ListChecks class="size-16" aria-hidden="true" />
    {waitingForReview === 0 ? "Review" : `Review (${waitingForReview})`}
  </Button>
{/snippet}

{#snippet notices()}
  {#if actionFailure !== null}
    <FailureNotice failure={actionFailure.failure} title="Nothing Changed" fallback={actionFailure.fallback}>
      {#if actionFailure.failure.problem?.status === 409}
        <!-- A review verb against a firm that does not run review is refused as a conflict; saying
             so is more use to the reader than repeating the number. -->
        The firm&rsquo;s review setting is not served to this screen, so the server is the authority
        on whether review runs here.
      {/if}
    </FailureNotice>
  {:else if actionNotice !== null}
    <Alert.Root variant="success">
      <Alert.Title>Recorded</Alert.Title>
      <Alert.Description>{actionNotice}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if expenseCodes.refused}
    <p class="text-xs text-text-muted" title={gapCellTitle("expenseCodeCatalogue")}>
      Expense codes show only their ABA code, because you don't have permission to see their names.
    </p>
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
         product uses everywhere is still the thing that opens. The role is presentational:
         this element adds no semantics of its own, it only notices where the pointer was. -->
    <div class="flex min-h-0 flex-1 flex-col" role="presentation" oncontextmenu={retargetSelection}>
      <!-- The list takes the height it is given and scrolls inside itself, so a long ledger
           never grows the page and never pushes its own counts strip out of reach. The class
           and the density are the surface's: flush, it takes the grid's frame away. -->
      <DataTable.Grid
        {grid}
        {cell}
        {frame}
        class={tableClass}
        {density}
        caption="Costs recorded on this matter"
        {loading}
      />
    </div>
  </RecordMenu>
{/snippet}

{#snippet panel()}
  <CostDetailsPanel
    {costs}
    selected={selectedCosts}
    {currency}
    expenseCodeLabels={expenseCodes.labelFor}
    {canApprove}
    onOpen={(cost) => openRecord(cost, canWorkDraft(cost).allowed)}
    onPrint={print}
    onSubmit={submitCosts}
    onApprove={approveCosts}
    onLetGo={() => grid.clearSelection()}
  />
{/snippet}

<MoneySurface
  {matterId}
  section="costs"
  {grid}
  autoSaveId="matter-costs-panes"
  {panelOpen}
  onTogglePanel={(open) => panelPreference.set(open ? "open" : "closed")}
  acts={REVIEW_GATE_ENABLED ? acts : undefined}
  notices={hasNotices ? notices : undefined}
  {list}
  {panel}
  figures={ledgerFigures}
  {beneath}
/>

<CostRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  entry={windowEntry}
  {matterId}
  {matterTitle}
  {matterNumber}
  {currency}
  {expenseCodes}
  {canWorkDraft}
  onSaved={onChanged}
/>

<CostReviewWindow
  bind:open={reviewOpen}
  queue={reviewQueue}
  {currency}
  expenseCodeLabels={expenseCodes.labelFor}
  onApproved={onChanged}
  onKickBack={(cost) => {
    kickBackTarget = cost;
    kickBackOpen = true;
  }}
/>

<RecordKickBackDialog
  bind:open={kickBackOpen}
  noun="Cost"
  subject={identify(kickBackTarget)}
  commit={(reason) =>
    kickBackCost(fetch, kickBackTarget?.id ?? "", reason, writeKey())}
  onKickedBack={onChanged}
/>

<RecordVoidDialog
  bind:open={voidOpen}
  noun="Cost"
  subject={identify(voidTarget)}
  consequence="The cost freezes and stops counting toward the matter's totals: a withdrawn cost was never advanced."
  commit={() => voidCost(fetch, voidTarget?.id ?? "", writeKey())}
  onVoided={onChanged}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
