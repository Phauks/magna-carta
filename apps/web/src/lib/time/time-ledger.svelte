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
   * THE FRAME IS THE MONEY SURFACE'S (apps/web/src/lib/money/). The toolbar under the section strip,
   * the acts row with the way out of a filter, the counts strip and the pane toggle are drawn once
   * there, for every money section; this file declares its columns, its cells, its figures, its
   * verbs and its panel, and hands them over. Drawing any of the frame here again is the defect the
   * surface exists to remove.
   *
   * THE REVIEW VOCABULARY IS ABSENT, NOT DISABLED. Whether a firm runs review is a firm setting and
   * it is not served, so the lifecycle reads draft to billed, nothing solicits a submission, and no
   * Review control appears. A disabled "Submit" would be soliciting a workflow this firm has not
   * been asked about.
   */
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant, formatInstantDate } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { MoneySurface, billHref, type MoneySurfaceDensity } from "$lib/money/index.ts";
  import {
    RecordMenu,
    ledgerRecordMenu,
    type LedgerRecord,
    type RecordMenuAction,
    type RecordMenuModel,
  } from "$lib/records/index.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import { readTimeEntry, type TimeEntrySummary } from "$lib/matters/time-api.ts";
  import {
    TIME_COLUMN_IDENTIFIERS,
    chargeAmount,
    durationParts,
    isUnservedColumn,
    timeLedgerColumns,
    timekeeperOf,
    unservedCellTitle,
  } from "./time-columns.ts";
  import { personInitials } from "@magna-carta/design-system/formatters";
  import { footerFigures, ledgerCurrency } from "./time-figures.ts";
  import TimeDetailsPanel from "./time-details-panel.svelte";
  import TimeRecordWindow from "./time-record-window.svelte";
  import { timeEntrySheet } from "./time-print-sheet.ts";
  import type { ApiOutcome, Failure } from "$lib/api/request.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import {
    approveTimeEntry,
    submitTimeEntry,
    unvoidTimeEntry,
    voidTimeEntry,
    writeKey,
    type TimeEntryDraftFields,
  } from "./time-operations.ts";

  let {
    entries,
    matterId,
    matterTitle,
    members,
    sessionUserId,
    loading = false,
    openEntryId = null,
    onChanged,
    beneath = undefined,
  }: {
    /** Every entry on the matter, in every status: that is what a matter's time record is. */
    entries: readonly TimeEntrySummary[];
    matterId: string;
    matterTitle: string;
    members: readonly FirmMemberSummary[];
    sessionUserId: string | null;
    loading?: boolean;
    /** An entry to open on arrival — what a deep link into this section names. */
    openEntryId?: string | null;
    /** Something was written; the matter's time wants re-reading. */
    onChanged: () => void;
    /** What the page puts directly above the counts strip: its Load more control. */
    beneath?: Snippet;
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
  /** What a new entry's fields start holding, when it is being started FROM something. */
  let windowPrefill = $state<TimeEntryDraftFields | null>(null);
  let actionNotice = $state<string | null>(null);
  let printEntry = $state<TimeEntrySummary | null>(null);
  let printOpen = $state(false);
  let actionFailure = $state<StatedFailure | null>(null);
  /*
   * A refusal this SCREEN makes, with no call behind it. Kept apart from actionFailure because it
   * has no problem document, no Error ID and nothing to report: it is a statement about what the
   * product does not do yet, and dressing it as a server failure would send somebody to support
   * over a capability nobody has built.
   */
  let actionRefusal = $state<string | null>(null);

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
    windowPrefill = null;
    windowEditing = editing && canWorkDraft(entry).allowed;
    windowOpen = true;
  }

  /*
   * The entry this ledger was asked to open, opened the way any entry opens: from the loaded page
   * where it is on it, else read by its id — an entry older than the first page opens all the same.
   * Once per id.
   */
  let honouredEntryId = $state<string | null>(null);
  $effect(() => {
    const wanted = openEntryId;
    if (wanted === null || loading || honouredEntryId === wanted) return;
    honouredEntryId = wanted;
    const loaded = entries.find((entry) => entry.id === wanted);
    if (loaded !== undefined) {
      openRecord(loaded, false);
      return;
    }
    void readTimeEntry(fetch, wanted).then((outcome) => {
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
    windowPrefill = null;
    windowEditing = true;
    windowOpen = true;
  }

  /**
   * Start a new draft holding this entry's fields.
   *
   * What carries is what the listing serves: the description, the day the work was for, the time
   * worked, whether it bills and whose work it is. The category, the activity code and the resolved
   * rate a duplicate should also bring are not served to this screen, so they are not brought — but
   * that is a reason to copy less, never a reason to copy nothing, and the emptied form was
   * dropping the three facts the screen was holding all along.
   */
  function duplicateEntry(entry: TimeEntrySummary): void {
    windowEntry = null;
    windowPrefill = {
      narrative: entry.narrative,
      workDate: entry.workDate,
      rawDurationMinutes: entry.rawDurationMinutes,
      billable: entry.billable,
      timekeeperUserId: entry.timekeeperUserId,
    };
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
      // A voided time entry can be put back. The time ledger is the only one that can say this
      // today, which is exactly why the menu takes it as a fact about the surface rather than
      // assuming every ledger has the route.
      canRestoreVoid: true,
      // The time ledger has somewhere to send a reader — the matter's Billing section, with that
      // bill open — so it declares the verb the shared catalogue holds. Its own invoiceId has been
      // on the wire since the entry contract was written; nothing on this surface read it.
      opensTheBill: true,
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

  function describeForMenu(entry: TimeEntrySummary): LedgerRecord {
    return {
      identifier: entry.id,
      status: entry.status,
      // The matter-scoped entry number is not recorded yet, so nothing offers to copy one.
      entryNumber: null,
      description: entry.narrative,
      amount: chargeAmount(entry) === null ? "No charge" : chargeText(entry),
      invoiceId: entry.invoiceId ?? null,
    };
  }

  /** What a refused write says, in the reader's words rather than the transport's. */
  function refusalSentence(
    outcome: { kind: "problem"; failure: Failure } | { kind: "transport"; failure: Failure },
    what: string,
  ): StatedFailure {
    return stated(outcome.failure, `${what} was refused.`, `${what} is unchanged.`);
  }

  /**
   * Run one chain verb over every target and REPORT WHAT CAME BACK.
   *
   * Firing the calls and throwing their outcomes away is how a refused submit becomes silence: the
   * list re-reads, the entry has not moved, and nothing on screen says why. The first refusal is
   * what the reader is told about, because the reason is almost always the same one for all of them.
   */
  async function runChainVerb(
    targets: readonly TimeEntrySummary[],
    verb: (timeEntryId: string) => Promise<ApiOutcome<unknown>>,
    what: string,
    done: string,
  ): Promise<void> {
    actionFailure = null;
    actionRefusal = null;
    actionNotice = null;
    const outcomes = await Promise.all(targets.map((entry) => verb(entry.id)));
    const refused = outcomes.find((outcome) => outcome.kind !== "ok");
    if (refused === undefined) actionNotice = done;
    else actionFailure = refusalSentence(refused, what);
    onChanged();
  }

  async function runMenuAction(action: RecordMenuAction): Promise<void> {
    const targets = menuScope;
    const first = targets[0];
    if (first === undefined) return;
    actionFailure = null;
    actionRefusal = null;
    actionNotice = null;
    switch (action.identifier) {
      case "open":
        openRecord(first, canWorkDraft(first).allowed);
        return;
      case "openBill":
        // The matter's own Billing section, with that bill open — the same place the register would
        // have opened it. The verb is refused where there is no bill, so reaching here means one.
        if (first.invoiceId != null) {
          void goto(billHref(matterId, first.invoiceId));
        }
        return;
      case "duplicate":
        duplicateEntry(first);
        return;
      case "submit":
        await runChainVerb(
          targets,
          (id) => submitTimeEntry(fetch, id, writeKey()),
          targets.length === 1 ? "The entry" : "One of the entries",
          `Submitted ${String(targets.length)} ${targets.length === 1 ? "draft" : "drafts"} for review. Each is locked until it is approved or kicked back.`,
        );
        return;
      case "approve":
        await runChainVerb(
          targets,
          (id) => approveTimeEntry(fetch, id, writeKey()),
          targets.length === 1 ? "The entry" : "One of the entries",
          `Approved ${String(targets.length)} ${targets.length === 1 ? "entry" : "entries"}. ${targets.length === 1 ? "It is" : "They are"} billable on the next bill.`,
        );
        return;
      case "kickBack":
        // The settled design makes the reason optional and records it only when given; the route
        // requires one. Rather than inventing a sentence nobody wrote, the act says what stands in
        // its way. It is unreachable while the review vocabulary is absent.
        actionRefusal =
          "Kick Back isn't available here yet. The entry is unchanged.";
        return;
      case "void": {
        const outcome = await voidTimeEntry(fetch, first.id, writeKey());
        if (outcome.kind !== "ok") {
          actionFailure = refusalSentence(outcome, "The entry");
          return;
        }
        actionNotice = "The entry was voided. It stays on the ledger and counts toward nothing.";
        onChanged();
        return;
      }
      case "unvoid": {
        const outcome = await unvoidTimeEntry(fetch, first.id, writeKey());
        if (outcome.kind !== "ok") {
          actionNotice =
            outcome.kind === "problem" && outcome.problem.status === 409
              ? "The entry wasn't restored. It may no longer be voided, or its value was moved to a cost, and restoring it would charge for the same work twice."
              : "The entry was not restored. It is still voided on the ledger.";
          return;
        }
        onChanged();
        actionNotice = "The entry is a draft again, with its number, its note and its files.";
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
          ...printSheetDates(),
          printedAt: formatInstant(new Date()),
        }),
  );

  /* The surface draws the notices band only while there is something to put in it. */
  const hasNotices = $derived(
    actionFailure !== null || actionRefusal !== null || actionNotice !== null,
  );

  /*
   * The domain figures as the shared strip reads them: the money is turned into text HERE, in the
   * matter's own currency, because the strip owns the arrangement and never the formatting.
   */
  const footerReading = $derived(
    figures.map((figure) => ({
      identifier: figure.identifier,
      label: figure.label,
      value: money(figure.amountMinor / 100),
      caption: figure.caption,
    })),
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


{#snippet ledgerFigures()}
  <DataTable.GridFigures {grid} figures={footerReading} />
{/snippet}

{#snippet notices()}
  {#if actionFailure !== null}
    <FailureNotice
      failure={actionFailure.failure}
      title="Nothing Changed"
      fallback={actionFailure.fallback}
      whenSilent={actionFailure.whenSilent}
    />
  {:else if actionRefusal !== null}
    <Alert.Root variant="danger">
      <Alert.Title>Nothing Changed</Alert.Title>
      <Alert.Description>{actionRefusal}</Alert.Description>
    </Alert.Root>
  {:else if actionNotice !== null}
    <Alert.Root variant="info">
      <Alert.Description>{actionNotice}</Alert.Description>
    </Alert.Root>
  {/if}
{/snippet}

{#snippet list({ density, tableClass, frame }: { density: MoneySurfaceDensity; tableClass: string; frame: "card" | "flush" })}
  <RecordMenu
    class="flex min-h-0 flex-1 flex-col"
    {menu}
    onAction={(action) => void runMenuAction(action)}
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
        caption="Time recorded on this matter"
        {loading}
      />
    </div>
  </RecordMenu>
{/snippet}

{#snippet panel()}
  <TimeDetailsPanel
    {entries}
    selected={selectedEntries}
    {currency}
    onOpen={(entry) => openRecord(entry, canWorkDraft(entry).allowed)}
    onPrint={print}
    onLetGo={() => grid.clearSelection()}
  />
{/snippet}

<MoneySurface
  {matterId}
  section="time"
  {grid}
  autoSaveId="matter-time-panes"
  {panelOpen}
  onTogglePanel={(open) => panelPreference.set(open ? "open" : "closed")}
  notices={hasNotices ? notices : undefined}
  {list}
  {panel}
  figures={ledgerFigures}
  {beneath}
/>

<TimeRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  entry={windowEntry}
  prefill={windowPrefill}
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
