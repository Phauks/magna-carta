<script lang="ts">
  /*
   * Sidebar.Root — the global navigation rail (page-archetypes Layout A): a <nav> landmark that lays
   * out a header, a scrolling content region, and a pinned footer top-to-bottom. `collapsed` is
   * bindable and also drives the data-state the recipes key off (expanded width ↔ icon-rail width);
   * Root publishes it through context so the trigger and menu buttons react. The accessible name
   * defaults to "Main"; pass `aria-label` to override (e.g. a second nav on the page).
   *
   * THE PANEL WRAPPER: the header/content/footer live inside `.mc-sidebar-panel`, a full-size flex
   * column that normally fills the rail. It exists so the HOVER PEEK can float open WITHOUT reflow:
   * when a collapsed rail is peeked, the nav keeps its icon-rail width in flow (the canvas never
   * shifts) while the panel lifts to `position: absolute` at the expanded width, elevated over the
   * canvas. See the peek + panel rules in sidebar.css.
   *
   * `editing` widens the rail to a comfortable arranging width and forces it expanded — the shell's
   * Customize mode. `expandOnHover` opts the rail into the peek; the peek only fires while the rail
   * rests collapsed and is not editing.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { runViewTransition } from "../../internal/view-transition.ts";
  import { setSidebarContext } from "./context.ts";

  let {
    ref = $bindable(null),
    collapsed = $bindable(false),
    peeking = $bindable(false),
    editing = false,
    expandOnHover = false,
    class: className,
    children,
    "aria-label": ariaLabel = "Main",
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & {
    collapsed?: boolean;
    /** Whether the collapsed rail is currently hover-peeked open — component-owned, exposed as
        bindable for consumers that want to react to it. */
    peeking?: boolean;
    /** Customize mode: the rail widens and stays expanded for arranging. */
    editing?: boolean;
    /** Opt into the hover peek: a collapsed rail floats open on pointer-over. */
    expandOnHover?: boolean;
  } = $props();

  // The peek is component-owned UI state, not a persisted preference (the shell owns the
  // preference and passes `expandOnHover`). It floats the collapsed rail open on hover and closes
  // it a short beat after the pointer leaves, so a brush past the edge does not slam it shut.
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  // The linger before a peeked rail folds back — long enough that crossing a small gap (into a
  // tooltip, back onto the panel) does not collapse it, short enough to feel responsive.
  const PEEK_CLOSE_DELAY_MS = 350;

  const canPeek = $derived(expandOnHover && collapsed && !editing);

  function openPeek(): void {
    if (!canPeek) return;
    clearTimeout(closeTimer);
    peeking = true;
  }

  function closePeekSoon(): void {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      peeking = false;
    }, PEEK_CLOSE_DELAY_MS);
  }

  // Any state change that ends the peek's precondition drops it at once (expanding manually,
  // entering Customize, or turning the preference off mid-peek).
  $effect(() => {
    if (!canPeek && peeking) {
      clearTimeout(closeTimer);
      peeking = false;
    }
  });

  $effect(() => () => clearTimeout(closeTimer));

  // Collapse runs through a View Transition so the rail↔canvas resize is composited (no per-frame
  // reflow, no sub-pixel seam tearing); it falls back to an instant change under reduced motion or
  // where the API is unavailable. See internal/view-transition.ts and the sidebar.css note.
  // The direction marker lets animations.css stack the snapshots per direction: collapsing keeps
  // the OLD wide rail on top (labels stay whole until the seam sweeps past them); expanding keeps
  // the default new-on-top (labels arrive with the widening surface).
  setSidebarContext({
    get collapsed() {
      return collapsed;
    },
    get peeking() {
      return peeking;
    },
    toggle() {
      runViewTransition(
        () => {
          collapsed = !collapsed;
        },
        collapsed ? "sidebar-expand" : "sidebar-collapse",
      );
    },
    setCollapsed(value) {
      runViewTransition(
        () => {
          collapsed = value;
        },
        value ? "sidebar-collapse" : "sidebar-expand",
      );
    },
  });
</script>

<!-- The peek handlers ride the <nav> (a landmark, so no bare-element a11y role is needed). The
     floated panel is a DESCENDANT of the nav, so moving the pointer onto it — even where it
     overflows past the rail's in-flow box, over the canvas — never triggers the nav's
     pointerleave; only leaving the whole subtree does, which is exactly when the peek should
     fold back. -->
<nav
  bind:this={ref}
  data-state={collapsed ? "collapsed" : "expanded"}
  data-editing={editing ? "true" : undefined}
  data-peek={peeking ? "true" : undefined}
  aria-label={ariaLabel}
  class={mergeClasses("mc-sidebar h-full", className)}
  onpointerenter={openPeek}
  onpointerleave={closePeekSoon}
  {...restProps}
>
  <!-- The floatable panel: fills the rail normally; lifts to an absolute overlay while peeking so
       the canvas never reflows (the nav keeps its in-flow rail width; only the panel moves). -->
  <div class="mc-sidebar-panel">
    {@render children?.()}
  </div>
</nav>
