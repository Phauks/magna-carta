<script lang="ts">
  /* Sidebar.Menu — the <ul> list of nav items in a group (list semantics for screen readers). The
     recipe resets list styling and stacks items. See sidebar.svelte. */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>, HTMLUListElement> = $props();
</script>

<ul bind:this={ref} class={mergeClasses("mc-sidebar-menu", className)} {...restProps}>
  {@render children?.()}
</ul>
