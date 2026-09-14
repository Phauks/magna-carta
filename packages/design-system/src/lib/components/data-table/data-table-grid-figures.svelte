<script lang="ts" generics="TRow">
  /*
   * DataTable.GridFigures — the labelled figures a table's footer ends with, and the one place their
   * shape is decided.
   *
   * THE LABEL LEADS AND THE FIGURE FOLLOWS, on every table. Five surfaces built this strip by hand
   * and one of them had already drifted into the opposite order, which is what a shared strip is for:
   * a reader who has learned to find the number after the word does not relearn it per screen.
   *
   * THE FIGURE ARRIVES AS TEXT. Money, durations and counts each format through their own home, and a
   * strip that took minor units and a currency would have to learn all three. What it owns is the
   * arrangement: the order, the separators, the tabular figures, and the sentence under a filter.
   *
   * UNDER A FILTER IT SAYS SO FIRST. "In view:" is not decoration — a total that silently changed
   * meaning when a column was filtered is the most quietly wrong thing a footer can do.
   *
   * AND IT SAYS SO ONLY OF THE FIGURES THAT NARROW. A figure over the whole record — a server-side
   * count of what is waiting, a total the loaded rows do not add up to — stands before the "In view:"
   * sentence, in its own group, whatever the filter does. Placing it after the sentence would claim
   * the filter narrowed it; placing it differently filtered and unfiltered would move it under the
   * reader's eye. So the two groups keep their places: whole-record figures first, rows-in-view
   * figures second, and the sentence appears between them only while a filter is in play.
   */
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";
  import type { GridFigure } from "./grid-figures.ts";

  let {
    grid,
    figures,
    class: className,
  }: {
    grid: DataTableGridState<TRow>;
    figures: readonly GridFigure[];
    class?: string;
  } = $props();

  const wholeRecord = $derived(figures.filter((figure) => figure.scope === "whole-record"));
  const rowsInView = $derived(figures.filter((figure) => figure.scope !== "whole-record"));
</script>

{#snippet figureItem(figure: GridFigure)}
  <span
    class="inline-flex items-baseline gap-4"
    title={figure.caption}
    data-figure-scope={figure.scope ?? "rows-in-view"}
  >
    <span class="text-text-subtle">{figure.label}</span>
    <span class="font-semibold tabular-nums">{figure.value}</span>
  </span>
{/snippet}

<span class={mergeClasses("inline-flex items-baseline gap-8", className)} data-grid-figures>
  {#each wholeRecord as figure, index (figure.identifier)}
    {#if index > 0}<span aria-hidden="true">·</span>{/if}
    {@render figureItem(figure)}
  {/each}
  {#if rowsInView.length > 0}
    {#if wholeRecord.length > 0}<span aria-hidden="true">·</span>{/if}
    {#if grid.isFiltered}
      <span class="text-text-link" title="Figures over the rows in view only">In view:</span>
    {/if}
    {#each rowsInView as figure, index (figure.identifier)}
      {#if index > 0}<span aria-hidden="true">·</span>{/if}
      {@render figureItem(figure)}
    {/each}
  {/if}
</span>
