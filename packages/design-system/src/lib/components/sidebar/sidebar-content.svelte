<script lang="ts">
  /*
   * Sidebar.Content — the scrolling middle region that holds the nav groups; takes the
   * remaining height and scrolls. Its scrollbar is HIDDEN (sidebar.css — the dark rail stays a
   * clean plane), so the scroll affordance is the GILT EDGE HINT device: a thin gold rule draws
   * in at the area's top edge once the list is scrolled below its top, and at the bottom edge
   * while more content lies below. Reusable for any invisible-scrollbar area — this is its
   * first application.
   *
   * Visibility is component state driven by the scroll handler plus a ResizeObserver (content
   * and viewport size changes move the edges without a scroll event); the rules are absolutely
   * positioned spans on a non-scrolling shell, costing no layout. Appearing rides the gilt-draw
   * keyframes (gold never fades — it draws); disappearing is instant by unmount.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();

  let scrolledFromTop = $state(false);
  let moreBelow = $state(false);

  function updateScrollHints(): void {
    const element = ref;
    if (element === null) return;
    scrolledFromTop = element.scrollTop > 0;
    // A pixel of tolerance: fractional scroll metrics must never trap the hint on.
    moreBelow = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  }

  $effect(() => {
    const element = ref;
    if (element === null) return;
    updateScrollHints();
    const observer = new ResizeObserver(updateScrollHints);
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<div class="relative flex min-h-0 grow flex-col">
  <div
    bind:this={ref}
    class={mergeClasses("mc-sidebar-content mc-scrollbar min-h-0 grow", className)}
    {...restProps}
    onscroll={updateScrollHints}
  >
    {@render children?.()}
  </div>
  {#if scrolledFromTop}
    <span
      aria-hidden="true"
      class="mc-sidebar-scroll-hint"
      style="inset-block-start: var(--mc-space-0)"
    ></span>
  {/if}
  {#if moreBelow}
    <span
      aria-hidden="true"
      class="mc-sidebar-scroll-hint"
      style="inset-block-end: var(--mc-space-0)"
    ></span>
  {/if}
</div>
