<script lang="ts">
  /* Table cell — a <td>. See table.svelte for the part-family rationale. */
  import type { HTMLTdAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLTdAttributes, HTMLTableCellElement> = $props();
</script>

<td bind:this={ref} class={mergeClasses("mc-table-cell", className)} {...restProps}>
  {@render children?.()}
</td>
