<script module lang="ts">
  /*
   * The three controls a table's control row and counts strip are made of — the figures a footer
   * ends with, the one way back to the whole table, and the way to the rest of a paged list.
   *
   * Each was hand-built on several surfaces before it lived here, which is what the stories pin:
   * one reading order for a figure, one shape for the clear control with the two acts it can be,
   * and one control for load-more that leaves when there is nothing more. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent } from "storybook/test";
  import GridFigures from "../lib/components/data-table/data-table-grid-figures.svelte";
  import ClearFilters from "../lib/components/data-table/data-table-clear-filters.svelte";
  import LoadMore from "../lib/components/data-table/data-table-load-more.svelte";
  import {
    createDataTableGrid,
    type DataTableGridState,
  } from "../lib/components/data-table/data-table-grid-state.svelte.ts";
  import type { GridColumn } from "../lib/components/data-table/grid-columns.ts";

  interface Entry {
    readonly id: string;
    readonly matter: string;
  }

  const ENTRIES: readonly Entry[] = [
    { id: "t1", matter: "Whitfield" },
    { id: "t2", matter: "Okonkwo" },
    { id: "t3", matter: "Whitfield" },
  ];

  const COLUMNS: readonly GridColumn<Entry>[] = [
    { id: "matter", label: "Matter", type: "text", value: (row) => row.matter, filter: "set" },
  ];

  function gridOf(): DataTableGridState<Entry> {
    return createDataTableGrid<Entry>({
      columns: () => COLUMNS,
      rows: () => ENTRIES,
      rowKey: (row) => row.id,
      itemNoun: { singular: "entry", plural: "entries" },
    });
  }

  /*
   * The meta points at the figures strip because it is the one of the three with a props table
   * worth reading; the other two are covered by their own stories below. svelte-csf needs a
   * directly imported component identifier here, not a namespace member.
   */
  const { Story } = defineMeta({
    title: "Data Display/DataTableControls",
    component: GridFigures,
    parameters: { controls: { disable: true } },
  });

  const FIGURES = [
    { identifier: "worked", label: "worked", value: "6.40", caption: "Time worked, as worked." },
    { identifier: "billed", label: "billed", value: "6.50", caption: "As the increment billed it." },
    { identifier: "value", label: "value", value: "$2,275.00", caption: "Worth, before tax." },
  ];
</script>

<script lang="ts">
  const restingGrid = gridOf();
  const filteredGrid = gridOf();
  filteredGrid.setFilter("matter", { kind: "set", values: ["Whitfield"] });
  const narrowedGrid = gridOf();
  narrowedGrid.setFilter("matter", { kind: "set", values: ["Whitfield"] });

  let loading = $state(false);
  let loaded = $state(0);
</script>

<Story
  name="Figures, unfiltered"
  play={async ({ canvas, step }) => {
    await step("The label leads and the figure follows, on every table", async () => {
      await expect(canvas.getByText("worked")).toBeVisible();
      await expect(canvas.getByText("6.40")).toBeVisible();
    });
    await step("Nothing claims the figures are scoped when nothing is scoping them", async () => {
      await expect(canvas.queryByText("In view:")).toBeNull();
    });
  }}
>
  {#snippet template()}
    <div class="p-8 text-sm">
      <GridFigures grid={restingGrid} figures={FIGURES} />
    </div>
  {/snippet}
</Story>

<Story
  name="Figures, under a filter"
  play={async ({ canvas, step }) => {
    await step("It says the figures are over the rows in view, before the first one", async () => {
      await expect(canvas.getByText("In view:")).toBeVisible();
    });
  }}
>
  {#snippet template()}
    <div class="p-8 text-sm">
      <GridFigures grid={filteredGrid} figures={FIGURES} />
    </div>
  {/snippet}
</Story>

{#snippet figuresWithAWholeRecordCount()}
  <div class="p-8 text-sm">
    <GridFigures
      grid={filteredGrid}
      figures={[
        ...FIGURES,
        {
          identifier: "waiting",
          label: "waiting to be filed",
          value: "3",
          caption: "Counted by the server over every record, whatever is in view.",
          scope: "whole-record",
        },
      ]}
    />
  </div>
{/snippet}

<Story
  name="Figures, under a filter, with one over the whole record"
  template={figuresWithAWholeRecordCount}
  play={async ({ canvas, canvasElement, step }) => {
    await step("A whole-record figure stands before the sentence, never under it", async () => {
      const strip = canvasElement.querySelector("[data-grid-figures]");
      const items = [...(strip?.querySelectorAll("[data-figure-scope]") ?? [])];
      await expect(items[0]).toHaveAttribute("data-figure-scope", "whole-record");
      await expect(items[0]).toHaveTextContent("waiting to be filed");
      const sentence = canvas.getByText("In view:");
      await expect(
        items[0]!.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
    await step("The figures that narrow still follow the sentence", async () => {
      const strip = canvasElement.querySelector("[data-grid-figures]");
      const narrowing = strip?.querySelectorAll('[data-figure-scope="rows-in-view"]');
      await expect(narrowing).toHaveLength(FIGURES.length);
    });
  }}
/>

<Story
  name="Clear filters, and the absence that precedes it"
  play={async ({ canvas, step }) => {
    /*
     * TWO tables are on screen and only ONE control: the resting table contributes nothing at all,
     * which is the rule this story exists to pin — a control that undoes a state is absent while
     * the state is not in play, never present and disabled.
     */
    await step("Only the filtered table has a way back, and it says what is in play", async () => {
      const controls = canvas.getAllByRole("button", { name: /Clear Filters/ });
      await expect(controls).toHaveLength(1);
      await expect(controls[0]).toHaveAttribute("title", "1 column filtered");
    });
    await step("Pressing it clears the filter, and the control leaves with the state", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Clear Filters:/ }));
      await expect(canvas.queryByRole("button", { name: /Clear Filters/ })).toBeNull();
    });
  }}
>
  {#snippet template()}
    <div class="flex items-center gap-8 p-8">
      <ClearFilters grid={restingGrid} />
      <ClearFilters grid={filteredGrid} />
    </div>
  {/snippet}
</Story>

<Story
  name="Clear filters, when a search is narrowing too"
  play={async ({ canvas, step }) => {
    await step("It names the wider act, because clearing a search is not clearing a filter", async () => {
      const control = canvas.getByRole("button", { name: /^Show Everything:/ });
      await expect(control).toHaveAttribute("title", 'searching "Whitfield" · 1 column filtered');
    });
  }}
>
  {#snippet template()}
    <div class="p-8">
      <ClearFilters
        grid={narrowedGrid}
        narrowing={{
          narrowed: true,
          summary: 'searching "Whitfield" · 1 column filtered',
          clear: () => {},
        }}
      />
    </div>
  {/snippet}
</Story>

<Story
  name="Load more, loading, and the end of the list"
  play={async ({ canvas, step }) => {
    await step("It says the noun, so it reads the same beside any count", async () => {
      await expect(canvas.getByRole("button", { name: "Load more entries" })).toBeEnabled();
    });
    await step("A page in flight holds the control in place and says so", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Load more entries" }));
      await expect(canvas.getByRole("button", { name: "Loading" })).toBeDisabled();
    });
    await step("The end of the list is an absence, never a disabled control", async () => {
      await expect(canvas.queryByRole("button", { name: /Load more packets/ })).toBeNull();
    });
  }}
>
  {#snippet template()}
    <div class="flex items-center gap-8 p-8">
      <LoadMore
        noun="entries"
        more={true}
        {loading}
        onLoad={() => {
          loading = true;
          loaded += 1;
        }}
      />
      <LoadMore noun="packets" more={false} onLoad={() => {}} />
    </div>
  {/snippet}
</Story>
