<script lang="ts">
  /*
   * Table states — the platform's one table (DataTable.Grid), in every state, on one scrollable
   * surface.
   *
   * This page is the REVIEW SURFACE for the table system. It exists so the settled table machinery
   * can be looked at without a standalone mockup file: a mockup drifts from the product the moment
   * either one changes, and it is styled by hand rather than by the components that actually ship.
   * Everything below renders the real design-system grid over a litigation fixture, so what a
   * reviewer sees is what a matter surface gets — sorting, the in-header filters, pinning, the
   * totals row, selection, and the empty states.
   *
   * Dev builds only, like the developer console itself — behind the import.meta.env.DEV gate.
   */
  import Badge from "@magna-carta/design-system/badge";
  import type { BadgeVariant } from "@magna-carta/design-system/badge";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import BackLink from "$lib/navigation/back-link.svelte";
  import {
    createDataTableGrid,
    type DataTableGridOptions,
    type GridColumn,
  } from "@magna-carta/design-system/data-table";

  /** The console every gallery here was opened from, and where the way out leads. */
  const DEVELOPER_CONSOLE_HREF = "/developer-console";

  type TimeEntry = {
    id: string;
    workDate: string;
    entryNumber: string;
    timekeeper: string;
    title: string;
    hours: number;
    rate: number;
    amount: number | null;
    status: "Draft" | "Submitted" | "Approved" | "Billed" | "Void";
  };

  function entry(
    id: string,
    workDate: string,
    sequence: number,
    timekeeper: string,
    title: string,
    hours: number,
    rate: number,
    status: TimeEntry["status"],
  ): TimeEntry {
    return {
      id,
      workDate,
      entryNumber: `2026-0147.${String(sequence).padStart(4, "0")}`,
      timekeeper,
      title,
      hours,
      rate,
      amount: status === "Void" ? null : Math.round(hours * rate * 100) / 100,
      status,
    };
  }

  // Deterministic litigation fixture — Pemberton v. Hale. No clock, no randomness, so the page
  // reads the same on every render and a screenshot pass is never chasing data.
  const TIME_ENTRIES: TimeEntry[] = [
    entry("t01", "2026-08-14", 1, "Rosalind Chase", "Draft motion to compel production", 2.5, 450, "Submitted"),
    entry("t02", "2026-08-03", 2, "Rosalind Chase", "Review discovery responses from Hale", 1.2, 450, "Approved"),
    entry("t03", "2026-08-03", 3, "Edmund Voss", "Client call: deposition preparation", 0.5, 300, "Approved"),
    entry("t04", "2026-08-05", 4, "Marian Holt", "Summarize Pemberton deposition transcript", 3.4, 175, "Billed"),
    entry("t05", "2026-08-07", 5, "Edmund Voss", "Research spoliation sanctions standard", 2.1, 300, "Draft"),
    entry("t06", "2026-08-07", 6, "Rosalind Chase", "Revise protective order stipulation", 1.8, 450, "Draft"),
    entry("t07", "2026-08-10", 7, "Marian Holt", "Index exhibits for motion hearing", 2.7, 175, "Submitted"),
    entry("t08", "2026-08-11", 8, "Edmund Voss", "Draft meet-and-confer letter", 0.9, 300, "Void"),
    entry("t09", "2026-08-12", 9, "Rosalind Chase", "Hearing preparation: motion to compel", 3.1, 450, "Draft"),
    entry("t10", "2026-08-12", 10, "Marian Holt", "Update privilege log", 1.4, 175, "Billed"),
    entry("t11", "2026-08-13", 11, "Edmund Voss", "Analyze Hale document production", 2.2, 300, "Submitted"),
    entry("t12", "2026-08-01", 12, "Rosalind Chase", "Case strategy conference", 1, 450, "Billed"),
    entry("t13", "2026-08-04", 13, "Marian Holt", "Chronology of key correspondence", 2.9, 175, "Approved"),
    entry("t14", "2026-08-06", 14, "Edmund Voss", "Prepare exhibit objections chart", 1.6, 300, "Submitted"),
  ];

  const TIME_COLUMNS: GridColumn<TimeEntry>[] = [
    { id: "workDate", label: "Date", type: "date", anchored: true, value: (row) => row.workDate },
    { id: "entryNumber", label: "Entry Number", hidden: true, value: (row) => row.entryNumber },
    { id: "timekeeper", label: "Timekeeper", filter: "set", value: (row) => row.timekeeper },
    { id: "title", label: "Title", value: (row) => row.title },
    {
      id: "hours",
      label: "Hours",
      type: "number",
      total: "sum",
      totalText: (sum) => `${sum.toFixed(1)} h`,
      filterNote: "In hours, as billed.",
      value: (row) => row.hours,
    },
    {
      id: "rate",
      label: "Rate",
      type: "money",
      value: (row) => row.rate,
      text: (row) => `$${row.rate.toFixed(2)}/hr`,
      filterNote: "In $.",
    },
    {
      id: "amount",
      label: "Amount",
      type: "money",
      total: "sum",
      filterNote: "In $.",
      value: (row) => row.amount,
    },
    { id: "status", label: "Status", filter: "set", value: (row) => row.status },
  ];

  const STATUS_BADGE: Record<TimeEntry["status"], BadgeVariant> = {
    Draft: "neutral",
    Submitted: "warning",
    Approved: "success",
    Billed: "info",
    Void: "danger",
  };

  let lastActivated = $state<string | null>(null);
  let lastSelectionCount = $state(0);

  function specimenGrid(
    overrides: Partial<DataTableGridOptions<TimeEntry>> = {},
    columns: GridColumn<TimeEntry>[] = TIME_COLUMNS,
  ) {
    return createDataTableGrid<TimeEntry>({
      columns: () => columns,
      rows: () => TIME_ENTRIES,
      rowKey: (row) => row.id,
      initialSort: { columnId: "workDate", direction: "descending" },
      // Voids never count toward totals — a withdrawn line is not part of any sum.
      totalIncludes: (row) => row.status !== "Void",
      itemNoun: { singular: "entry", plural: "entries" },
      ...overrides,
    });
  }

  // One grid per specimen: each state stands alone, so touching one never disturbs another.
  const restingGrid = specimenGrid({
    onActivate: (row) => (lastActivated = row.entryNumber),
    onSelectionChange: (keys) => (lastSelectionCount = keys.length),
  });
  const sortedGrid = specimenGrid({
    initialSort: { columnId: "hours", direction: "descending" },
  });
  const filteredGrid = specimenGrid();
  filteredGrid.setFilter("status", { kind: "set", values: ["Draft"] });
  const filteredEmptyGrid = specimenGrid();
  filteredEmptyGrid.setFilter("title", { kind: "text", query: "arbitration" });
  const pinnedGrid = specimenGrid(
    {},
    TIME_COLUMNS.map((column) =>
      column.id === "timekeeper" ? { ...column, pinned: true } : { ...column, hidden: false },
    ),
  );
  const selectionGrid = specimenGrid();
  selectionGrid.rowClick("t01");
  selectionGrid.rowClick("t04", { shift: true });
  // Pinned in a deliberate arrangement — the older entry first, so the block cannot be read as
  // the sort — with two rows marked for the clipboard and one standing in for a quieter row.
  const PINNED_ROW_KEYS = ["t12", "t05"];
  const CLIPBOARD_MARKS: Record<string, "cut" | "copy" | undefined> = { t04: "cut", t07: "copy" };
  const markedGrid = specimenGrid({
    pinnedRowKeys: () => PINNED_ROW_KEYS,
    rowMark: (row) => ({
      pinned: PINNED_ROW_KEYS.includes(row.id),
      clipboard: CLIPBOARD_MARKS[row.id],
      quiet: row.status === "Void",
    }),
  });
  const zebraGrid = specimenGrid({ zebra: true });
  const compactGrid = specimenGrid();
  const loadingGrid = specimenGrid();
  const emptyGrid = createDataTableGrid<TimeEntry>({
    columns: () => TIME_COLUMNS,
    rows: () => [],
    rowKey: (row) => row.id,
    itemNoun: { singular: "entry", plural: "entries" },
  });
</script>

<svelte:head><title>Table states · Magna Carta</title></svelte:head>

{#snippet statusCell({ row, column, text }: DataTable.GridCellContext<TimeEntry>)}
  {#if column.id === "status"}
    <Badge variant={STATUS_BADGE[row.status]}>{row.status}</Badge>
  {:else if text === ""}
    <span class="mc-table-grid-empty-value" aria-hidden="true">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <!-- The caps line that named the console this gallery was opened from now RETURNS to it,
           in the same register it already read in. -->
      <nav aria-label="Back to Developer console" class="flex">
        <BackLink href={DEVELOPER_CONSOLE_HREF} label="Developer console" />
      </nav>
      <h1 class="text-2xl font-semibold">Table states</h1>
      <p class="text-sm text-text-muted">
        The platform's one table (DataTable.Grid) in every state, rendered from the real design
        system over a litigation fixture. Use this instead of a standalone mockup: a mockup is
        styled by hand and drifts the moment either side changes, while everything here is the
        shipping component. Every column sorts (type-aware, stable), every column filters through
        the one in-header mechanism, columns show/hide, drag-reorder, pin, and resize with
        double-click fit.
      </p>
    </header>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">At rest</h2>
        <p class="text-sm text-text-muted">
          Sorted by the anchored Date column, newest first. Right-click a header for everything
          the column can be asked — filter, hide, pin, the roster. Click a row to select;
          double-click emits an activation event — the grid itself opens nothing. The totals row
          sums what is in view, voids never counted.
        </p>
        {#if lastActivated !== null || lastSelectionCount > 0}
          <p class="text-xs text-text-muted">
            Emitted: {lastSelectionCount} selected{lastActivated === null
              ? ""
              : ` · last activated ${lastActivated}`}
          </p>
        {/if}
      </div>
      <DataTable.Grid grid={restingGrid} caption="Time entries, at rest" cell={statusCell} />
      <DataTable.GridFooter grid={restingGrid}>
        {#snippet end()}
          <span>Pemberton v. Hale</span>
        {/snippet}
      </DataTable.GridFooter>
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Sorted by a numeric column</h2>
        <p class="text-sm text-text-muted">
          Hours descending: numeric order, never lexicographic, and stable — equal values keep a
          deterministic order. Empty values sort last in either direction.
        </p>
      </div>
      <DataTable.Grid grid={sortedGrid} caption="Time entries, sorted by hours" cell={statusCell} />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Filtered</h2>
        <p class="text-sm text-text-muted">
          Status narrowed to Draft, from that header's own right-click menu. The filtered column
          is MARKED (accent fill, no control in the cell), the footer counts n of m with the
          one-click way out, and the totals row turns scope-honest: "In view", never a silent
          whole-matter sum.
        </p>
      </div>
      <DataTable.Grid grid={filteredGrid} caption="Time entries, filtered" cell={statusCell} />
      <DataTable.GridFooter grid={filteredGrid} />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Filtered, nothing left</h2>
        <p class="text-sm text-text-muted">
          Distinct from empty: the table says WHY it is empty — which filters hide how many rows —
          and hands over the way out.
        </p>
      </div>
      <DataTable.Grid
        grid={filteredEmptyGrid}
        caption="Time entries, filtered to nothing"
        cell={statusCell}
      />
      <DataTable.GridFooter grid={filteredEmptyGrid} />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Pinned under horizontal scroll</h2>
        <p class="text-sm text-text-muted">
          Every column shown inside a narrow viewport, Timekeeper pinned from its header menu: the
          anchored Date column joins the sticky block, contiguous from the leading edge, a hairline
          marking where the pinned block ends. Scroll sideways — the block holds still, and the
          table scrolls its own container, never the page.
        </p>
      </div>
      <div class="max-w-2xl">
        <DataTable.Grid grid={pinnedGrid} caption="Time entries, pinned" cell={statusCell} />
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Selection</h2>
        <p class="text-sm text-text-muted">
          A Shift range held in state: click selects one, Ctrl+click toggles, Shift+click extends,
          Ctrl+A takes the view (text fields keep native select-all), arrows move and Shift+arrows
          extend, clicking empty space clears. The footer counts the selection with a
          say-what-it-does control, and never reflows when it appears.
        </p>
      </div>
      <DataTable.Grid grid={selectionGrid} caption="Time entries, selection" cell={statusCell} />
      <DataTable.GridFooter grid={selectionGrid} />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Row groups and row marks</h2>
        <p class="text-sm text-text-muted">
          Pinned items sit above everything, separated by a rule, in the order the member arranged
          them rather than the table's sort: the first row here is the fixture's oldest entry, so
          only the pin can have put it there. The marks are one vocabulary across every surface —
          the filled pin, a dashed edge while a row waits on a cut or a copy (a cut row speaks
          quieter, because it is leaving), and the same quieter voice for a row present but not of
          the list's own kind: a deleted match among live results, an event a row inherited from a
          folder act.
        </p>
      </div>
      <DataTable.Grid
        grid={markedGrid}
        caption="Time entries, pinned and marked"
        cell={statusCell}
      />
      <DataTable.GridFooter grid={markedGrid} />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Zebra</h2>
        <p class="text-sm text-text-muted">
          The Columns submenu's display setting. The stripe is the faintest tint — it never competes
          with hover or a selected row.
        </p>
      </div>
      <DataTable.Grid grid={zebraGrid} caption="Time entries, zebra" cell={statusCell} />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Compact density</h2>
        <p class="text-sm text-text-muted">
          The per-table density step for power users and long lists. Row heights stay consistent —
          one line per row at every density.
        </p>
      </div>
      <DataTable.Grid
        grid={compactGrid}
        caption="Time entries, compact"
        density="compact"
        cell={statusCell}
      />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Loading</h2>
        <p class="text-sm text-text-muted">Skeleton rows stand in for data until it arrives.</p>
      </div>
      <DataTable.Grid grid={loadingGrid} caption="Time entries, loading" loading />
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Empty</h2>
        <p class="text-sm text-text-muted">
          Nothing exists yet and nothing is hidden — distinct from filtered-empty. A real surface
          supplies its own empty-state composition through the empty snippet; this is the default.
        </p>
      </div>
      <DataTable.Grid grid={emptyGrid} caption="Time entries, empty" />
    </section>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The table-states page is only available in development builds.
  </p>
{/if}
