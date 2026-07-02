<script lang="ts">
  /* Sidebar.Footer — the pinned bottom region (settings, profile, the collapse trigger). The
     archetype calls this a distinct region; the recipe gives it a top hairline. See sidebar.svelte. */
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

<div bind:this={ref} class={mergeClasses("mc-sidebar-footer", className)} {...restProps}>
  {@render children?.()}
</div>
