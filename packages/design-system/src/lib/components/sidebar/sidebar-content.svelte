<script lang="ts">
  /*
   * Sidebar.Content — the scrolling middle region that holds the nav groups; takes the remaining
   * height and scrolls. Its scrollbar is HIDDEN (sidebar.css — the dark rail stays a clean plane),
   * so the scroll affordance is the edge hint: ScrollEdgeHint draws a thin rule at the
   * area's top edge once the list is scrolled below its top, and at its bottom edge while more
   * content lies below. The block axis only — a rail this narrow never scrolls sideways.
   *
   * The hint is absolutely positioned against the non-scrolling shell around the scrollport, which
   * is why that shell exists and why it is `relative`; the scrollport itself takes the height.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import ScrollEdgeHint from "../scroll-edge-hint/index.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();
</script>

<div class="relative flex min-h-0 grow flex-col">
  <div
    bind:this={ref}
    class={mergeClasses("mc-sidebar-content mc-scrollbar-hidden min-h-0 grow", className)}
    {...restProps}
  >
    {@render children?.()}
  </div>
  <ScrollEdgeHint element={ref} axis="block" />
</div>
