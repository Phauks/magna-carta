<script lang="ts">
  /* Sidebar.MenuItem — one <li> in the menu, wrapping a MenuButton. See sidebar.svelte. */
  import type { HTMLLiAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLLiAttributes, HTMLLIElement> = $props();
</script>

<li bind:this={ref} class={mergeClasses("mc-sidebar-menu-item", className)} {...restProps}>
  {@render children?.()}
</li>
