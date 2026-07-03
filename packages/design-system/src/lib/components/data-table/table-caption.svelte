<script lang="ts">
  /* Table caption — a <caption>; the table's accessible name/summary. */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLTableCaptionElement> = $props();
</script>

<caption bind:this={ref} class={mergeClasses("mc-table-caption", className)} {...restProps}>
  {@render children?.()}
</caption>
