<script lang="ts">
  /*
   * Sidebar.Root — the global navigation rail (page-archetypes Layout A): a <nav> landmark that lays
   * out a header, a scrolling content region, and a pinned footer top-to-bottom. `collapsed` is
   * bindable and also drives the data-state the recipes key off (expanded width ↔ icon-rail width);
   * Root publishes it through context so the trigger and menu buttons react. The accessible name
   * defaults to "Main"; pass `aria-label` to override (e.g. a second nav on the page).
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { runViewTransition } from "../../internal/view-transition.ts";
  import { setSidebarContext } from "./context.ts";

  let {
    ref = $bindable(null),
    collapsed = $bindable(false),
    class: className,
    children,
    "aria-label": ariaLabel = "Main",
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & { collapsed?: boolean } = $props();

  // Collapse runs through a View Transition so the rail↔canvas resize is composited (no per-frame
  // reflow, no sub-pixel seam tearing); it falls back to an instant change under reduced motion or
  // where the API is unavailable. See internal/view-transition.ts and the sidebar.css note.
  setSidebarContext({
    get collapsed() {
      return collapsed;
    },
    toggle() {
      runViewTransition(() => {
        collapsed = !collapsed;
      });
    },
    setCollapsed(value) {
      runViewTransition(() => {
        collapsed = value;
      });
    },
  });
</script>

<nav
  bind:this={ref}
  data-state={collapsed ? "collapsed" : "expanded"}
  aria-label={ariaLabel}
  class={mergeClasses("mc-sidebar h-full", className)}
  {...restProps}
>
  {@render children?.()}
</nav>
