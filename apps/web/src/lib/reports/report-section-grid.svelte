<script lang="ts">
  /*
   * A sortable report section, drawn by the platform's one table (DataTable.Grid): sort on a
   * heading, the per-column filters from the heading's menu, show and hide, all as every other
   * list in the product has them.
   *
   * A ROW WITH DETAILS OPENS THEM UNDER ITSELF. A client's matters are rows of the same columns,
   * added under the client when its name is pressed and kept under it whatever the sort: the grid
   * sorts the clients, and each client's matters follow it in the order the report served them.
   *
   * The grid opens in the order the report served, largest first, and draws no totals row: its
   * totals row adds the column up, and a report's totals are the report's own, never a sum taken
   * on the screen. Every figure here is the presenter's text over the payload.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { ReportCell, ReportSection } from "./report-presentation.ts";

  let { section }: { section: ReportSection } = $props();

  interface SectionRow {
    readonly key: string;
    readonly cells: readonly ReportCell[];
    /** The row this one opens under, or null for a row of the section itself. */
    readonly parentKey: string | null;
    readonly detailCount: number;
  }

  let opened = $state<ReadonlySet<string>>(new Set());

  function toggle(key: string): void {
    const next = new Set(opened);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    opened = next;
  }

  const rows = $derived.by((): readonly SectionRow[] => {
    const all: SectionRow[] = [];
    section.rows.forEach((cells, rowIndex) => {
      const key = `row-${String(rowIndex)}`;
      const details = section.rowDetails?.[rowIndex] ?? [];
      all.push({ key, cells, parentKey: null, detailCount: details.length });
      if (!opened.has(key)) return;
      details.forEach((detail, detailIndex) => {
        all.push({
          key: `${key}-detail-${String(detailIndex)}`,
          cells: detail,
          parentKey: key,
          detailCount: 0,
        });
      });
    });
    return all;
  });

  const endAligned = $derived(new Set(section.endAlignedColumns ?? []));
  const attention = $derived(new Set(section.attentionColumns ?? []));
  const subordinate = $derived(section.subordinateColumns ?? []);

  /** What a row's subordinate columns say, drawn under its first cell: a client's office. */
  function subordinateText(row: SectionRow): string {
    return subordinate
      .map((columnIndex) => {
        const cell = cellAt(row, columnIndex);
        return cell === undefined ? "" : typeof cell === "string" ? cell : cell.text;
      })
      .filter((text) => text !== "")
      .join(" · ");
  }

  function cellAt(row: SectionRow, columnIndex: number): ReportCell | undefined {
    return row.cells[columnIndex];
  }

  const columns = $derived(
    section.headers.map(
      (header, columnIndex): DataTable.GridColumn<SectionRow> => ({
        id: `column-${String(columnIndex)}`,
        label: header,
        type: endAligned.has(columnIndex) ? "number" : "text",
        anchored: columnIndex === 0,
        // Drawn under the first cell instead; the reader can still show it from the heading menu.
        hidden: subordinate.includes(columnIndex),
        value: (row) => {
          const cell = cellAt(row, columnIndex);
          if (cell === undefined) return null;
          return typeof cell === "string" ? cell : cell.number;
        },
        text: (row) => {
          const cell = cellAt(row, columnIndex);
          if (cell === undefined) return "";
          return typeof cell === "string" ? cell : cell.text;
        },
      }),
    ),
  );

  /** The clients in the reader's order, each with its opened details under it in served order. */
  function orderRows(
    inView: readonly SectionRow[],
    compare: (left: SectionRow, right: SectionRow) => number,
  ): readonly SectionRow[] {
    const parents = inView.filter((row) => row.parentKey === null).toSorted(compare);
    const ordered: SectionRow[] = [];
    for (const parent of parents) {
      ordered.push(parent);
      for (const row of inView) if (row.parentKey === parent.key) ordered.push(row);
    }
    return ordered;
  }

  const grid = DataTable.createDataTableGrid<SectionRow>({
    columns: () => columns,
    rows: () => rows,
    rowKey: (row) => row.key,
    initialSort: { columnId: null, direction: "descending" },
    itemNoun: { singular: "row", plural: "rows" },
    orderRows,
  });

  function isAttention(row: SectionRow, columnIndex: number): boolean {
    const cell = cellAt(row, columnIndex);
    return (
      attention.has(columnIndex) && cell !== undefined && typeof cell !== "string" && cell.number !== 0
    );
  }
</script>

{#snippet sectionCell({ row, column, text }: DataTable.GridCellContext<SectionRow>)}
  {@const columnIndex = columns.indexOf(column)}
  {#if columnIndex === 0 && row.detailCount > 0}
    <button
      type="button"
      class="inline-flex min-w-0 items-center gap-4 text-start"
      aria-expanded={opened.has(row.key)}
      onclick={(event) => {
        event.stopPropagation();
        toggle(row.key);
      }}
    >
      {#if opened.has(row.key)}
        <ChevronDown class="mc-table-grid-row-glyph shrink-0" aria-hidden="true" />
      {:else}
        <ChevronRight class="mc-table-grid-row-glyph shrink-0" aria-hidden="true" />
      {/if}
      {@render firstCell(row, text)}
    </button>
  {:else if columnIndex === 0 && row.parentKey !== null}
    <span class="block ps-20 text-text-muted">{@render firstCell(row, text)}</span>
  {:else if columnIndex === 0}
    {@render firstCell(row, text)}
  {:else}
    <span class={["tabular-nums", isAttention(row, columnIndex) ? "text-status-danger" : undefined]}>
      {text}
    </span>
  {/if}
{/snippet}

{#snippet firstCell(row: SectionRow, text: string)}
  <span class="flex min-w-0 flex-col whitespace-normal">
    <span>{text}</span>
    {#if subordinateText(row) !== ""}
      <span class="text-xs text-text-muted">{subordinateText(row)}</span>
    {/if}
  </span>
{/snippet}

<DataTable.Grid {grid} caption={section.title} cell={sectionCell} />
