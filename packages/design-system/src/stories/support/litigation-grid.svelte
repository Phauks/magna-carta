<script lang="ts" module>
  /*
   * Story support: the worked DataTable.Grid composition over a litigation timesheet fixture —
   * NOT part of the design-system API. One place defines the column model and the fixture rows so
   * the grid stories (and their play tests) exercise the same table the matter surfaces will
   * compose: an anchored Date column, typed number/money/date columns with totals, set filters
   * with counts, and a consumer-supplied status cell (chips stay the consumer's business).
   */
  import type { GridColumn } from "../../lib/components/data-table/index.ts";
  import type { BadgeVariant } from "../../lib/components/badge/variants.ts";

  export type TimeEntry = {
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

  // Deterministic litigation fixture — no clock, no randomness (visual baselines must be stable).
  // The first row is deliberately NOT the earliest date, so a sort visibly reorders.
  export const TIME_ENTRIES: TimeEntry[] = [
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
  ];

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

  export const TIME_COLUMNS: GridColumn<TimeEntry>[] = [
    { id: "workDate", label: "Date", type: "date", anchored: true, value: (row) => row.workDate },
    {
      id: "entryNumber",
      label: "Entry Number",
      hidden: true,
      value: (row) => row.entryNumber,
    },
    {
      id: "timekeeper",
      label: "Timekeeper",
      filter: "set",
      value: (row) => row.timekeeper,
      fitExtra: 30,
    },
    // A title is prose — no two entries share one — so it is the column that keeps the contains
    // box, by declaring it; every other text column gets the set.
    { id: "title", label: "Title", filter: "text", value: (row) => row.title },
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
    { id: "status", label: "Status", filter: "set", value: (row) => row.status, fitExtra: 26 },
  ];

  const STATUS_BADGE: Record<TimeEntry["status"], BadgeVariant> = {
    Draft: "neutral",
    Submitted: "warning",
    Approved: "success",
    Billed: "info",
    Void: "danger",
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import Badge from "../../lib/components/badge/index.ts";
  import * as DataTable from "../../lib/components/data-table/index.ts";
  import { createDataTableGrid } from "../../lib/components/data-table/index.ts";
  import type { GridBandFoot, GridGrouping, GridRowMark } from "../../lib/components/data-table/index.ts";

  type Props = {
    rows?: TimeEntry[];
    /** The column model; override to exercise a variant (a trailing-pinned column, say). */
    columns?: GridColumn<TimeEntry>[];
    loading?: boolean;
    density?: "comfortable" | "compact";
    zebra?: boolean;
    /** Pinned row ids, in the member's own arranged order (never the table's sort). */
    pinnedRowKeys?: readonly string[];
    rowMark?: (row: TimeEntry) => GridRowMark | undefined;
    /** The record's second line, passed through to the grid. */
    rowDetail?: Snippet<[TimeEntry]>;
    /** Bands the rows split into, under a heading row each; omitted, the list is flat. */
    grouping?: GridGrouping<TimeEntry> | null;
    /** What a band heading carries after its label and count. */
    bandDetail?: Snippet<[string]>;
    /** The add line at each band's foot, passed through to the grid. */
    bandFoot?: GridBandFoot<TimeEntry>;
    /**
     * Column widths to snapshot on mount, which also puts the table into its fixed layout.
     *
     * It is how a story reaches the state a member reaches by dragging a grip: columns that sum to
     * more than the frame, so the table scrolls sideways and the placeholder row's cell is wider
     * than anything the reader can see.
     */
    columnWidths?: Record<string, number>;
    /**
     * The scroll frame's own sizing classes. Capped by default, which is how most stories want it.
     */
    frameClass?: string;
    /**
     * A definite height for the frame, as an inline length on the box around it.
     *
     * It is a raw length and not a utility on purpose: the spacing scale stops at 96px, which is
     * about what this table's header, one row and its totals already measure — so no utility in
     * the theme can make a frame TALLER than its own content, and a story about the space below a
     * short table needs exactly that. Scaffolding for a measurement, in a fixture that is not part
     * of the design-system API; nothing shipped sizes a table this way.
     */
    frameHeight?: string;
    /** How the grid meets its surroundings — the card, or edge to edge inside the surface's own frame. */
    frame?: "card" | "flush";
    onActivate?: (row: TimeEntry) => void;
    onSelectionChange?: (keys: readonly string[], rows: readonly TimeEntry[]) => void;
  };
  let {
    rows = TIME_ENTRIES,
    columns = TIME_COLUMNS,
    loading = false,
    density = "comfortable",
    zebra = false,
    pinnedRowKeys = [],
    rowMark,
    rowDetail,
    grouping = null,
    bandDetail,
    bandFoot,
    columnWidths,
    frameClass = "max-h-96",
    frameHeight,
    frame = "card",
    onActivate,
    onSelectionChange,
  }: Props = $props();

  const grid = createDataTableGrid<TimeEntry>({
    columns: () => columns,
    rows: () => rows,
    rowKey: (row) => row.id,
    pinnedRowKeys: () => pinnedRowKeys,
    rowMark: (row) => rowMark?.(row),
    grouping: () => grouping,
    initialSort: { columnId: "workDate", direction: "descending" },
    // Voids never count toward totals — a withdrawn line is not part of any sum.
    totalIncludes: (row) => row.status !== "Void",
    itemNoun: { singular: "entry", plural: "entries" },
    // The initial zebra choice is deliberately captured once — the columns menu owns it after.
    // svelte-ignore state_referenced_locally
    zebra,
    onActivate: (row) => onActivate?.(row),
    onSelectionChange: (keys, selectedRows) => onSelectionChange?.(keys, selectedRows),
  });

  let widthsTaken = false;
  $effect(() => {
    if (columnWidths === undefined || widthsTaken) return;
    widthsTaken = true;
    grid.snapshotColumnWidths(columnWidths);
  });
</script>

<div class="flex flex-col gap-8" style={frameHeight === undefined ? undefined : `block-size: ${frameHeight}`}>
  <DataTable.Grid
    {grid}
    caption="Time entries"
    {loading}
    {density}
    {rowDetail}
    {bandDetail}
    {bandFoot}
    {frame}
    class={frameClass}
  >
    {#snippet cell({ row, column, text })}
      {#if column.id === "status"}
        <Badge variant={STATUS_BADGE[row.status]}>{row.status}</Badge>
      {:else if text === ""}
        <span class="mc-table-grid-empty-value" aria-hidden="true">—</span>
      {:else}
        {text}
      {/if}
    {/snippet}
  </DataTable.Grid>
  <DataTable.GridFooter {grid}>
    {#snippet end()}
      <span>Pemberton v. Hale</span>
    {/snippet}
  </DataTable.GridFooter>
</div>
