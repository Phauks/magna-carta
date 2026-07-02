<script lang="ts">
  /* Masthead.Actions — the inline-end action group (Add time / Upload / New…), level with the
     title row. Page-level primary actions only; workflow controls belong to the content below. */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();
</script>

<div bind:this={ref} class={mergeClasses("mc-masthead-actions", className)} {...restProps}>
  {@render children?.()}
</div>
