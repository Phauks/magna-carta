<script lang="ts">
  /* Sidebar.Content — the scrolling middle region that holds the nav groups; takes the remaining
     height (grow utility) and scrolls with the tokenised scrollbar. See sidebar.svelte. */
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

<div
  bind:this={ref}
  class={mergeClasses("mc-sidebar-content mc-scrollbar grow", className)}
  {...restProps}
>
  {@render children?.()}
</div>
