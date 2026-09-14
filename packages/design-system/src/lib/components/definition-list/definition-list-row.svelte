<script lang="ts">
  /*
   * DefinitionList.Row — one term and its definition.
   *
   * The definition is the children; when the row is given none, or the caller says `empty`, it
   * draws the same muted mark the table draws in an empty cell, so an empty definition reads as
   * "not known yet" rather than as a rendering gap. That is what lets a list stand with all its
   * terms and none of its values.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    term,
    empty = false,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The name of the value. Rendered as the row's `<dt>`. */
    term: string;
    /** True when the value is not known yet, whatever the children would render. */
    empty?: boolean;
    /** The value. Absent, the row shows the empty mark and states that nothing is known yet. */
    children?: Snippet;
  } = $props();

  const showingEmpty = $derived(empty || children === undefined);
</script>

<div
  bind:this={ref}
  class={mergeClasses("mc-definition-list-row", className)}
  data-empty={showingEmpty ? "true" : undefined}
  {...restProps}
>
  <dt class="mc-definition-list-term">{term}</dt>
  <dd class="mc-definition-list-definition">
    {#if !showingEmpty && children}
      {@render children()}
    {:else}
      <!-- The muted dash reads as "intentionally empty", as it does in a table's empty cell. -->
      <span class="mc-definition-list-empty-value" aria-hidden="true">—</span>
      <span class="sr-only">Not known yet</span>
    {/if}
  </dd>
</div>
