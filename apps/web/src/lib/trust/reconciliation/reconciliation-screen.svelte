<script lang="ts">
  /*
   * ONE RECONCILIATION — a trust account's book ticked off against one bank statement.
   *
   * THE TICK IS THE WHOLE GESTURE. Every item the bank account saw on or before the end date, and
   * not cleared on an earlier reconciliation, is listed; ticking one says the statement shows it.
   * Each tick saves on its own, and the figures move with it: the start balance, plus the cleared
   * deposits, less the cleared withdrawals, is the cleared balance, and the difference from the
   * statement's end balance is what is left to find.
   *
   * NOTHING IS LOCKED. People keep recording money while a reconciliation is open. An item recorded
   * after it was started, dated inside its period, joins the list marked New. Several people can
   * tick the same period; the screen reads itself again every few seconds, so each sees the
   * others' ticks without a Refresh button.
   *
   * EVERY CHANGE CAN BE TAKEN BACK. Undo and Redo walk the reader's own changes; History lists
   * everyone's and undoes any one of them; Save keeps a named point and Restore Points goes back to
   * one, saving the point it leaves first. Notes are never undone.
   *
   * NO ROW IS COLOURED. A line that needs review shows its count in the Note column, and the
   * filters find it; the row itself reads like every other.
   *
   * THE OUTSIDE WORLD IS HANDED IN, so the developer gallery renders this same screen over
   * fixtures.
   */
  import { balanceChangeMinor, interestTotalMinor } from "@magna-carta/trust/bank-reconciliation-figures";
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import { formatDate, formatInstant, formatInstantDate } from "@magna-carta/design-system/formatters";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import FileText from "@lucide/svelte/icons/file-text";
  import History from "@lucide/svelte/icons/history";
  import Lock from "@lucide/svelte/icons/lock";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Plus from "@lucide/svelte/icons/plus";
  import Printer from "@lucide/svelte/icons/printer";
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Save from "@lucide/svelte/icons/save";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import X from "@lucide/svelte/icons/x";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { withAccount, type BackDestination } from "$lib/screen/screen-header.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { trustMoneyText } from "$lib/trust/firm-trust-vocabulary.ts";
  import type {
    TrustBankReconciliationChange,
    TrustBankReconciliationDetail,
    TrustBankReconciliationEdit,
    TrustBankReconciliationInterest,
    TrustBankReconciliationInterestRequest,
    TrustBankReconciliationItem,
    TrustBankReconciliationLine,
    TrustBankReconciliationNote,
  } from "./reconciliation-api.ts";
  import type { ReconciliationService } from "./reconciliation-service.ts";
  import { ITEM_COLUMNS, itemColumns, wholeUnits } from "./reconciliation-columns.ts";
  import {
    TYPE_FILTERS,
    balanceFieldText,
    entryLine,
    filterItems,
    interestLine,
    lineDescription,
    lineKey,
    linesNeedingReview,
    noteCounts,
    periodText,
    readBalanceMinor,
    statusLabel,
    statusOf,
    statusTone,
    typeCounts,
    typeLabel,
    withEndBalance,
    withTicks,
    type StateFilter,
    type TypeFilter,
  } from "./reconciliation-model.ts";
  import { reconciliationReport } from "./reconciliation-report.ts";
  import { readLive } from "./live-read.ts";
  import ReconciliationNotesSheet from "./reconciliation-notes-sheet.svelte";
  import ReconciliationHistoryDialog from "./reconciliation-history-dialog.svelte";
  import ReconciliationTransactionDialog from "./reconciliation-transaction-dialog.svelte";
  import ReconciliationSaveDialog from "./reconciliation-save-dialog.svelte";
  import ReconciliationInterestDialog from "./reconciliation-interest-dialog.svelte";
  import ReconciliationFinishDialog from "./reconciliation-finish-dialog.svelte";

  let {
    reconciliationId,
    accountName,
    back: list,
    service,
    manageRefusal,
    now = () => new Date().toISOString(),
    live = true,
  }: {
    reconciliationId: string;
    /** The account's own name, or null while the accounts are read. */
    accountName: string | null;
    /** The reconciliation list this screen goes back to; the account is added once it is known. */
    back: BackDestination;
    service: ReconciliationService;
    /** Why this reader may not change the reconciliation, or undefined where they may. */
    manageRefusal: string | undefined;
    /** The present instant, for the report's made-on line. */
    now?: () => string;
    /** Whether to read again every few seconds; the gallery turns it off. */
    live?: boolean;
  } = $props();

  // ---- the read ----------------------------------------------------------------------------------

  let detail = $state<TrustBankReconciliationDetail | null>(null);
  let failure = $state<Failure | null>(null);
  /** Writes in flight. A read that lands while one is would put back what it is changing. */
  let writing = $state(0);
  let saveState = $state<"saved" | "saving" | "failed">("saved");
  let writeFailure = $state<Failure | null>(null);

  async function load(): Promise<void> {
    const outcome = await service.read(reconciliationId);
    if (writing > 0) return;
    if (outcome.kind !== "ok") {
      if (detail === null) failure = outcome.failure;
      return;
    }
    failure = null;
    detail = outcome.value;
  }

  $effect(() => {
    void reconciliationId;
    untrack(() => void load());
    if (!live) return;
    return readLive(() => void load());
  });

  /** Run one write, keep the status line honest, and read again once it lands. */
  async function write(run: () => Promise<{ kind: string; failure?: Failure }>): Promise<Failure | null> {
    writing += 1;
    saveState = "saving";
    const outcome = await run();
    writing -= 1;
    if (outcome.kind !== "ok") {
      saveState = "failed";
      writeFailure = outcome.failure ?? null;
      await load();
      return outcome.failure ?? null;
    }
    writeFailure = null;
    if (writing === 0) {
      saveState = "saved";
      await load();
    }
    return null;
  }

  const header = $derived(detail?.reconciliation ?? null);
  const finished = $derived(header?.finishedAt != null);
  const currency = $derived(header?.currency ?? "USD");
  const money = (minor: number): string => trustMoneyText(minor, currency);
  const period = $derived(header === null || detail === null ? "" : periodText(header.startDate, detail.endDate));
  const status = $derived(detail === null ? null : statusOf({ differenceMinor: detail.figures.differenceMinor, reconciliation: detail.reconciliation }));

  /** Why the ticks, dates and balance may not change, or undefined where they may. */
  const editRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (detail === null) return "Reading the reconciliation.";
    if (finished) return "This reconciliation is finished.";
    return undefined;
  });

  const back = $derived(header === null ? list : withAccount(list, header.trustAccountId));
  const checksHref = $derived(
    header === null ? "/trust/checks" : `/trust/checks?account=${encodeURIComponent(header.trustAccountId)}`,
  );

  // ---- ticking -----------------------------------------------------------------------------------

  function edit(edits: readonly TrustBankReconciliationEdit[]): Promise<Failure | null> {
    const key = crypto.randomUUID();
    return write(() => service.edit(reconciliationId, edits, key));
  }

  function tick(line: TrustBankReconciliationLine, cleared: boolean): void {
    if (detail === null || editRefusal !== undefined) return;
    detail = withTicks(detail, [{ line, cleared }]);
    void edit([{ kind: "tick", line, cleared }]);
  }

  /** Tick or untick every line the filters show, in one change per line and one request. */
  function tickShown(cleared: boolean): void {
    if (detail === null || editRefusal !== undefined) return;
    const lines = shownItems
      .filter((item) => item.cleared !== cleared)
      .map((item) => entryLine(item.entryId));
    if (lines.length === 0) return;
    detail = withTicks(detail, lines.map((line) => ({ line, cleared })));
    void edit(lines.map((line) => ({ kind: "tick" as const, line, cleared })));
  }

  // ---- end date and end balance -----------------------------------------------------------------

  let endBalanceText = $state("");
  let endBalanceFocused = $state(false);
  $effect(() => {
    const minor = detail?.endBalanceMinor ?? null;
    if (!endBalanceFocused) endBalanceText = minor === null ? "" : money(minor);
  });
  const endBalanceReading = $derived(readBalanceMinor(endBalanceText));
  const endBalanceInvalid = $derived(typeof endBalanceReading === "object" && endBalanceReading !== null);

  function commitEndBalance(): void {
    endBalanceFocused = false;
    if (detail === null || typeof endBalanceReading !== "number") {
      if (endBalanceReading === null) {
        endBalanceText = detail?.endBalanceMinor == null ? "" : money(detail.endBalanceMinor);
      }
      return;
    }
    if (endBalanceReading === detail.endBalanceMinor) {
      endBalanceText = money(endBalanceReading);
      return;
    }
    detail = withEndBalance(detail, endBalanceReading);
    void edit([{ kind: "end_balance", endBalanceMinor: endBalanceReading }]);
  }

  function commitEndDate(next: string): void {
    if (detail === null || next === "" || next === detail.endDate) return;
    if (header !== null && next < header.startDate) return;
    detail = { ...detail, endDate: next };
    void edit([{ kind: "end_date", endDate: next }]);
  }

  // ---- undo, redo, history, save and restore -----------------------------------------------------

  function revert(kind: "undo" | "redo"): void {
    const key = crypto.randomUUID();
    void write(() => service.revert(reconciliationId, { kind }, key));
  }

  function undoFromHistory(change: TrustBankReconciliationChange): Promise<Failure | null> {
    const key = crypto.randomUUID();
    return write(() =>
      service.revert(reconciliationId, { kind: "history", changeId: change.changeId }, key),
    );
  }

  let historyOpen = $state(false);
  let saveOpen = $state(false);

  function save(name: string, key: string): Promise<Failure | null> {
    return write(() => service.save(reconciliationId, name, key));
  }

  const restorePoints = $derived([...(detail?.restorePoints ?? [])].reverse());

  function restore(restorePointId: string): void {
    const key = crypto.randomUUID();
    void write(() => service.restore(reconciliationId, restorePointId, key));
  }

  // ---- notes ---------------------------------------------------------------------------------------

  const review = $derived(linesNeedingReview(detail?.notes ?? []));
  const counts = $derived(noteCounts(detail?.notes ?? []));
  let notesOpen = $state(false);
  let notesLine = $state<TrustBankReconciliationLine | null>(null);

  function openNotes(line: TrustBankReconciliationLine): void {
    notesLine = line;
    notesOpen = true;
  }

  const notesHeading = $derived(
    detail === null || notesLine === null ? "" : lineDescription(notesLine, detail, money),
  );
  const notesDetail = $derived.by((): string => {
    if (detail === null || notesLine === null) return "";
    const line = notesLine;
    if (line.kind === "interest") {
      const found = detail.interest.find((one) => one.interestId === line.interestId);
      return found === undefined ? "IOLTA interest" : `IOLTA interest, ${formatDate(found.postedOn)}`;
    }
    const item = detail.items.find((one) => one.entryId === line.entryId);
    if (item === undefined) return "";
    const parts = [typeLabel(item.type), formatDate(item.effectiveDate)];
    if (item.matterNumber !== null) parts.push(`Matter ${item.matterNumber}`);
    return parts.join(", ");
  });

  function writeNote(
    line: TrustBankReconciliationLine,
    kind: TrustBankReconciliationNote["kind"],
    body: string | null,
  ): Promise<Failure | null> {
    const key = crypto.randomUUID();
    return write(() => service.addNote(reconciliationId, { line, kind, body }, key));
  }

  // ---- files ---------------------------------------------------------------------------------------

  let fileInput = $state<HTMLInputElement | null>(null);

  async function attach(list: FileList | null): Promise<void> {
    for (const file of Array.from(list ?? [])) {
      const key = crypto.randomUUID();
      await write(() => service.attachFile(reconciliationId, file, key));
    }
    if (fileInput !== null) fileInput.value = "";
  }

  async function openFile(fileId: string): Promise<void> {
    const url = await service.fileUrl(reconciliationId, fileId);
    if (url !== null) {
      service.openUrl(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  function removeFile(fileId: string): void {
    const key = crypto.randomUUID();
    void write(() => service.removeFile(reconciliationId, fileId, key));
  }

  // ---- interest ------------------------------------------------------------------------------------

  let interestOpen = $state(false);

  function addInterest(request: TrustBankReconciliationInterestRequest, key: string): Promise<Failure | null> {
    return write(() => service.addInterest(reconciliationId, request, key));
  }

  function removeInterest(interestId: string): void {
    const key = crypto.randomUUID();
    void write(() => service.removeInterest(reconciliationId, interestId, key));
  }

  const interestTotals = $derived.by(() => {
    const lines = detail?.interest ?? [];
    const credited = interestTotalMinor(currency, lines, "credited");
    const swept = interestTotalMinor(currency, lines, "swept");
    // What stays in the account: the credits less the sweeps, the same subtraction as a change.
    return { credited, swept, left: balanceChangeMinor(currency, swept, credited) ?? 0 };
  });

  // ---- finishing and the report ------------------------------------------------------------------

  let finishOpen = $state(false);

  const finishRefusal = $derived.by((): string | undefined => {
    if (editRefusal !== undefined) return editRefusal;
    if (detail?.endBalanceMinor == null) return "Enter the end balance first.";
    if (writing > 0) return "Saving the last change.";
    return undefined;
  });

  function finish(key: string): Promise<Failure | null> {
    return write(() => service.finish(reconciliationId, key));
  }

  let printing = $state(false);
  let printFailure = $state<string | null>(null);

  async function print(): Promise<void> {
    if (detail === null) return;
    printing = true;
    printFailure = null;
    try {
      const pdf = await service.composeReport(
        reconciliationReport({ detail, accountName: accountName ?? "Trust account", money, made: now() }),
      );
      service.openPdf(pdf);
    } catch (error) {
      printFailure = error instanceof Error ? error.message : "Couldn't make the PDF.";
    }
    printing = false;
  }

  const printLabel = $derived(finished ? "Print Report" : "Print Draft Report");

  // ---- the lists -----------------------------------------------------------------------------------

  let typeFilter = $state<TypeFilter>("all");
  let stateFilter = $state<StateFilter>("all");

  const items = $derived(detail?.items ?? []);
  const shownItems = $derived(filterItems(items, typeFilter, stateFilter, review));
  const typeCount = $derived(typeCounts(items));
  const stateCounts = $derived({
    uncleared: items.filter((item) => !item.cleared).length,
    review: items.filter((item) => review.has(`entry:${item.entryId}`)).length,
    isNew: items.filter((item) => item.isNew).length,
  });
  const typeItems = $derived(
    (["all", ...TYPE_FILTERS] as const)
      .filter((type) => type === "all" || (typeCount.get(type) ?? 0) > 0 || type === typeFilter)
      .map((type) => ({ value: type, label: `${typeLabel(type)} (${typeCount.get(type) ?? 0})` })),
  );

  let opened = $state<TrustBankReconciliationItem | null>(null);
  let transactionOpen = $state(false);

  const itemGrid = DataTable.createDataTableGrid<TrustBankReconciliationItem>({
    columns: () =>
      itemColumns({ currency, noteCount: (entryId) => counts.get(`entry:${entryId}`) ?? 0 }),
    rows: () => shownItems,
    rowKey: (row) => row.entryId,
    initialSort: { columnId: ITEM_COLUMNS.date, direction: "ascending" },
    itemNoun: { singular: "item", plural: "items" },
    onActivate: (row) => {
      opened = row;
      transactionOpen = true;
    },
  });

  const INTEREST_COLUMNS = {
    cleared: "cleared",
    date: "date",
    what: "what",
    credited: "credited",
    swept: "swept",
    note: "note",
    act: "act",
  } as const;

  const interestGrid = DataTable.createDataTableGrid<TrustBankReconciliationInterest>({
    columns: (): readonly DataTable.GridColumn<TrustBankReconciliationInterest>[] => [
      {
        id: INTEREST_COLUMNS.cleared,
        label: "Cleared",
        anchored: true,
        filter: "none",
        value: (row) => (row.cleared ? 1 : 0),
        text: () => "",
      },
      { id: INTEREST_COLUMNS.date, label: "Date", type: "date", value: (row) => row.postedOn },
      { id: INTEREST_COLUMNS.what, label: "What", type: "text", filter: "text", value: (row) => row.description },
      {
        id: INTEREST_COLUMNS.credited,
        label: "Credited",
        type: "money",
        currency,
        value: (row) => (row.kind === "credited" ? wholeUnits(row.amountMinor, currency) : null),
      },
      {
        id: INTEREST_COLUMNS.swept,
        label: "Swept Out",
        type: "money",
        currency,
        value: (row) => (row.kind === "swept" ? wholeUnits(row.amountMinor, currency) : null),
      },
      {
        id: INTEREST_COLUMNS.note,
        label: "Note",
        type: "number",
        filter: "none",
        value: (row) => counts.get(`interest:${row.interestId}`) ?? 0,
        text: () => "",
      },
      { id: INTEREST_COLUMNS.act, label: "Remove", filter: "none", value: () => null, text: () => "" },
    ],
    rows: () => detail?.interest ?? [],
    rowKey: (row) => row.interestId,
    initialSort: { columnId: null, direction: "ascending" },
    itemNoun: { singular: "line", plural: "lines" },
  });

  /*
   * On a phone the list keeps what a reader ticks by (the date, the payee, the amount) and sets
   * the rest aside; the header menu's Columns submenu still brings any of them back.
   */
  const narrow = new MediaQuery("max-width: 40rem");
  $effect(() => {
    const wide = !narrow.current;
    untrack(() => {
      for (const id of [
        ITEM_COLUMNS.type,
        ITEM_COLUMNS.number,
        ITEM_COLUMNS.matter,
        ITEM_COLUMNS.date,
        ITEM_COLUMNS.deposit,
        ITEM_COLUMNS.withdrawal,
      ]) {
        itemGrid.setColumnVisible(id, wide);
      }
      // On a phone the way into a line's notes sits beside its payee instead.
      itemGrid.setColumnVisible(ITEM_COLUMNS.note, wide);
      for (const id of [INTEREST_COLUMNS.date, INTEREST_COLUMNS.note]) {
        interestGrid.setColumnVisible(id, wide);
      }
    });
  });

  const savedText = $derived(
    saveState === "saving" ? "Saving" : saveState === "failed" ? "Not saved" : "Saved",
  );
</script>

{#snippet noteButton(line: TrustBankReconciliationLine, count: number)}
  {@const needs = review.has(lineKey(line))}
  <Button
    variant="ghost"
    size="sm"
    aria-label={count === 0 ? "Add a note" : `${count} ${count === 1 ? "note" : "notes"}${needs ? ", needs review" : ""}`}
    onclick={(event: MouseEvent) => {
      event.stopPropagation();
      openNotes(line);
    }}
  >
    <MessageSquare class={count === 0 ? "size-16 text-text-muted" : "size-16"} aria-hidden="true" />
    {#if count > 0}<span class="tabular-nums">{count}</span>{/if}
    {#if needs}<span class="text-xs text-status-warning">Review</span>{/if}
  </Button>
{/snippet}

{#snippet tickBox(line: TrustBankReconciliationLine, cleared: boolean, label: string)}
  <!-- The press is the checkbox's alone: a row press selects the row. -->
  <span
    class="inline-flex"
    role="presentation"
    onclick={(event) => event.stopPropagation()}
    onkeydown={(event) => {
      if (event.key === " " || event.key === "Enter") event.stopPropagation();
    }}
  >
    <Checkbox
      checked={cleared}
      aria-label={label}
      disabled={editRefusal !== undefined}
      onCheckedChange={(next) => tick(line, next === true)}
    />
  </span>
{/snippet}

{#snippet itemCell({ row, column, text }: DataTable.GridCellContext<TrustBankReconciliationItem>)}
  {#if column.id === ITEM_COLUMNS.cleared}
    {@render tickBox(entryLine(row.entryId), row.cleared, `Cleared: ${row.payeeOrFrom ?? row.description}`)}
  {:else if column.id === ITEM_COLUMNS.payee}
    <span class="inline-flex items-center gap-8">
      <span class="flex flex-col">
        <span>{text}</span>
        <!-- On a phone the amount reads under the payee, a withdrawal with a minus sign. -->
        {#if narrow.current}
          <span class="text-xs text-text-muted tabular-nums">
            {row.amountMinor < 0 ? `-${money(-row.amountMinor)}` : money(row.amountMinor)}
          </span>
        {/if}
      </span>
      {#if row.isNew}<Badge {...statusBadgeAttributes("reconciliation-new")}>{statusEntry("reconciliation-new").label}</Badge>{/if}
      {#if narrow.current}
        {@render noteButton(entryLine(row.entryId), counts.get(`entry:${row.entryId}`) ?? 0)}
      {/if}
    </span>
  {:else if column.id === ITEM_COLUMNS.matter && row.firmFunds}
    <span class="text-text-muted">{text}</span>
  {:else if column.id === ITEM_COLUMNS.note}
    {@render noteButton(entryLine(row.entryId), counts.get(`entry:${row.entryId}`) ?? 0)}
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet interestCell({ row, column, text }: DataTable.GridCellContext<TrustBankReconciliationInterest>)}
  {#if column.id === INTEREST_COLUMNS.cleared}
    {@render tickBox(interestLine(row.interestId), row.cleared, `Cleared: ${row.description}`)}
  {:else if column.id === INTEREST_COLUMNS.note}
    {@render noteButton(interestLine(row.interestId), counts.get(`interest:${row.interestId}`) ?? 0)}
  {:else if column.id === INTEREST_COLUMNS.act}
    {#if !finished}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${row.description}`}
        disabled={editRefusal !== undefined}
        title={editRefusal}
        onclick={() => removeInterest(row.interestId)}
      >
        <Trash2 class="size-16" aria-hidden="true" />
      </Button>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet restoreItems()}
  {#if restorePoints.length === 0}
    <DropdownMenu.Item disabled>No restore points yet</DropdownMenu.Item>
  {:else}
    {#each restorePoints as point (point.restorePointId)}
      <DropdownMenu.Item
        disabled={editRefusal !== undefined}
        onSelect={() => restore(point.restorePointId)}
      >
        <RotateCcw class="size-16 shrink-0" aria-hidden="true" />
        <span class="flex flex-col">
          <span>{point.name}</span>
          <span class="text-xs text-text-muted">
            {point.savedByName ?? "Someone"}, {formatInstant(point.savedAt)}
          </span>
        </span>
      </DropdownMenu.Item>
    {/each}
  {/if}
{/snippet}

{#snippet pageMenu()}
  {#if narrow.current && !finished}
    <DropdownMenu.Item disabled={editRefusal !== undefined} onSelect={() => (saveOpen = true)}>
      <Save class="size-16 shrink-0" aria-hidden="true" />
      Save
    </DropdownMenu.Item>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <RotateCcw class="size-16 shrink-0" aria-hidden="true" />
        Restore Points
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>{@render restoreItems()}</DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  {/if}
  {#if narrow.current}
    <DropdownMenu.Item disabled={detail === null || printing} onSelect={() => void print()}>
      <Printer class="size-16 shrink-0" aria-hidden="true" />
      {printLabel}
    </DropdownMenu.Item>
  {/if}
  <DropdownMenu.Item disabled={detail === null} onSelect={() => (historyOpen = true)}>
    <History class="size-16 shrink-0" aria-hidden="true" />
    History
  </DropdownMenu.Item>
{/snippet}

<div class="flex flex-col gap-16">
  <ScreenHeader title={period === "" ? "Reconciliation" : period} {back} {pageMenu}>
    {#snippet meta()}
      {#if accountName !== null}<span>{accountName}</span>{/if}
      {#if detail !== null && header !== null && status !== null}
        <Badge variant={statusTone(status)}>{statusLabel(status)}</Badge>
        <span>Started by {header.startedByName ?? "someone"}, {formatInstantDate(header.startedAt)}</span>
        {#if finished && header.finishedAt !== null}
          <span>Finished by {header.finishedByName ?? "someone"}, {formatInstantDate(header.finishedAt)}</span>
        {:else}
          <span class={saveState === "failed" ? "text-status-danger" : undefined} aria-live="polite">{savedText}</span>
          <span class="inline-flex gap-4">
            <Button
              variant="ghost"
              size="sm"
              disabled={editRefusal !== undefined || detail.undoChangeId === null || writing > 0}
              title={detail.undoChangeId === null ? "Nothing of yours to undo." : editRefusal}
              onclick={() => revert("undo")}
            >
              <Undo2 class="size-16" aria-hidden="true" />
              Undo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={editRefusal !== undefined || detail.redoChangeId === null || writing > 0}
              title={detail.redoChangeId === null ? "Nothing of yours to redo." : editRefusal}
              onclick={() => revert("redo")}
            >
              <Redo2 class="size-16" aria-hidden="true" />
              Redo
            </Button>
          </span>
        {/if}
      {/if}
    {/snippet}
    {#snippet actions()}
      {#if !narrow.current}
        {#if !finished}
          <Button
            variant="secondary"
            disabled={editRefusal !== undefined}
            title={editRefusal}
            onclick={() => (saveOpen = true)}
          >
            <Save class="size-16" aria-hidden="true" />
            Save
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class={buttonClasses({ variant: "secondary", size: "default" })} disabled={detail === null}>
              <RotateCcw class="size-16" aria-hidden="true" />
              Restore Points
              <ChevronDown class="size-16" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>{@render restoreItems()}</DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
        <Button variant="secondary" disabled={detail === null || printing} onclick={() => void print()}>
          <Printer class="size-16" aria-hidden="true" />
          {printing ? "Making the PDF" : printLabel}
        </Button>
      {/if}
      {#if !finished}
        <Button
          variant="primary"
          disabled={finishRefusal !== undefined}
          title={finishRefusal}
          onclick={() => (finishOpen = true)}
        >
          <SquarePen class="size-16" aria-hidden="true" />
          Finish Reconciliation
        </Button>
      {/if}
    {/snippet}
  </ScreenHeader>

  {#if failure !== null}
    <FailureNotice
      {failure}
      title="This Reconciliation Could Not Be Read"
      fallback="Nothing was changed."
      onRetry={() => void load()}
    />
  {:else if detail !== null && header !== null}
    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure}
        title="The Last Change Was Not Saved"
        fallback="The screen shows the reconciliation as it is saved."
      />
    {/if}
    {#if printFailure !== null}
      <p class="text-sm text-status-danger" role="alert">{printFailure}</p>
    {/if}

    <!-- The four numbers that bound the period: the start carried over or typed, the end editable. -->
    <div class="grid gap-16 sm:grid-cols-2 lg:grid-cols-4">
      <div class="flex flex-col gap-4">
        <span class="text-sm text-text-muted">Start Date</span>
        <span class="inline-flex items-center gap-8 font-medium">
          {formatDate(header.startDate)}
          {#if header.startCarriedOver}
            <span class="inline-flex items-center gap-4 text-xs font-normal text-text-muted">
              <Lock class="size-12" aria-hidden="true" />carried over
            </span>
          {/if}
        </span>
      </div>
      <div class="flex flex-col gap-4">
        {#if finished}
          <span class="text-sm text-text-muted">End Date</span>
          <span class="font-medium">{formatDate(detail.endDate)}</span>
        {:else}
          <DatePicker
            label="End Date"
            value={civilDateValue(detail.endDate)}
            onValueChange={(next) => commitEndDate(civilDateTextOrEmpty(next))}
            disabled={editRefusal !== undefined}
          />
        {/if}
      </div>
      <div class="flex flex-col gap-4">
        <span class="text-sm text-text-muted">Start Balance</span>
        <span class="inline-flex items-center gap-8 font-medium tabular-nums">
          {money(header.startBalanceMinor)}
          {#if header.startCarriedOver}
            <span class="inline-flex items-center gap-4 text-xs font-normal text-text-muted">
              <Lock class="size-12" aria-hidden="true" />carried over
            </span>
          {/if}
        </span>
      </div>
      <div class="flex flex-col gap-4">
        <label for="reconciliation-end-balance" class="text-sm text-text-muted">End Balance</label>
        {#if finished}
          <span class="font-medium tabular-nums">
            {detail.endBalanceMinor === null ? "" : money(detail.endBalanceMinor)}
          </span>
        {:else}
          <Input
            id="reconciliation-end-balance"
            inputmode="decimal"
            placeholder="From the statement"
            aria-invalid={endBalanceInvalid ? "true" : undefined}
            disabled={editRefusal !== undefined}
            bind:value={endBalanceText}
            onfocus={() => {
              endBalanceFocused = true;
              endBalanceText = balanceFieldText(detail?.endBalanceMinor ?? null);
            }}
            onblur={commitEndBalance}
            onkeydown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-8">
      <span class="text-sm text-text-muted">Files</span>
      {#each detail.files as file (file.fileId)}
        <span class="inline-flex items-center">
          <Button variant="secondary" size="sm" onclick={() => void openFile(file.fileId)}>
            <FileText class="size-16" aria-hidden="true" />
            {file.name}
          </Button>
          {#if !finished}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${file.name}`}
              disabled={editRefusal !== undefined}
              title={editRefusal}
              onclick={() => removeFile(file.fileId)}
            >
              <X class="size-16" aria-hidden="true" />
            </Button>
          {/if}
        </span>
      {/each}
      {#if detail.files.length === 0}
        <span class="text-sm text-text-muted">None attached</span>
      {/if}
      <FileInput
        bind:ref={fileInput}
        class="hidden"
        tabindex={-1}
        aria-hidden="true"
        accept="application/pdf,image/png,image/jpeg"
        multiple
        onchange={(event) => void attach(event.currentTarget.files)}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={manageRefusal !== undefined}
        title={manageRefusal}
        onclick={() => fileInput?.click()}
      >
        <Paperclip class="size-16" aria-hidden="true" />
        Attach Files
      </Button>
    </div>

    <!-- The figures, as the sum reads: start + deposited - withdrawn = cleared, against the end. -->
    <section
      aria-label="Figures"
      class="grid grid-cols-2 gap-x-24 gap-y-16 rounded-lg border border-border-default bg-surface-raised p-16 md:grid-cols-3 xl:flex xl:flex-wrap xl:items-end"
    >
      <div class="flex flex-col gap-2">
        <FieldLabel>Start Balance</FieldLabel>
        <span class="text-xl tabular-nums">{money(detail.figures.startBalanceMinor)}</span>
      </div>
      <span class="hidden pb-4 text-xl text-text-muted xl:inline" aria-hidden="true">+</span>
      <div class="flex flex-col gap-2">
        <FieldLabel>Deposited</FieldLabel>
        <span class="text-xl tabular-nums">{money(detail.figures.depositedMinor)}</span>
        <span class="text-xs text-text-muted">
          {detail.figures.depositClearedCount} of {detail.figures.depositCount} cleared
        </span>
      </div>
      <span class="hidden pb-4 text-xl text-text-muted xl:inline" aria-hidden="true">-</span>
      <div class="flex flex-col gap-2">
        <FieldLabel>Withdrawn</FieldLabel>
        <span class="text-xl tabular-nums">{money(detail.figures.withdrawnMinor)}</span>
        <span class="text-xs text-text-muted">
          {detail.figures.withdrawalClearedCount} of {detail.figures.withdrawalCount} cleared
        </span>
      </div>
      <span class="hidden pb-4 text-xl text-text-muted xl:inline" aria-hidden="true">=</span>
      <div class="flex flex-col gap-2">
        <FieldLabel>Cleared Balance</FieldLabel>
        <span class="text-xl tabular-nums">{money(detail.figures.clearedBalanceMinor)}</span>
      </div>
      <div class="flex flex-col gap-2">
        <FieldLabel>End Balance</FieldLabel>
        <span class="text-xl tabular-nums">
          {detail.figures.endBalanceMinor === null ? "Not entered" : money(detail.figures.endBalanceMinor)}
        </span>
        <span class="text-xs text-text-muted">From the statement</span>
      </div>
      <div
        class={[
          "col-span-2 flex flex-col gap-2 rounded-md border p-12 md:col-span-1 xl:ms-auto",
          detail.figures.differenceMinor === 0
            ? "border-border-default"
            : "border-status-warning bg-status-warning-subtle",
        ]}
      >
        <FieldLabel>Difference</FieldLabel>
        <span class="text-2xl tabular-nums">
          {detail.figures.differenceMinor === null ? "Not known" : money(detail.figures.differenceMinor)}
        </span>
      </div>
    </section>

    <div class="flex flex-wrap items-center gap-8">
      <Select.Root
        type="single"
        items={typeItems}
        allowDeselect={false}
        value={typeFilter}
        onValueChange={(next) => (typeFilter = (next || "all") as TypeFilter)}
      >
        <Select.Trigger aria-label="Type" class="w-auto min-w-40">
          <Select.Value placeholder="All Types" />
        </Select.Trigger>
        <Select.Content>
          {#each typeItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
      <span id="reconciliation-state-label" class="sr-only">Which items</span>
      <SegmentedControl.Root
        aria-labelledby="reconciliation-state-label"
        class="w-full sm:w-xl"
        value={stateFilter}
        onValueChange={(next) => (stateFilter = next as StateFilter)}
      >
        <SegmentedControl.Item value="all">All</SegmentedControl.Item>
        <SegmentedControl.Item value="uncleared">Uncleared ({stateCounts.uncleared})</SegmentedControl.Item>
        <SegmentedControl.Item value="review">Needs Review ({stateCounts.review})</SegmentedControl.Item>
        <SegmentedControl.Item value="new">New ({stateCounts.isNew})</SegmentedControl.Item>
      </SegmentedControl.Root>
      {#if !finished}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
            aria-label="More for these items"
          >
            <EllipsisVertical class="size-16" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item disabled={editRefusal !== undefined} onSelect={() => tickShown(true)}>
              Tick All Shown
            </DropdownMenu.Item>
            <DropdownMenu.Item disabled={editRefusal !== undefined} onSelect={() => tickShown(false)}>
              Untick All Shown
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>

    <div class="flex flex-col gap-8">
      <DataTable.Grid
        grid={itemGrid}
        cell={itemCell}
        caption="Items to tick against the statement"
      />
      <DataTable.GridFooter grid={itemGrid} />
    </div>

    <section aria-labelledby="iolta-interest-heading" class="flex flex-col gap-12">
      <div class="flex flex-wrap items-center justify-between gap-8">
        <div class="flex flex-wrap items-baseline gap-x-12 gap-y-2">
          <h2 id="iolta-interest-heading" class="text-lg font-medium">IOLTA Interest</h2>
          <span class="text-sm text-text-muted">Belongs to no matter and never touches a client ledger</span>
        </div>
        {#if !finished}
          <Button
            variant="secondary"
            disabled={editRefusal !== undefined}
            title={editRefusal}
            onclick={() => (interestOpen = true)}
          >
            <Plus class="size-16" aria-hidden="true" />
            Add Interest
          </Button>
        {/if}
      </div>
      <DataTable.Grid grid={interestGrid} cell={interestCell} caption="IOLTA interest on this statement" />
      {#if detail.interest.length > 0}
        <p class="flex flex-wrap gap-x-24 gap-y-4 text-sm tabular-nums">
          <span>Credited <strong>{money(interestTotals.credited)}</strong></span>
          <span>Swept out <strong>{money(interestTotals.swept)}</strong></span>
          <span>Left in the account <strong>{money(interestTotals.left)}</strong></span>
          <span class="text-text-muted">Included in deposited and withdrawn above</span>
        </p>
      {/if}
    </section>
  {/if}
</div>

<ReconciliationTransactionDialog
  bind:open={transactionOpen}
  item={opened}
  {money}
  {checksHref}
/>

<ReconciliationNotesSheet
  bind:open={notesOpen}
  line={notesLine}
  heading={notesHeading}
  detail={notesDetail}
  notes={detail?.notes ?? []}
  needsReview={notesLine !== null && review.has(lineKey(notesLine))}
  refusal={manageRefusal}
  onWrite={writeNote}
/>

<ReconciliationHistoryDialog
  bind:open={historyOpen}
  {detail}
  {money}
  refusal={editRefusal}
  onUndo={undoFromHistory}
/>

<ReconciliationSaveDialog
  bind:open={saveOpen}
  suggestedName={`Saved ${formatInstant(now())}`}
  onSave={save}
/>

<ReconciliationInterestDialog bind:open={interestOpen} endDate={detail?.endDate ?? ""} onAdd={addInterest} />

<ReconciliationFinishDialog
  bind:open={finishOpen}
  {period}
  differenceText={detail?.figures.differenceMinor == null || detail.figures.differenceMinor === 0
    ? null
    : money(detail.figures.differenceMinor)}
  uncleared={items.filter((item) => !item.cleared).length}
  needsReview={review.size}
  refusal={finishRefusal}
  onFinish={finish}
/>
