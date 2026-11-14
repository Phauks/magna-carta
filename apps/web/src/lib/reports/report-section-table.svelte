<script lang="ts">
  /*
   * One report section: its heading with the completeness line at the heading's end, the one
   * sentence it says about itself, then its rows.
   *
   * A SORTABLE section is drawn by the platform's one table (report-section-grid.svelte). Any
   * other section is a plain table whose total row stays ruled off under the rows, because it is
   * the report's total and not a row of it. A row with details (a client's matters) opens them
   * beneath itself on a press of its name. Opening is arrangement: every figure is the presenter's.
   *
   * NO SIDEWAYS SCROLL. Where the section's own column is wide enough (a container query, because
   * the report sits beside the reports column and the sidebar, so the window's width says little)
   * the section is a table; narrower, each row is a card of label and figure pairs, so a phone or a
   * narrow window reads every column without scrolling across.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { ReportCell, ReportSection } from "./report-presentation.ts";
  import ReportSectionGrid from "./report-section-grid.svelte";

  let { section }: { section: ReportSection } = $props();

  const endAligned = $derived(new Set(section.endAlignedColumns ?? []));
  const attention = $derived(new Set(section.attentionColumns ?? []));

  // The cards on a phone keep the served order; the table above them is where a reader sorts.
  const order = $derived(section.rows.map((_, rowIndex) => rowIndex));

  let opened = $state<ReadonlySet<number>>(new Set());
  function toggle(rowIndex: number): void {
    const next = new Set(opened);
    if (next.has(rowIndex)) next.delete(rowIndex);
    else next.add(rowIndex);
    opened = next;
  }

  function detailsOf(rowIndex: number): readonly (readonly ReportCell[])[] {
    return section.rowDetails?.[rowIndex] ?? [];
  }

  function textOf(cell: ReportCell | undefined): string {
    if (cell === undefined) return "";
    return typeof cell === "string" ? cell : cell.text;
  }

  function isAttention(cell: ReportCell | undefined, columnIndex: number): boolean {
    return (
      attention.has(columnIndex) && cell !== undefined && typeof cell !== "string" && cell.number !== 0
    );
  }

  function cellClass(cell: ReportCell | undefined, columnIndex: number): string | undefined {
    const classes = [
      endAligned.has(columnIndex) ? "tabular-nums" : "",
      isAttention(cell, columnIndex) ? "text-status-danger" : "",
    ]
      .filter((value) => value !== "")
      .join(" ");
    return classes === "" ? undefined : classes;
  }

  const TOTAL_CELL = "border-t border-border-strong font-semibold";
</script>

<section class="@container flex flex-col gap-8">
  <div class="flex flex-wrap items-baseline justify-between gap-8 border-b border-border-strong pb-8">
    <FieldLabel as="h2">{section.title}</FieldLabel>
    {#if section.aside !== undefined}
      <p class="text-xs text-text-muted">{section.aside}</p>
    {/if}
  </div>
  {#if section.note !== undefined}
    <p class="text-xs text-text-muted">{section.note}</p>
  {/if}

  <!-- The table, where the section's column is wide enough for it. -->
  <div class="hidden @3xl:block">
    {#if section.sortable === true}
      <ReportSectionGrid {section} />
    {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">{section.title}</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          {#each section.headers as header, columnIndex (columnIndex)}
            <DataTable.Head data-align={endAligned.has(columnIndex) ? "end" : undefined}>
              {header}
            </DataTable.Head>
          {/each}
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each order as rowIndex (rowIndex)}
          {@const row = section.rows[rowIndex] ?? []}
          {@const details = detailsOf(rowIndex)}
          <DataTable.Row>
            {#each row as cell, columnIndex (columnIndex)}
              <DataTable.Cell
                data-align={endAligned.has(columnIndex) ? "end" : undefined}
                class={cellClass(cell, columnIndex)}
              >
                {#if columnIndex === 0 && details.length > 0}
                  <button
                    type="button"
                    class="inline-flex items-center gap-4 text-start"
                    aria-expanded={opened.has(rowIndex)}
                    onclick={() => toggle(rowIndex)}
                  >
                    {#if opened.has(rowIndex)}
                      <ChevronDown class="size-16 shrink-0" aria-hidden="true" />
                    {:else}
                      <ChevronRight class="size-16 shrink-0" aria-hidden="true" />
                    {/if}
                    {textOf(cell)}
                  </button>
                {:else}
                  {textOf(cell)}
                {/if}
              </DataTable.Cell>
            {/each}
          </DataTable.Row>
          {#if opened.has(rowIndex)}
            {#each details as detail, detailIndex (detailIndex)}
              <DataTable.Row class="bg-surface-sunken">
                {#each detail as cell, columnIndex (columnIndex)}
                  <DataTable.Cell
                    data-align={endAligned.has(columnIndex) ? "end" : undefined}
                    class={[
                      cellClass(cell, columnIndex),
                      columnIndex === 0 ? "ps-32 text-text-muted" : undefined,
                    ]}
                  >
                    {textOf(cell)}
                  </DataTable.Cell>
                {/each}
              </DataTable.Row>
            {/each}
          {/if}
        {:else}
          <DataTable.Row data-placeholder="true">
            <DataTable.Cell colspan={section.headers.length}>
              <span class="text-text-muted">{section.whenEmpty}</span>
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
        {#if section.totalRow !== undefined && section.rows.length > 0}
          <DataTable.Row>
            {#each section.totalRow as cell, columnIndex (columnIndex)}
              <DataTable.Cell
                data-align={endAligned.has(columnIndex) ? "end" : undefined}
                class={[TOTAL_CELL, cellClass(cell, columnIndex)]}
              >
                {textOf(cell)}
              </DataTable.Cell>
            {/each}
          </DataTable.Row>
        {/if}
      </DataTable.Body>
    </DataTable.Root>
    {/if}
  </div>

  <!-- Narrower: each row a card of label and figure pairs. -->
  <ul class="grid grid-cols-1 gap-8 @md:grid-cols-2 @3xl:hidden">
    {#each order as rowIndex (rowIndex)}
      {@const row = section.rows[rowIndex] ?? []}
      {@const details = detailsOf(rowIndex)}
      <li class="rounded-md border border-border-default p-12">
        {@render rowCard(row, false)}
        {#if details.length > 0}
          <button
            type="button"
            class="mt-8 inline-flex items-center gap-4 text-xs text-text-link"
            aria-expanded={opened.has(rowIndex)}
            onclick={() => toggle(rowIndex)}
          >
            {#if opened.has(rowIndex)}
              <ChevronDown class="size-16" aria-hidden="true" />
            {:else}
              <ChevronRight class="size-16" aria-hidden="true" />
            {/if}
            {details.length === 1 ? "1 matter" : `${String(details.length)} matters`}
          </button>
          {#if opened.has(rowIndex)}
            <ul class="mt-8 flex flex-col gap-8">
              {#each details as detail, detailIndex (detailIndex)}
                <li class="rounded-md bg-surface-sunken p-8">{@render rowCard(detail, false)}</li>
              {/each}
            </ul>
          {/if}
        {/if}
      </li>
    {:else}
      <li class="text-sm text-text-muted">{section.whenEmpty}</li>
    {/each}
    {#if section.totalRow !== undefined && section.rows.length > 0}
      <li class="rounded-md border border-border-strong bg-surface-sunken p-12">
        {@render rowCard(section.totalRow, true)}
      </li>
    {/if}
  </ul>
</section>

{#snippet rowCard(row: readonly ReportCell[], total: boolean)}
  <p class={["text-sm", total ? "font-semibold" : "font-medium"]}>{textOf(row[0])}</p>
  <dl class="mt-4 grid grid-cols-2 gap-x-12 gap-y-2 text-xs">
    {#each row.slice(1) as cell, offset (offset)}
      {@const columnIndex = offset + 1}
      <dt class="text-text-muted">{section.headers[columnIndex]}</dt>
      <dd class={["text-end", cellClass(cell, columnIndex), total ? "font-semibold" : undefined]}>
        {textOf(cell)}
      </dd>
    {/each}
  </dl>
{/snippet}
