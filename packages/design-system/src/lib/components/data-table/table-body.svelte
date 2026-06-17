<script lang="ts">
  /* Table body — the <tbody> section. See table.svelte for the part-family rationale. */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableSectionElement>, HTMLTableSectionElement> = $props();
</script>

<tbody bind:this={ref} class={mergeClasses("mc-table-body", className)} {...restProps}>
  {@render children?.()}
</tbody>
