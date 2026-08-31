<script lang="ts">
  /*
   * THE TIME SHEET — rapid time entry, over whatever the person was doing.
   *
   * This is the capture surface, and it is deliberately not the ledger. The ledger is where a
   * matter's time record is READ: every entry, every status, the panel, the record window. The
   * sheet is where time gets WRITTEN DOWN, fast, in a grid a person types straight into. It opens
   * over the screen rather than navigating to one, because capture must never cost a person the
   * place they were working.
   *
   * A ROW IS EDITED IN PLACE. There is no form, no submit, and no standing blank row waiting at the
   * bottom: a row is created deliberately, from the button that ends the sheet or from the one that
   * opens the full record, and from that instant it holds what is typed into it. Each cell commits
   * when it is left and the row's own mark says whether the change has landed.
   *
   * THE DESCRIPTION WRAPS AND GROWS. It is the line the client reads on the bill, so the surface
   * whose job is to capture it never clips it, never scrolls it sideways, and never hides it behind
   * an ellipsis. The internal memo behaves the same way, on demand: most rows never carry one, so
   * it is a line the row reveals rather than a column every row pays width for.
   *
   * ONE TABLE. Sorting, the in-header filters, show and hide, drag-reorder, pinning, resize with
   * double-click fit, the totals row and the filtered-empty state are the product's one grid. This
   * file declares the columns and renders the cells; it decides none of that behaviour, because a
   * behaviour gap between this table and any other table in the product would be a defect.
   *
   * WHAT IS DESIGNED AND NOT YET SERVED STAYS ON SCREEN. The time code, the entered date and who
   * entered it, the rate, the attachments and the internal memo are all part of a row; the listing
   * and the write routes carry none of them. Each is rendered where it belongs, refused, saying
   * what it waits on, so a reader can see the row's real shape and can never mistake an unserved
   * field for an empty one.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatMoney } from "@magna-carta/design-system/data-table";
  import { formatDuration } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import CircleCheckBig from "@lucide/svelte/icons/circle-check-big";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import NotebookPen from "@lucide/svelte/icons/notebook-pen";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import Search from "@lucide/svelte/icons/search";
  import Square from "@lucide/svelte/icons/square";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import X from "@lucide/svelte/icons/x";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import { autoSizeTextarea } from "./auto-size-textarea.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { personInitials } from "./time-columns.ts";
  import { gapCellTitle, gapReason } from "./time-gaps.ts";
  import TimeRecordWindow from "./time-record-window.svelte";
  import {
    TIME_SHEET_COLUMN_IDENTIFIERS,
    isUnservedSheetColumn,
    sheetColumnGap,
    timeSheetColumns,
  } from "./time-sheet-columns.ts";
  import { historyAnnouncement } from "./time-sheet-history.svelte.ts";
  import {
    clockText,
    isIncomplete,
    isWorkable,
    minutesFromSeconds,
    parseDurationSeconds,
    saveStateTitle,
    searchMatches,
    sheetHonesty,
    type SheetRow,
  } from "./time-sheet-model.ts";
  import {
    SCOPE_PRESET_IDENTIFIERS,
    customRangeOutcome,
    isScopeShowing,
    scopeHolds,
    scopePreset,
    widenedScope,
    type SheetScope,
  } from "./time-sheet-scope.ts";
  import { TimeSheetStore } from "./time-sheet-store.svelte.ts";

  let {
    open = $bindable(false),
    entries,
    matterId,
    matterTitle,
    members,
    sessionUserId,
    onChanged,
  }: {
    open?: boolean;
    /** The matter's entries as the listing answered them. The sheet seeds its rows from these. */
    entries: readonly TimeEntrySummary[];
    matterId: string;
    matterTitle: string;
    members: readonly FirmMemberSummary[];
    sessionUserId: string | null;
    /** Something was written; the matter's time wants re-reading. */
    onChanged: () => void;
  } = $props();

  /*
   * The firm's first weekday is a firm setting the settings registry will serve. Until it does, the
   * week preset spans a Monday-to-Sunday week and the label says which days it actually covered, so
   * the caption can never disagree with the span.
   */
  const FIRST_WEEKDAY_OF_THE_FIRMS_WEEK = 1;

  const today = new Date().toISOString().slice(0, 10);

  let announcement = $state<string | null>(null);

  const store = new TimeSheetStore({
    matterId,
    matterTitle,
    entries: () => entries,
    members: () => members,
    sessionUserId: () => sessionUserId,
    today: () => today,
    onChanged,
    announce: (message) => (announcement = message),
  });

  let scope = $state<SheetScope>(scopePreset("today", today, FIRST_WEEKDAY_OF_THE_FIRMS_WEEK));
  let searchOpen = $state(false);
  let searchText = $state("");
  let expanded = $state(false);
  /** Rows whose empty memo line has been opened but not written in, by row key. */
  let memoOpened = $state<ReadonlySet<string>>(new Set());
  let recordWindowOpen = $state(false);
  let recordWindowEditing = $state(false);
  let recordWindowEntry = $state<TimeEntrySummary | null>(null);
  let customRangeFrom = $state("");
  let customRangeTo = $state("");
  let customRangeNote = $state<string | null>(null);
  /** The row whose description is waiting for the cursor, by row key, or null when none is. */
  let focusDescriptionOf = $state<string | null>(null);

  /* The sheet re-seeds whenever the listing answers again, and never while it is closed. */
  $effect(() => {
    const answered = entries;
    if (!open) return;
    store.adoptEntries(answered);
  });

  /* A clock that ticks only while something is running, so a still sheet re-renders for nothing. */
  $effect(() => {
    if (!open || !store.timerRunning) return;
    const handle = setInterval(() => (store.tick += 1), 1000);
    return () => clearInterval(handle);
  });

  $effect(() => {
    if (!open) return;
    void store.readTimerState();
  });

  /*
   * EVERY COLUMN CARRIES A WIDTH FROM THE START, and the table lays out fixed from there. That is
   * what makes a cell's width a real, resizable quantity rather than a consequence of its content,
   * so the field inside a cell simply fills the column and a long value is never clipped by an
   * input narrower than the space it sits in. The description gets by far the most, because it is
   * the one field that is prose.
   */
  const STARTING_COLUMN_WIDTHS: Readonly<Record<string, number>> = {
    [TIME_SHEET_COLUMN_IDENTIFIERS.saveState]: 56,
    [TIME_SHEET_COLUMN_IDENTIFIERS.workDate]: 148,
    [TIME_SHEET_COLUMN_IDENTIFIERS.timeCode]: 130,
    [TIME_SHEET_COLUMN_IDENTIFIERS.dateEntered]: 134,
    [TIME_SHEET_COLUMN_IDENTIFIERS.description]: 300,
    [TIME_SHEET_COLUMN_IDENTIFIERS.worked]: 104,
    [TIME_SHEET_COLUMN_IDENTIFIERS.hours]: 132,
    [TIME_SHEET_COLUMN_IDENTIFIERS.rate]: 96,
    [TIME_SHEET_COLUMN_IDENTIFIERS.total]: 108,
    [TIME_SHEET_COLUMN_IDENTIFIERS.files]: 140,
    [TIME_SHEET_COLUMN_IDENTIFIERS.timekeeper]: 156,
    [TIME_SHEET_COLUMN_IDENTIFIERS.enteredBy]: 152,
    [TIME_SHEET_COLUMN_IDENTIFIERS.status]: 100,
    [TIME_SHEET_COLUMN_IDENTIFIERS.actions]: 124,
  };
  let widthsSet = false;
  $effect(() => {
    if (!open || widthsSet) return;
    widthsSet = true;
    grid.snapshotColumnWidths(STARTING_COLUMN_WIDTHS);
  });

  $effect(() => () => store.dispose());

  const currency = $derived(store.rows[0]?.currency ?? "USD");
  const money = (amountMinor: number): string =>
    formatMoney(amountMinor / 100, { currency });

  const liveSeconds = (row: SheetRow): number => store.liveSeconds(row);

  /*
   * WHICH ROWS THE SHEET SHOWS. The scope decides, plus every incomplete row from an earlier day:
   * those surface until they are completed, because they are the exact rows the save-with-anything
   * rule exists for and a row nobody can see is a row nobody will finish.
   */
  const rowsInScope = $derived(
    store.rows.filter(
      (row) => scopeHolds(scope, row.workDate) || (isIncomplete(row) && row.workDate < scope.from),
    ),
  );
  const rowsSearched = $derived(rowsInScope.filter((row) => searchMatches(row, searchText)));

  const grid = DataTable.createDataTableGrid<SheetRow>({
    columns: () => timeSheetColumns(currency, liveSeconds),
    rows: () => rowsSearched,
    rowKey: (row) => row.key,
    initialSort: { columnId: TIME_SHEET_COLUMN_IDENTIFIERS.workDate, direction: "descending" },
    itemNoun: { singular: "row", plural: "rows" },
    totalIncludes: (row) => row.status !== "void",
    onActivate: (row) => openRecord(row),
  });

  /*
   * The strip reads the same quantity the Worked column reads, run included. A footer summing the
   * banked seconds while the column above it shows the ticking ones is a footer disagreeing with
   * its own table, and the disagreement grows for as long as the timer is left going.
   */
  const honesty = $derived(sheetHonesty(rowsInScope, liveSeconds));

  /** The day a new row is written for: today when today is in view, the end of the range otherwise. */
  const defaultWorkDate = $derived(scopeHolds(scope, today) ? today : scope.to);

  function applyScope(next: SheetScope): void {
    scope = next;
    customRangeNote = null;
  }

  /** Keep a row in view that the scope would otherwise drop, and say why the range moved. */
  function keepInView(isoDate: string, becauseOf: string): void {
    const widened = widenedScope(scope, isoDate, becauseOf);
    if (widened === null) return;
    scope = widened;
    announcement = `The range widened to ${widened.label} so the ${becauseOf} stays in view.`;
  }

  function addRow(): void {
    const row = store.addRow(defaultWorkDate);
    keepInView(row.workDate, "row you just added");
    announcement = null;
    // One press creates the row and puts the cursor in it: the first thing a person does with a new
    // row is type the description, and making them find the cell first is the whole cost of the row.
    focusDescriptionOf = row.key;
  }

  function openRecord(row: SheetRow): void {
    recordWindowEntry = entries.find((entry) => entry.id === row.entryIdentifier) ?? null;
    recordWindowEditing = recordWindowEntry === null;
    recordWindowOpen = true;
  }

  /**
   * New entry: the full record rather than the grid.
   *
   * It adds NO row to the sheet. The window writes its own entry, and a row added here alongside it
   * would be a second, permanently unwritten row for one act — surviving every re-seed, because an
   * unwritten row is deliberately kept across them, and counting itself as incomplete for the rest
   * of the session. The sheet picks the new entry up from the re-read that follows the save.
   */
  function newEntry(): void {
    recordWindowEntry = null;
    recordWindowEditing = true;
    recordWindowOpen = true;
  }

  /**
   * Put the cursor in this field when the sheet has just asked for it, and then stop asking.
   *
   * The request is cleared here rather than by whoever made it, because "the field now has the
   * cursor" is a fact only the field knows: the row it belongs to may not have been rendered yet
   * when the row was created, and a request left standing would take focus back on every later
   * render of the cell.
   */
  function focusWhenAsked(wanted: boolean): (field: HTMLElement) => void {
    return (field) => {
      if (!wanted) return;
      focusDescriptionOf = null;
      field.focus();
    };
  }

  /**
   * Typing into a running duration.
   *
   * The cell is an input in both states rather than a label that becomes one, so a person who wants
   * to correct the figure just types into it. Arriving in the field holds the timer where it is:
   * the alternative is a value that changes underneath the cursor, and whatever is typed then races
   * the next tick. Nothing is lost by the pause; the run resumes from its own control.
   */
  function pauseForTyping(): void {
    if (store.timerRunning) void store.pauseTimerOnRow();
  }

  function commitWorkDate(row: SheetRow, value: string): void {
    store.setWorkDate(row.key, value);
    keepInView(value, "row you just re-dated");
  }

  function commitDuration(row: SheetRow, text: string): void {
    const seconds = parseDurationSeconds(text);
    if (seconds === null) return;
    store.setWorkedSeconds(row.key, seconds);
  }

  function toggleMemo(row: SheetRow): void {
    const next = new Set(memoOpened);
    if (next.has(row.key)) next.delete(row.key);
    else next.add(row.key);
    memoOpened = next;
  }

  function runUndo(steps: number): void {
    const outcome = store.history.undo(steps);
    announcement = outcome === null ? null : historyAnnouncement("Undid", outcome);
  }

  function runRedo(steps: number): void {
    const outcome = store.history.redo(steps);
    announcement = outcome === null ? null : historyAnnouncement("Redid", outcome);
  }

  function applyCustomRange(): void {
    const outcome = customRangeOutcome(customRangeFrom, customRangeTo);
    if (outcome.kind === "refused") {
      customRangeNote = outcome.reason;
      return;
    }
    customRangeNote = "Applied. A preset above returns to a named scope.";
    scope = outcome.scope;
  }

  function keyPressed(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    const pressed = event.key.toLowerCase();
    if (pressed === "z" && !event.shiftKey) {
      event.preventDefault();
      runUndo(1);
      return;
    }
    if (pressed === "y" || (pressed === "z" && event.shiftKey)) {
      event.preventDefault();
      runRedo(1);
    }
  }

  /** Whether this row may be typed into at all, and why not when it may not. */
  function editRefusal(row: SheetRow): string | undefined {
    if (isWorkable(row)) return undefined;
    return statusEntry(row.status).meaning;
  }
</script>

<svelte:window onkeydown={open ? keyPressed : undefined} />

{#snippet unservedCell(columnIdentifier: string)}
  {@const gap = sheetColumnGap(columnIdentifier)}
  <span class="text-text-subtle" title={gap === undefined ? "" : gapCellTitle(gap)}>&mdash;</span>
{/snippet}

{#snippet saveMark(row: SheetRow)}
  <span class="inline-flex items-center" title={saveStateTitle(row)}>
    {#if row.saveState === "saving"}
      <LoaderCircle class="size-16 text-text-muted" aria-hidden="true" />
    {:else if row.saveState === "failed"}
      <TriangleAlert class="size-16 text-status-danger" aria-hidden="true" />
    {:else if row.saveState === "unsaved"}
      <CircleDashed class="size-16 text-text-subtle" aria-hidden="true" />
    {:else if isIncomplete(row)}
      <TriangleAlert class="size-16 text-status-warning" aria-hidden="true" />
    {:else}
      <CircleCheckBig class="size-16 text-status-success" aria-hidden="true" />
    {/if}
    <span class="sr-only">{saveStateTitle(row)}</span>
  </span>
{/snippet}

{#snippet descriptionCell(row: SheetRow)}
  {@const refusal = editRefusal(row)}
  <div class="flex w-full flex-col gap-4">
    <div class="flex w-full items-start gap-4">
      <!-- It grows to what is written in it: the description is the line the client reads on the
           bill, so this surface never clips it and never scrolls it. -->
      <Textarea
        class="min-w-0 flex-1"
        rows={1}
        value={row.description}
        placeholder="Description"
        title={refusal ?? "The description. It is the line the client reads on the bill."}
        disabled={refusal !== undefined}
        spellcheck={true}
        onchange={(event) => store.setDescription(row.key, event.currentTarget.value)}
        {@attach autoSizeTextarea(row.description)}
        {@attach focusWhenAsked(focusDescriptionOf === row.key)}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-pressed={memoOpened.has(row.key)}
        title="Add an internal memo: the firm's own note on this entry, never on a bill or a printed sheet"
        aria-label="Internal memo"
        onclick={() => toggleMemo(row)}
      >
        <NotebookPen class="size-16" aria-hidden="true" />
      </Button>
    </div>
    {#if memoOpened.has(row.key)}
      <!-- Internal by construction: it is never reachable from a bill, an export or a print sheet. -->
      <div class="flex w-full items-center gap-8" data-internal-only="true">
        <Badge variant="neutral">Internal</Badge>
        <SoonAffordance class="min-w-0 flex-1" reason={gapReason("memo")}>
          {#snippet control(soon)}
            <Textarea class="w-full" rows={1} placeholder="Internal Memo" {...soon} />
          {/snippet}
        </SoonAffordance>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet durationCell(row: SheetRow)}
  {@const refusal = editRefusal(row)}
  {@const running = store.timerRowKey === row.key && store.timerRunning}
  <!--
    One field, both states. A running duration used to render as a label, which meant the one cell a
    person is most likely to want to correct was the one cell they could not type into. It ticks to
    the second while the run is going, and arriving in it holds the run so what is typed is not
    racing the next tick.
  -->
  <Input
    class="text-end"
    value={running
      ? clockText(liveSeconds(row), true)
      : liveSeconds(row) > 0
        ? clockText(liveSeconds(row), false)
        : ""}
    placeholder="Worked"
    title={refusal ??
      (running
        ? "Ticking. Typing in here holds the timer; its own control starts it again."
        : "Time worked, typed either way: 1:30 or 1.5, and minutes as 45m")}
    disabled={refusal !== undefined}
    onfocus={running ? pauseForTyping : undefined}
    onchange={(event) => commitDuration(row, event.currentTarget.value)}
  />
{/snippet}

{#snippet rowActions(row: SheetRow)}
  {@const running = store.timerRowKey === row.key && store.timerRunning}
  {@const holding = store.timerRowKey === row.key && !store.timerRunning}
  <span class="inline-flex items-center justify-end gap-4">
    {#if running}
      <Button
        variant="ghost"
        size="icon"
        title="Hold the timer here. Nothing is lost."
        aria-label="Pause the timer"
        onclick={() => void store.pauseTimerOnRow()}
      >
        <Pause class="size-16" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Stop the timer and put its time on this entry"
        aria-label="Stop the timer"
        onclick={() => void store.stopTimerOnRow()}
      >
        <Square class="size-16" aria-hidden="true" />
      </Button>
    {:else}
      <Button
        variant="ghost"
        size="icon"
        disabled={editRefusal(row) !== undefined}
        title={editRefusal(row) ??
          (holding
            ? "Resume the timer on this row"
            : store.timerRowKey === null
              ? "Start the timer on this row"
              : "Start the timer on this row. The row it is on now stops and keeps its time.")}
        aria-label={holding ? "Resume the timer" : "Start the timer"}
        onclick={() =>
          void (holding ? store.resumeTimerOnRow() : store.startTimerOnRow(row.key))}
      >
        <Play class="size-16" aria-hidden="true" />
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      title="Open the full entry. Double-clicking the row does the same."
      aria-label="Open the full entry"
      onclick={() => openRecord(row)}
    >
      <SquareArrowOutUpRight class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      disabled={row.status === "void"}
      title={row.status === "void"
        ? "Already struck. It stays on the record."
        : row.entryIdentifier === null
          ? "Remove this row. It has not been written to the record."
          : "Strike this entry. It stays on the record, numbered, and counts toward nothing."}
      aria-label="Strike this entry"
      onclick={() => void store.voidRow(row.key)}
    >
      <Trash2 class="size-16" aria-hidden="true" />
    </Button>
  </span>
{/snippet}

{#snippet cell({ row, column, text }: DataTable.GridCellContext<SheetRow>)}
  {#if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.saveState}
    {@render saveMark(row)}
  {:else if isUnservedSheetColumn(column.id)}
    {@render unservedCell(column.id)}
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.workDate}
    <Input
      type="date"
      value={row.workDate}
      title={editRefusal(row) ?? "The day the work is for"}
      disabled={editRefusal(row) !== undefined}
      onchange={(event) => commitWorkDate(row, event.currentTarget.value)}
    />
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.description}
    {@render descriptionCell(row)}
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.worked}
    {@render durationCell(row)}
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.hours}
    <!-- Billed hours are the worked time under the firm's rounding increment, which is a firm
         setting nothing serves yet. The field is real and refused rather than quietly absent. -->
    <SoonAffordance reason={gapReason("rounding")}>
      {#snippet control(soon)}
        <Input
          class="text-end"
          value={row.billedMinutes === null ? "" : formatDuration(row.billedMinutes).decimal}
          placeholder="Hours"
          {...soon}
        />
      {/snippet}
    </SoonAffordance>
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.total}
    <span class="whitespace-nowrap tabular-nums">
      {row.amountMinor === null ? "—" : money(row.amountMinor)}
    </span>
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.timekeeper}
    <span
      class="inline-flex items-center gap-8 whitespace-nowrap"
      title="Whose work this is. Recording one member's work under another member's hand waits on {gapReason(
        'timekeeperChange',
      )}."
    >
      <span
        class="inline-flex size-20 items-center justify-center rounded-full bg-surface-raised text-xs text-text-muted"
        aria-hidden="true">{personInitials(row.timekeeperName)}</span
      >
      {row.timekeeperName}
    </span>
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.status}
    <Badge {...statusBadgeAttributes(row.status)}>{statusEntry(row.status).label}</Badge>
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.actions}
    {@render rowActions(row)}
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet emptySheet()}
  <EmptyState title="Nothing Recorded in This Range">
    The sheet shows the days you pick. Add a row and start typing, or widen the range.
    {#snippet actions()}
      <Button onclick={addRow}>
        <Plus class="size-16" aria-hidden="true" />
        Add a Row
      </Button>
    {/snippet}
  </EmptyState>
{/snippet}

{#snippet honestyStrip()}
  <span class="inline-flex items-baseline gap-4" title="Time worked in this range, as worked.">
    <span class="text-text-subtle">worked</span>
    <span class="font-semibold tabular-nums">
      {formatDuration(minutesFromSeconds(honesty.workedSeconds)).text}
    </span>
  </span>
  <span aria-hidden="true">·</span>
  <span
    class="inline-flex items-baseline gap-4"
    title="Time in this range as the firm's rounding increment billed it."
  >
    <span class="text-text-subtle">billed</span>
    <span class="font-semibold tabular-nums">{formatDuration(honesty.billedMinutes).text}</span>
  </span>
  <span aria-hidden="true">·</span>
  <span class="inline-flex items-baseline gap-4" title="What this range is worth, before tax.">
    <span class="text-text-subtle">value</span>
    <span class="font-semibold tabular-nums">{money(honesty.amountMinor)}</span>
  </span>
  <span aria-hidden="true">·</span>
  <span class="text-text-muted">{scope.label}{scope.note === undefined ? "" : `, ${scope.note}`}</span
  >
  {#if honesty.incompleteRows > 0}
    <span aria-hidden="true">·</span>
    <span
      class="text-status-warning-subtle-foreground"
      title="These rows are saved and still short of a description or a duration. They stay on the sheet until they are completed."
    >
      {honesty.incompleteRows}
      {honesty.incompleteRows === 1 ? "row" : "rows"} incomplete
    </span>
  {/if}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content
    showClose={false}
    class={expanded
      ? "flex h-screen w-screen max-w-none flex-col gap-0 p-0"
      : "flex max-h-screen w-full max-w-record-window flex-col gap-0 p-0"}
  >
    <div class="flex flex-wrap items-center gap-8 border-b border-border-default px-24 py-16">
      <div class="flex min-w-0 flex-col gap-4">
        <Dialog.Title>Time Sheet</Dialog.Title>
        <Dialog.Description>{matterTitle}</Dialog.Description>
      </div>

      <Popover.Root>
        <Popover.Trigger
          class={buttonClasses({ variant: "secondary", size: "sm" })}
          title="Choose the day or the range this sheet shows"
        >
          <Calendar class="size-16" aria-hidden="true" />
          {scope.label}
          <ChevronDown class="size-16" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Content align="start">
          <div class="flex flex-col gap-12">
            <p class="text-xs text-text-subtle">Show entries for</p>
            <div class="flex flex-col items-start gap-4">
              {#each SCOPE_PRESET_IDENTIFIERS as identifier (identifier)}
                {@const preset = scopePreset(identifier, today, FIRST_WEEKDAY_OF_THE_FIRMS_WEEK)}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={isScopeShowing(scope, preset)}
                  onclick={() => applyScope(preset)}
                >
                  {preset.label}
                </Button>
              {/each}
            </div>
            <p class="text-xs text-text-subtle">Custom range</p>
            <div class="flex items-end gap-8">
              <div class="flex flex-col gap-4">
                <Label for="time-sheet-range-from">From</Label>
                <Input
                  id="time-sheet-range-from"
                  type="date"
                  bind:value={customRangeFrom}
                  onchange={applyCustomRange}
                />
              </div>
              <div class="flex flex-col gap-4">
                <Label for="time-sheet-range-to">To</Label>
                <Input
                  id="time-sheet-range-to"
                  type="date"
                  bind:value={customRangeTo}
                  onchange={applyCustomRange}
                />
              </div>
            </div>
            <p class="text-xs text-text-muted">
              {customRangeNote ??
                "The range applies as you pick it. A preset above returns to a named scope."}
            </p>
            <p class="text-xs text-text-subtle">
              Incomplete rows from earlier days always show. They stay until they are completed.
            </p>
          </div>
        </Popover.Content>
      </Popover.Root>

      <div class="ms-auto flex flex-wrap items-center gap-8">
        <Button
          size="sm"
          title="Create an entry on the full record rather than in the grid"
          onclick={newEntry}
        >
          <Plus class="size-16" aria-hidden="true" />
          New Entry
        </Button>

        {#if searchOpen}
          <Input
            class="w-full"
            value={searchText}
            placeholder="Search"
            aria-label="Search rows by description or person"
            oninput={(event) => (searchText = event.currentTarget.value)}
            onblur={() => {
              if (searchText === "") searchOpen = false;
            }}
          />
        {:else}
          <Button
            variant="secondary"
            size="icon"
            title="Search the rows in view"
            aria-label="Search"
            onclick={() => (searchOpen = true)}
          >
            <Search class="size-16" aria-hidden="true" />
          </Button>
        {/if}

        <!-- The button does the step; its list says what each step WAS, so several can be walked
             back at once. What a step was is never printed on the toolbar. -->
        <Button
          variant="secondary"
          size="icon"
          disabled={!store.history.canUndo}
          title={store.history.undoTitle}
          aria-label="Undo"
          onclick={() => runUndo(1)}
        >
          <Undo2 class="size-16" aria-hidden="true" />
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={buttonClasses({ variant: "secondary", size: "icon" })}
            disabled={!store.history.canUndo}
            title={store.history.undoStackTitle}
            aria-label="Undo history"
          >
            <ChevronDown class="size-16" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.GroupHeading>Undo, newest change first</DropdownMenu.GroupHeading>
            {#each store.history.undoLabels as label, index (index)}
              <DropdownMenu.Item onSelect={() => runUndo(index + 1)}>
                {index + 1}. {label}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <Button
          variant="secondary"
          size="icon"
          disabled={!store.history.canRedo}
          title={store.history.redoTitle}
          aria-label="Redo"
          onclick={() => runRedo(1)}
        >
          <Redo2 class="size-16" aria-hidden="true" />
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={buttonClasses({ variant: "secondary", size: "icon" })}
            disabled={!store.history.canRedo}
            title={store.history.redoStackTitle}
            aria-label="Redo history"
          >
            <ChevronDown class="size-16" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.GroupHeading>Redo, next change first</DropdownMenu.GroupHeading>
            {#each store.history.redoLabels as label, index (index)}
              <DropdownMenu.Item onSelect={() => runRedo(index + 1)}>
                {index + 1}. {label}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <!-- Absence is the signal: the control exists only while a filter is in play. -->
        {#if grid.isFiltered}
          <Button
            variant="secondary"
            size="icon"
            title="Clear {grid.activeFilterCount} filter{grid.activeFilterCount === 1 ? '' : 's'}"
            aria-label="Clear the filters"
            onclick={() => grid.clearAllFilters()}
          >
            <FunnelX class="size-16" aria-hidden="true" />
          </Button>
        {/if}

        <DataTable.GridColumnsMenu {grid} />

        <Button
          variant="secondary"
          size="icon"
          aria-pressed={expanded}
          title={expanded ? "Shrink back to a window" : "Fill the screen"}
          aria-label={expanded ? "Shrink back to a window" : "Fill the screen"}
          onclick={() => (expanded = !expanded)}
        >
          {#if expanded}
            <Minimize2 class="size-16" aria-hidden="true" />
          {:else}
            <Maximize2 class="size-16" aria-hidden="true" />
          {/if}
        </Button>
        <Button
          variant="secondary"
          size="icon"
          title="Close the Time Sheet"
          aria-label="Close the Time Sheet"
          onclick={() => (open = false)}
        >
          <X class="size-16" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-12 px-24 py-16">
      {#if store.timerFailure !== null}
        <Alert.Root variant="danger">
          <Alert.Title>The Timer</Alert.Title>
          <Alert.Description>{store.timerFailure}</Alert.Description>
        </Alert.Root>
      {/if}
      {#if announcement !== null}
        <Alert.Root variant="info">
          <Alert.Description>{announcement}</Alert.Description>
        </Alert.Root>
      {/if}

      <!-- The list region takes the remaining height and keeps it, so the sheet does not reflow as
           rows arrive, as a filter narrows them, or as the empty state replaces them. -->
      <div class="min-h-0 flex-1">
        <DataTable.Grid
          {grid}
          {cell}
          class="h-full"
          caption="Time recorded on this matter"
          empty={emptySheet}
        />
      </div>

      <!-- The sheet ends in a button rather than a standing blank row: nothing empty sits at rest,
           and one press creates the row and puts the cursor in it. -->
      <Button variant="secondary" class="self-start" onclick={addRow}>
        <Plus class="size-16" aria-hidden="true" />
        Add a Row
      </Button>
    </div>

    <DataTable.GridFooter {grid} end={honestyStrip} />
  </Dialog.Content>
</Dialog.Root>

<TimeRecordWindow
  bind:open={recordWindowOpen}
  bind:editing={recordWindowEditing}
  entry={recordWindowEntry}
  {matterId}
  {matterTitle}
  {members}
  {sessionUserId}
  canWorkDraft={(entry) =>
    entry.status === "draft"
      ? { allowed: true, reason: "Change any part of this draft." }
      : { allowed: false, reason: statusEntry(entry.status).meaning }}
  onSaved={onChanged}
/>
