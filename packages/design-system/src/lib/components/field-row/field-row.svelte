<script lang="ts">
  /*
   * FieldRow — fields side by side. Two or three across from the small breakpoint up, stacked
   * below it, with the gap the panels already used (space-12). Measured before it was built: the
   * fifteen panels on the action dialog shell wrote this grid by hand sixteen times.
   *
   * It carries layout only. What goes in each column is a LabelledField, or anything else that
   * stacks; the row does not know and does not size its children beyond giving each a track.
   */
  import type { Snippet } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { fieldRowClasses, type FieldRowColumns } from "./variants.ts";

  let {
    columns = 2,
    class: className,
    children,
  }: {
    /** How many fields sit across the row above the small breakpoint. */
    columns?: FieldRowColumns;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<div class={mergeClasses(fieldRowClasses(columns), className)}>
  {@render children()}
</div>
