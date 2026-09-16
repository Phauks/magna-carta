<script lang="ts">
  /*
   * Sidebar.MenuSub — the rows beneath a MenuTrigger.
   *
   * A nested <ul>, so the nesting a reader sees is the nesting a screen reader hears. It is inset
   * from its parent row and carries a hairline down its start edge: the indent alone reads as a
   * slightly ragged list once two clusters sit near each other, and the line is what makes "these
   * belong to the row above" legible at a glance rather than by measurement.
   */
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

<ul bind:this={ref} class={mergeClasses("mc-sidebar-menu mc-sidebar-menu-sub", className)} {...restProps}>
  {@render children?.()}
</ul>
