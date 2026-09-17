<script lang="ts">
  /*
   * NavigationLayout — Tier 2 (native elements, no Bits UI). The one shape for a screen whose main
   * canvas has two sides: a navigational column on the inline-start side and the chosen thing's
   * content beside it. Settings (grouped bands of section links), Magnus (a sort control over
   * conversation rows), and any list-of-things-left / chosen-thing-right screen (Tools, Reports)
   * compose it. Two of those had each drawn the arrangement by hand — two widths, two scroll
   * treatments, for one shape — which is how a reader learns that two screens are two products.
   *
   * What the component owns, and all it owns: the `<nav>` landmark and its accessible name, the
   * column's width (two token-derived measures), the two independent scroll regions with the
   * house scrollbar and a RESERVED gutter (a scrollbar arriving must never shift the content
   * beside it), and the canvas geometry. It imposes NO structure on what the navigation holds —
   * the consumer's snippet decides that — so there is no `items` prop and never will be. The two
   * parts beside it, `Row` and `Group`, are OFFERED for what a column draws again and again: one
   * choice, and a heading that folds what it holds. Taking either is a choice, never a requirement.
   *
   * Canvas geometry (owner-directed on the settings surface, kept here so no consumer repeats it):
   * the two columns reach the canvas's TRUE edges. The app shell pads its work canvas by
   * space-24 and that frame around two scroll areas read as a border and wasted width, so the
   * layout swallows the canvas inset with a negative margin of the same token step and moves the
   * breathing room INSIDE each scroll region, where a scrollbar then sits at the actual edge. It
   * takes the full height under the top bar, so the canvas itself never scrolls on such a route;
   * the two columns do. A screen that renders this beneath a masthead of its own is not this
   * shape yet — say so rather than fighting the height.
   *
   * Widths. Both derive from the popover measure the settings nav was already sized to: the
   * navigation's content box is `size.popover` wide, and the gutter each side of it is what
   * differs — `standard` (space-24 each side, the settings width) and `narrow` (space-16 each
   * side, which lands on the global sidebar's own width). Content-box sizing is what lets the
   * recipe say this with two tokens and no arithmetic.
   *
   * The content column is the page's scroll region by default, carrying the canvas gutter inside
   * it. A page that stages its own header, scrolling middle and pinned footer passes
   * `contentScrolls={false}`: the column is then a bare full-height flex stack and the page owns
   * its scroller — otherwise its middle would draw a second scrollbar inside a column that had
   * already reserved a gutter for one. A scroll region a keyboard can reach is one that holds
   * something focusable, and every product page does (an action, a link, a field) — the same
   * property the app shell's own canvas relies on. The layout adds no tab stop of its own, since
   * that would put one before every page's first control; a page of pure prose is the one case
   * that must bring a control, and axe's scrollable-region-focusable rule is what says so.
   *
   * A screen's TITLE can span both columns (`header`), and the navigation column can PIN something
   * beneath its scroll region (`navigationFooter`). Both are optional and both exist because the
   * calendar asked for them, but neither is calendar-specific: a title that sits over the whole
   * canvas rather than over one column of it is the arrangement any two-sided screen wants once its
   * title names the screen instead of the chosen thing, and a navigation whose last element must
   * stay in view while its list scrolls is the shape of every rail with a picker under it. Giving
   * neither leaves the DOM exactly as it was for the screens that compose this today.
   *
   * The header lives INSIDE the cancelled canvas inset, so it puts the gutter back itself; the
   * columns then take what height is left rather than the full viewport. `navigationFooter` moves
   * the scroll region and its reserved gutter off the `<nav>` and onto an inner stack, because a
   * pinned footer cannot sit inside the thing that scrolls past it — the landmark stays the `<nav>`
   * either way, so what a screen reader announces does not change.
   *
   * Narrow viewports: nothing in the design language decides a breakpoint, so below the `lg`
   * viewport the navigation stacks ABOVE the content at its natural height and the whole layout
   * scrolls as one — a navigation pinned on top would eat the viewport on a long nav, and a
   * column beside content narrower than a form is neither. The choice is recorded in this
   * package's CLAUDE.md.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { NavigationWidth } from "./navigation-width.ts";

  type Props = WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, "children">, HTMLDivElement> & {
    /** The accessible name of the navigation landmark — what this column lets a person choose between ("Settings sections", "Conversations", "Tools"). */
    navigationLabel: string;
    /** How wide the navigation column is: `standard` is the settings width; `narrow` lands on the global sidebar's own width. */
    navigationWidth?: NavigationWidth;
    /** Whether the content column is the page's scroll region (the default). A page that stages its own header, scrolling middle and pinned footer passes false and owns its scroller. */
    contentScrolls?: boolean;
    /** What the navigation column holds. The layout imposes no structure on it — grouped links, a control over rows, a plain list are all the consumer's to draw. */
    navigation: Snippet;
    /** A band ABOVE both columns, for a title that names the screen rather than the chosen thing. Omit it and the columns start at the canvas's top edge, as they always have. */
    header?: Snippet;
    /** Pinned beneath the navigation column, outside its scroll region — a month picker under a rail of calendars. Omit it and the `<nav>` is the scroll region itself. */
    navigationFooter?: Snippet;
    /** The content column: the chosen thing. */
    children: Snippet;
  };

  let {
    ref = $bindable(null),
    navigationLabel,
    navigationWidth = "standard",
    contentScrolls = true,
    navigation,
    header,
    navigationFooter,
    children,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<!--
  Below the lg viewport the root is the one scroll region (the columns stack and stop scrolling on
  their own); at lg and up the columns scroll independently and the root never does. The full
  height under the top bar is an inline calc of two tokens — a length the spacing scale cannot
  name — and the negative margin is the canvas's own padding step, cancelled.

  The max-block-size beside it is what keeps that calc from OVERSHOOTING, and it is the difference
  between one scrollbar and two. The calc is a guess at how tall the canvas is: it is right only
  while the chrome above measures exactly the top-bar token and while the viewport's `dvh` agrees
  with the height the shell was given. When either drifts — chrome that grows by a hairline, a
  browser whose dynamic toolbar moves `dvh` under a shell sized in `vh` — the layout stands a few
  pixels taller than the canvas it sits in, and the canvas (which is itself a scroll region) grows a
  scrollbar beside the two this component already draws.

  It is NOT a plain 100%, and the difference is the cancelled inset. A percentage resolves against
  the canvas's CONTENT box, which is already short by the inset this layout swallows; capping there
  would pull the columns up by that inset and leave a band of bare canvas under them. What the cap
  has to bound is the MARGIN box, so it is the content box plus the two inset steps the negative
  margin gives back — which is exactly the height the calc is aiming at, arrived at from the canvas
  rather than from the viewport. Where the parent has no definite height (a catalog story's box) the
  percentage cannot resolve, the max-block-size behaves as `none`, and the calc stands alone.
-->
<div
  bind:this={ref}
  class={mergeClasses(
    "mc-navigation-layout mc-scrollbar -m-24 flex flex-col max-lg:overflow-y-auto",
    className,
  )}
  style="block-size: calc(100dvh - var(--mc-size-top-bar)); max-block-size: calc(100% + var(--mc-space-48))"
  {...restProps}
>
  {#if header}
    <!-- The spanning band. It sits inside the cancelled inset, so it puts the canvas gutter back
         itself and stops short of the bottom, where the columns take over. -->
    <div data-navigation-layout="header" class="shrink-0 px-24 pt-24">
      {@render header()}
    </div>
  {/if}
  <!--
    The two columns. This wrapper is what a header made necessary — the root used to be the row
    itself — and it is rendered whether or not there is a header so there is one arrangement rather
    than two that can drift. `min-h-0` is what lets the columns scroll inside a flex parent.
  -->
  <div class="flex min-h-0 flex-1 flex-col max-lg:overflow-visible lg:flex-row lg:items-start">
    <nav
      aria-label={navigationLabel}
      data-navigation-layout="navigation"
      class={mergeClasses(
        "shrink-0 max-lg:overflow-visible lg:h-full",
        // With a pinned footer the <nav> is a stack and the INNER div scrolls; without one the
        // <nav> is the scroll region, exactly as it was.
        navigationFooter ? "flex flex-col" : "mc-navigation-layout-navigation mc-scrollbar",
        navigationWidth === "narrow" && !navigationFooter && "mc-navigation-layout-navigation-narrow",
      )}
    >
      {#if navigationFooter}
        <div
          class={mergeClasses(
            "mc-navigation-layout-navigation mc-scrollbar min-h-0 flex-1 max-lg:overflow-visible",
            navigationWidth === "narrow" && "mc-navigation-layout-navigation-narrow",
          )}
        >
          {@render navigation()}
        </div>
        <!-- Pinned: it keeps the column's own gutter but never its scroll. -->
        <div data-navigation-layout="navigation-footer" class="shrink-0 px-24 pb-24">
          {@render navigationFooter()}
        </div>
      {:else}
        {@render navigation()}
      {/if}
    </nav>
    <div
      data-navigation-layout="content"
      class={mergeClasses(
        "mc-navigation-layout-content mc-scrollbar flex min-w-0 grow flex-col max-lg:overflow-visible lg:h-full",
        contentScrolls && "mc-navigation-layout-content-scrolling",
      )}
    >
      {@render children()}
    </div>
  </div>
</div>
