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
   * the consumer's snippet decides that — so there is no `items` prop and never will be.
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
    /** The content column: the chosen thing. */
    children: Snippet;
  };

  let {
    ref = $bindable(null),
    navigationLabel,
    navigationWidth = "standard",
    contentScrolls = true,
    navigation,
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
-->
<div
  bind:this={ref}
  class={mergeClasses(
    "mc-navigation-layout mc-scrollbar -m-24 flex flex-col max-lg:overflow-y-auto lg:flex-row lg:items-start",
    className,
  )}
  style="block-size: calc(100dvh - var(--mc-size-top-bar))"
  {...restProps}
>
  <nav
    aria-label={navigationLabel}
    data-navigation-layout="navigation"
    class={mergeClasses(
      "mc-navigation-layout-navigation mc-scrollbar shrink-0 max-lg:overflow-visible lg:h-full",
      navigationWidth === "narrow" && "mc-navigation-layout-navigation-narrow",
    )}
  >
    {@render navigation()}
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
