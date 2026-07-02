<script lang="ts">
  /*
   * Table head cell — a <th>. Defaults to scope="col" (the column-header semantic a data table wants);
   * pass `scope` to override. Set `aria-sort` when the column is sorted so assistive tech announces it.
   */
  import type { HTMLThAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    scope = "col",
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLThAttributes, HTMLTableCellElement> = $props();
</script>

<th bind:this={ref} {scope} class={mergeClasses("mc-table-head", className)} {...restProps}>
  {@render children?.()}
</th>
