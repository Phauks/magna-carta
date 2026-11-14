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
   * IT IS THE FIRM'S SHEET, AND IT OPENS FROM THE TOP BAR. Capture must never cost a person the
   * place they were working, so the sheet lives in the chrome and opens over whatever is on screen.
   * That makes the matter a per-row fact: two rows beside each other belong to two different
   * matters, so the Matter column carries a picker over the firm's own matters and a row may
   * legitimately carry none at all. Opening the sheet from a matter's Time tab changes two things
   * and nothing else — which rows are shown, and what a new row's matter starts as. One sheet, two
   * doors, never two components.
   *
   * A MATTERLESS ROW IS REAL AND SAYS WHAT IT IS. It holds typing, the timer runs on it, and it
   * carries a provisional code minted on the sheet. What it cannot do is reach the firm's record,
   * because capture takes a matter; so its mark says it is not written and names the matter as one
   * of the things it still needs. Nothing is invented server-side to paper over that.
   *
   * WHAT IS DESIGNED AND NOT YET SERVED STAYS ON SCREEN, refused, saying what it waits on — so a
   * reader can see the row's real shape and can never mistake an unserved field for an empty one.
   * What is left in that state is small and specific: moving a written entry to another matter,
   * recording one member's work under another's hand, and the firm's rounding increment.
   *
   * THE LIST USED TO BE MUCH LONGER, AND WAS WRONG. The entry number, the entered date and its
   * enterer, the resolved rate, the attachments and the internal memo were all rendered as gaps
   * against routes that were already serving them. A field is refused here only against the served
   * contract in $lib/matters/time-api.ts, re-read — never against what this file last believed.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/request.ts";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatMoney } from "@magna-carta/design-system/data-table";
  import { formatDuration, formatClock } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { parseDate } from "@internationalized/date";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import CircleCheckBig from "@lucide/svelte/icons/circle-check-big";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import CircleDotDashed from "@lucide/svelte/icons/circle-dot-dashed";
  import NotebookPen from "@lucide/svelte/icons/notebook-pen";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Square from "@lucide/svelte/icons/square";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import { autoSizeTextarea } from "./auto-size-textarea.ts";
  import { FirmMatters } from "./firm-matters.svelte.ts";
  import MatterPicker from "./matter-picker.svelte";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { personInitials } from "@magna-carta/design-system/formatters";
  import { gapCellTitle, gapReason } from "./time-gaps.ts";
  import TimeRecordWindow from "./time-record-window.svelte";
  import {
    TIME_SHEET_COLUMN_IDENTIFIERS,
    isUnservedSheetColumn,
    sheetColumnGap,
    timeSheetColumns,
  } from "./time-sheet-columns.ts";
  import UndoRedoControls, {
    historyAnnouncement,
    historyShortcuts,
    type HistoryOutcome,
  } from "@magna-carta/design-system/history";
  import {
    NO_MATTER_TEXT,
    isIncomplete,
    isWorkable,
    matterDisplay,
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
  import { civilDateOf } from "@magna-carta/civil-time/civil-date";

  let {
    open = $bindable(false),
    entries,
    matterFilter = null,
    matterTitle = null,
    members,
    sessionUserId,
    loading = false,
    readFailure = null,
    onRetryRead,
    onChanged,
  }: {
    open?: boolean;
    /** The entries as the listing answered them. The sheet seeds its rows from these. */
    entries: readonly TimeEntrySummary[];
    /**
     * The matter the sheet was opened from, or null for the firm-wide sheet in the top bar.
     *
     * It is what a new row's matter starts as, and what the caller's own read was narrowed by. It
     * never removes the Matter column: the column is what makes this one surface rather than two.
     */
    matterFilter?: string | null;
    /** That matter's title, where the sheet was opened from one. */
    matterTitle?: string | null;
    members: readonly FirmMemberSummary[];
    sessionUserId: string | null;
    /**
     * Whether the caller's read is still in flight.
     *
     * It is a separate fact from having no rows, and the two must not render alike: a sheet that
     * showed its empty state while the read was going would tell a person their day was blank a
     * moment before it filled in.
     */
    loading?: boolean;
    /** Why the caller's read failed, when it did. Null while it is fine or still going. */
    /** The failed read, whole — the sheet renders the Error ID and the remedy from it. */
    readFailure?: Failure | null;
    /** Read again. Absent where the caller has nothing to retry. */
    onRetryRead?: () => void;
    /** Something was written; the time wants re-reading. */
    onChanged: () => void;
  } = $props();

  /*
   * The firm's first weekday is a firm setting the settings registry will serve. Until it does, the
   * week preset spans a Monday-to-Sunday week and the label says which days it actually covered, so
   * the caption can never disagree with the span.
   */
  const FIRST_WEEKDAY_OF_THE_FIRMS_WEEK = 1;

  const today = civilDateOf(new Date());

  let announcement = $state<string | null>(null);

  /*
   * The firm's matters, read when the sheet first opens and not before: nothing is spent on them
   * while the sheet is shut, and both doors into the sheet then hold the same list without either
   * caller having to fetch it.
   */
  const firmMatters = new FirmMatters();
  $effect(() => {
    if (!open) return;
    void firmMatters.load(fetch);
  });

  const matters = $derived(firmMatters.matters ?? []);

  /**
   * How a row's matter reads, in the four states it can honestly be in: on none, on one that has
   * been read, on one while the reading is still going, and on one that was not in what was read.
   * The identifier is never printed: it is not a name, and a reader cannot do anything with it.
   */
  function matterText(row: SheetRow): string {
    if (row.matterId === null) return NO_MATTER_TEXT;
    const matter = firmMatters.byIdentifier(row.matterId);
    if (matter !== undefined) return matterDisplay(matter);
    // The matter this sheet was opened from is already named by whoever opened it, so a row on it
    // reads properly from the first frame and goes on doing so even if the firm's matters cannot
    // be read at all.
    if (row.matterId === matterFilter && matterTitle !== null) return matterTitle;
    return firmMatters.matters === null ? "Reading the firm's matters" : "Not in the matters read";
  }

  const store = new TimeSheetStore({
    matterFilter: () => matterFilter,
    entries: () => entries,
    members: () => members,
    sessionUserId: () => sessionUserId,
    today: () => today,
    // Called through rather than captured, so a caller that hands over a different callback is the
    // one the store actually reaches. A captured prop is the one it was built with, for ever.
    onChanged: () => onChanged(),
    announce: (message) => (announcement = message),
  });

  let scope = $state<SheetScope>(scopePreset("today", today, FIRST_WEEKDAY_OF_THE_FIRMS_WEEK));
  let searchOpen = $state(false);
  let searchText = $state("");
  let expanded = $state(true);
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
    // The widest column on the sheet, because it holds a number and a name together and a matter
    // truncated to its number is a matter the reader has to go and look up.
    [TIME_SHEET_COLUMN_IDENTIFIERS.matter]: 320,
    [TIME_SHEET_COLUMN_IDENTIFIERS.dateEntered]: 134,
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
  const rowsSearched = $derived(
    rowsInScope.filter((row) => searchMatches(row, searchText, matterText(row))),
  );

  const grid = DataTable.createDataTableGrid<SheetRow>({
    columns: () => timeSheetColumns(currency, liveSeconds, matterText),
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

  /*
   * WHICH MATTER THE RECORD WINDOW OPENS ON. An existing entry's own, because on a firm-wide sheet
   * the row beside it may be on a different one; a brand-new entry starts on the matter the sheet
   * was opened from, which is nothing at all when it was opened from the top bar, and the window
   * then asks for one itself.
   */
  const recordWindowMatterId = $derived(recordWindowEntry?.matterId ?? matterFilter);
  const recordWindowMatterTitle = $derived.by(() => {
    const matter = firmMatters.byIdentifier(recordWindowMatterId);
    if (matter !== undefined) return matterDisplay(matter);
    return matterTitle;
  });

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

  /*
   * What a walk came to, said once the writes have answered — never when the stack popped. A step
   * that announced on the pop told the reader the entry went back before the record agreed.
   */
  function said(outcome: HistoryOutcome): void {
    announcement = historyAnnouncement(outcome);
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

  /*
   * Ctrl+Z, Ctrl+Y and Shift+Ctrl+Z, from the design system. It reaches INSIDE the cells on purpose:
   * on a rapid-entry grid the cell is not the surface, and a reader who has typed into six of them
   * and presses Ctrl+Z means the sheet.
   */
  const keyPressed = historyShortcuts(store.history, { onOutcome: said });

  /** Whether this row may be typed into at all, and why not when it may not. */
  function editRefusal(row: SheetRow): string | undefined {
    if (isWorkable(row)) return undefined;
    return statusEntry(row.status).meaning;
  }
  /*
   * The three figures this sheet ends with, as the shared strip reads them. Worked and billed are
   * the same range in two literacies and the sheet shows both on purpose; the strip owns their
   * arrangement, this file owns what they mean.
   */
  const footerReading = $derived([
    {
      identifier: "worked",
      label: "worked",
      value: formatDuration(minutesFromSeconds(honesty.workedSeconds)).text,
      caption: "Time worked in this range, as worked.",
    },
    {
      identifier: "billed",
      label: "billed",
      value: formatDuration(honesty.billedMinutes).text,
      caption: "Time in this range as the firm's rounding increment billed it.",
    },
    {
      identifier: "value",
      label: "value",
      value: money(honesty.amountMinor),
      caption: "What this range is worth, before tax.",
    },
  ]);
</script>

<svelte:window onkeydown={open ? keyPressed : undefined} />

{#snippet unservedCell(columnIdentifier: string)}
  {@const gap = sheetColumnGap(columnIdentifier)}
  <span class="text-text-subtle" title={gap === undefined ? "" : gapCellTitle(gap)}>&mdash;</span>
{/snippet}

{#snippet saveMark(row: SheetRow)}
  <span class="inline-flex items-center" title={saveStateTitle(row)}>
    {#if row.saveState === "saving"}
      <!-- On its way to the record: the dashed ring of an unwritten row, with the dot that says
           the write is in hand. The title and the hidden text carry the word. -->
      <CircleDotDashed class="size-16 text-text-muted" aria-hidden="true" />
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

<!-- THE DESCRIPTION IS THE ROW'S SECOND LINE, not a column: it is prose, usually far longer than
     any other fact on the row, so it gets the row's full width underneath the fields and wraps
     there. The internal memo is its on-demand twin on a third line. -->
{#snippet rowDetail(row: SheetRow)}
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
    {#if memoOpened.has(row.key) || row.memo !== ""}
      <!-- Internal by construction: no client-facing projection selects the column, and the print
           sheet names every field it prints rather than spreading the entry. -->
      <div class="flex w-full items-start gap-8" data-internal-only="true">
        <Badge variant="neutral">Internal</Badge>
        <Textarea
          class="min-w-0 flex-1"
          rows={1}
          value={row.memo}
          placeholder="Internal Memo"
          title={refusal ?? "The firm's own note on this entry. It never reaches a bill or a client."}
          disabled={refusal !== undefined}
          spellcheck={true}
          onchange={(event) => store.setMemo(row.key, event.currentTarget.value)}
          {@attach autoSizeTextarea(row.memo)}
        />
      </div>
    {/if}
  </div>
{/snippet}

<!--
  THE MATTER IS SETTABLE ON EVERY DRAFT, written or not. On a row that has not reached the record it
  is the choice that lets the row be written at all; on one that has, picking another matter MOVES
  the entry — number, memo, codes, files and history intact — and re-reads its rate and rounding on
  the matter it moved to. Past draft the cell states where the entry is and why it stays: an
  approved or billed entry is evidence somebody is relying on, and the answer there is a void and
  a fresh record rather than a move nobody can see.
-->
{#snippet matterCell(row: SheetRow)}
  {@const refusal = editRefusal(row)}
  {#if refusal === undefined}
    <MatterPicker
      matters={matters}
      value={row.matterId}
      capped={firmMatters.capped}
      title={row.entryIdentifier === null
        ? "The matter this time is for. Type its number or name. A row with no matter stays on the sheet until you choose one."
        : "The matter this time is for. Choosing another matter moves the entry, with its number, note and files, and uses that matter's rate."}
      onpick={(matterId) => store.setMatter(row.key, matterId)}
    />
  {:else}
    <span class="block truncate" title="{matterText(row)}. {refusal}">
      {matterText(row)}
    </span>
  {/if}
{/snippet}

<!--
  THE CODE A ROW IS KNOWN BY, AND THERE ARE TWO OF THEM. Until the row reaches the firm's record it
  is held under a provisional code minted here, so a row somebody is typing into has a name to be
  referred to by; the moment it lands, the firm's own entry number replaces it, and the provisional
  one is kept on the hover because that is what the row was called meanwhile.
-->
{#snippet timeCodeCell(row: SheetRow)}
  {#if row.entryNumber !== null}
    <span
      class="whitespace-nowrap tabular-nums"
      title="The firm's own entry number. It is drawn once, never reused, and a voided entry keeps it.{row.provisionalCode ===
      null
        ? ''
        : ` It was held on this sheet as ${row.provisionalCode}.`}"
    >
      {row.entryNumber}
    </span>
  {:else if row.provisionalCode !== null}
    <span
      class="whitespace-nowrap tabular-nums text-text-muted"
      title="A temporary code for this row. The firm's entry number is assigned when the row is saved."
    >
      {row.provisionalCode}
    </span>
  {:else}
    <!-- An entry captured before the sequence existed. Nothing backfills a guess. -->
    <span class="text-text-subtle" title="This entry was captured before entry numbers existed."
      >&mdash;</span
    >
  {/if}
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
      ? formatClock(liveSeconds(row), { toTheSecond: true })
      : liveSeconds(row) > 0
        ? formatClock(liveSeconds(row))
        : ""}
    placeholder="Worked"
    title={refusal ??
      (running
        ? "Running. Typing here pauses the timer; its own button restarts it."
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
        ? "Already voided. It stays on the record."
        : row.entryIdentifier === null
          ? "Remove this row. It has not been written to the record."
          : "Void this entry. It stays on the record, numbered, and counts toward nothing."}
      aria-label="Void this entry"
      onclick={() => void store.voidRow(row.key)}
    >
      <Trash2 class="size-16" aria-hidden="true" />
    </Button>
  </span>
{/snippet}

{#snippet cell({ row, column, text }: DataTable.GridCellContext<SheetRow>)}
  {#if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.saveState}
    {@render saveMark(row)}
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.timeCode}
    {@render timeCodeCell(row)}
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.matter}
    {@render matterCell(row)}
  {:else if isUnservedSheetColumn(column.id)}
    {@render unservedCell(column.id)}
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.workDate}
    <!-- The product's own calendar, not the browser's: one themed picker on every surface. -->
    <span class="block" title={editRefusal(row) ?? "The day the work is for"}>
      <DatePicker
        value={parseDate(row.workDate)}
        disabled={editRefusal(row) !== undefined}
        onValueChange={(picked) => {
          if (picked !== undefined) commitWorkDate(row, picked.toString());
        }}
      />
    </span>
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.worked}
    {@render durationCell(row)}
  {:else if column.id === TIME_SHEET_COLUMN_IDENTIFIERS.hours}
    <!--
      Billed hours are the worked time under the firm's rounding increment — DERIVED, never typed,
      which is why this states a figure rather than offering a field.
      A row the firm holds carries its own billed figure, sent with the entry, so it simply reads.
      A row nobody has written yet cannot know: the increment is a per-matter setting and this
      sheet is one person's day across every matter they touched, so one answer would be wrong for
      some of the rows on it. That row says what it waits on instead of showing a number it guessed.
    -->
    {#if row.billedMinutes === null}
      <SoonAffordance reason={gapReason("rounding")}>
        {#snippet control(soon)}
          <Input class="text-end" placeholder="Hours" {...soon} />
        {/snippet}
      </SoonAffordance>
    {:else}
      <span class="block text-end tabular-nums" title="The time worked, rounded as the firm bills.">
        {formatDuration(row.billedMinutes).decimal}
      </span>
    {/if}
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


{#snippet honestyStrip()}
  <DataTable.GridFigures {grid} figures={footerReading} />
  <span aria-hidden="true">·</span>
  <span class="text-text-muted">{scope.label}{scope.note === undefined ? "" : `, ${scope.note}`}</span
  >
  {#if honesty.incompleteRows > 0}
    <span aria-hidden="true">·</span>
    <span
      class="text-status-warning-subtle-foreground"
      title="These rows are saved and still short of a description or a duration. They stay on the sheet until they are completed."
    >
      {honesty.incompleteRows} incomplete
    </span>
  {/if}
  <span aria-hidden="true">·</span>
  <UndoRedoControls history={store.history} onOutcome={said} />
{/snippet}

<!-- The sheet is a WORKING surface, so it opens filling the screen; the frame's own control shrinks
     it back to a window. Its toolbar is the first row of the pane, its identity the frame's header. -->
<ActionDialog
  bind:open
  bind:expanded
  kind="reading"
  width="record"
  heading="Time Sheet"
  subtitle={{ facts: [matterTitle ?? "All matters"] }}
>
  {#snippet fields()}
    <div class="flex flex-wrap items-center gap-8">

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
            <!-- One themed range picker instead of two bare date fields: pick both ends on one
                 calendar, drag across days, and the range applies as it lands. -->
            <DateRangePicker
              value={customRangeFrom === "" || customRangeTo === ""
                ? undefined
                : { start: parseDate(customRangeFrom), end: parseDate(customRangeTo) }}
              onValueChange={(range) => {
                customRangeFrom = range?.start?.toString() ?? "";
                customRangeTo = range?.end?.toString() ?? "";
                if (customRangeFrom !== "" && customRangeTo !== "") applyCustomRange();
              }}
            />
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
          title="Create the entry in the full form instead of the grid"
          onclick={newEntry}
        >
          <Plus class="size-16" aria-hidden="true" />
          New Entry
        </Button>

        <!-- Opening search must not move a single control: the button keeps its place and the
             field OVERLAYS leftward across the header's slack instead of inserting itself into
             the row. -->
        <span class="relative inline-flex">
          <Button
            variant="secondary"
            size="icon"
            title="Search the rows in view"
            aria-label="Search"
            aria-expanded={searchOpen}
            onclick={() => (searchOpen = true)}
          >
            <Search class="size-16" aria-hidden="true" />
          </Button>
          {#if searchOpen}
            <div
              class="absolute end-0 top-0 z-dropdown"
              style="inline-size: var(--mc-size-record-context)"
            >
              <Input
                class="w-full"
                value={searchText}
                placeholder="Search"
                aria-label="Search rows by description or person"
                oninput={(event) => (searchText = event.currentTarget.value)}
                onblur={() => {
                  if (searchText === "") searchOpen = false;
                }}
                {@attach (field) => field.focus()}
              />
            </div>
          {/if}
        </span>

        <!-- The way back to the whole sheet sits where the filters were set. Absence is the signal:
             the control is not here while nothing is narrowing the view. -->
        <DataTable.ClearFilters {grid} />

      </div>
    </div>

      {#if store.timerFailure !== null}
        <Alert.Root variant="danger">
          <Alert.Title>The Timer</Alert.Title>
          <Alert.Description>{store.timerFailure}</Alert.Description>
        </Alert.Root>
      {/if}
      {#if readFailure !== null}
        <!-- The read failed; the record itself is untouched by that, and the sheet says so rather
             than showing an empty table that reads as a day with no work in it. -->
        <FailureNotice
          failure={readFailure}
          subject="The time entries"
          fallback="The time on this sheet could not be read. The record itself is unaffected:
            nothing was changed by this failure."
          onRetry={onRetryRead}
        />
      {/if}
      {#if firmMatters.failure !== null}
        <!-- The sheet still opens and still holds what is typed into it; what it cannot do is file
             a row, and that is what this says rather than leaving an empty picker to be puzzled at. -->
        <Alert.Root variant="danger">
          <Alert.Title>The Firm's Matters</Alert.Title>
          <Alert.Description>
            {firmMatters.failure} Rows already on the record are unaffected.
          </Alert.Description>
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
          {rowDetail}
          {loading}
          class="h-full"
          caption={matterTitle === null
            ? "Time recorded across the firm's matters"
            : "Time recorded on this matter"}
        />
      </div>

      <!-- The sheet ends in a button rather than a standing blank row: nothing empty sits at rest,
           and one press creates the row and puts the cursor in it. -->
      <Button variant="secondary" class="self-start" onclick={addRow}>
        <Plus class="size-16" aria-hidden="true" />
        Add a Row
      </Button>

    <DataTable.GridFooter {grid} end={honestyStrip} />
  {/snippet}
</ActionDialog>

<TimeRecordWindow
  bind:open={recordWindowOpen}
  bind:editing={recordWindowEditing}
  entry={recordWindowEntry}
  matterId={recordWindowMatterId}
  matterTitle={recordWindowMatterTitle}
  {matters}
  mattersCapped={firmMatters.capped}
  {members}
  {sessionUserId}
  canWorkDraft={(entry) =>
    entry.status === "draft"
      ? { allowed: true, reason: "Change any part of this draft." }
      : { allowed: false, reason: statusEntry(entry.status).meaning }}
  onSaved={onChanged}
/>
