<script lang="ts">
  /*
   * Table row — a <tr>. Set data-state="selected" to paint the selected-row recipe, and
   * data-placeholder="true" on a row that holds no record (an empty message, a loading skeleton):
   * it keeps the row's geometry, so the frame holds its height, and gives up the hover fill and the
   * pointer cursor, which promise something to select where there is nothing.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableRowElement>, HTMLTableRowElement> = $props();
</script>

<tr bind:this={ref} class={mergeClasses("mc-table-row", className)} {...restProps}>
  {@render children?.()}
</tr>
