<script lang="ts">
  /* Sidebar.Group — a labelled cluster of menu items (the archetype's canonical grouping: Top,
     Money, Practice, Firm). Stacks its GroupLabel + Menu with a small gap. See sidebar.svelte. */
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

<div bind:this={ref} class={mergeClasses("mc-sidebar-group", className)} {...restProps}>
  {@render children?.()}
</div>
