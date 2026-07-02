<script lang="ts">
  /* Table row — a <tr>. Set data-state="selected" to paint the selected-row recipe. */
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
