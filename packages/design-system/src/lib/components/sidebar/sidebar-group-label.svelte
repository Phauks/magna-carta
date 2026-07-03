<script lang="ts">
  /* Sidebar.GroupLabel — the small heading above a group's items. Hidden in the collapsed icon rail
     (the recipe keys off the root's data-state). See sidebar.svelte. */
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

<div bind:this={ref} class={mergeClasses("mc-sidebar-group-label", className)} {...restProps}>
  {@render children?.()}
</div>
