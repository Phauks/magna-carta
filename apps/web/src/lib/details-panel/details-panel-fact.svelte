<script lang="ts">
  /*
   * DetailsPanel.Fact — one labelled figure: its name at the inline start, its value at the end,
   * sharing a baseline so a column of them reads as a column.
   *
   * A STRING VALUE IS THE ORDINARY CASE, and it is tabular, because most of what a details panel
   * states is a number and a ragged column of figures is harder to compare than a straight one.
   * `valueClass` dresses that string where one figure has to carry a warning the others do not — a
   * bill past its due date is the case that exists — and it keeps the tabular column, which is the
   * reason it is a class seam rather than a second markup path.
   *
   * Pass `children` instead where the value is a MARK rather than a figure: a standing badge is
   * neither tabular nor right-aligned, and dressing it as though it were would misread it as a
   * number. Passing both is a mistake the types cannot catch, so the snippet wins and the string is
   * ignored rather than rendered twice.
   */
  import { mergeClasses } from "@magna-carta/design-system/internal/merge-classes";
  import type { Snippet } from "svelte";

  let {
    label,
    value,
    title,
    valueClass,
    children,
  }: {
    /** What the figure is called. */
    label: string;
    /** The figure, already formatted by the surface's own vocabulary. */
    value?: string;
    /** A hover explanation, where the figure needs one. */
    title?: string;
    /** Extra classes on the figure, for the one that has to stand out from the column. */
    valueClass?: string;
    /** A value that is a mark rather than a figure. Wins over `value` when both are given. */
    children?: Snippet;
  } = $props();
</script>

<div class="flex items-baseline justify-between gap-16">
  <dt class="text-text-muted">{label}</dt>
  {#if children !== undefined}
    <dd {title}>{@render children()}</dd>
  {:else}
    <dd class={mergeClasses("text-right tabular-nums", valueClass)} {title}>{value}</dd>
  {/if}
</div>
