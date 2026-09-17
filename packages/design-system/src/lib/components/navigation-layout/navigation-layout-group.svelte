<script lang="ts">
  /*
   * NavigationLayout.Group — a foldable heading over part of the navigation column.
   *
   * ONE DISCLOSURE GRAMMAR, NOT TWO. The sidebar settled what a fold looks like in this product
   * (see sidebar/sidebar-group-trigger.svelte): the heading IS the control, it keeps its own voice
   * rather than dressing up as a button, its hit target is the whole width, and a chevron points
   * down while the thing is open and toward the inline start while it is folded. A second column
   * answering the same question differently is how a reader learns that two parts of one product
   * are two products. This part is that grammar for the canvas-register column the two-sided screen
   * draws, so the settings nav's bands and groups fold by the same rule the rail's groups do.
   *
   * THE STATE IS THE CONSUMER'S, deliberately. Nothing is remembered here: a member's folds are a
   * per-browser preference the app owns, and a part that held its own fold would be a second answer
   * to a question that store has already settled. The part takes `expanded` and reports the press.
   *
   * TWO LEVELS. `band` is the column's top level — a glyph naming whose things these are, firmer
   * ink, seated on the column's rule; `group` is a cluster inside one. The indent stagger between
   * them, and between a group and the rows it holds, is the recipe's (navigation-layout-group.css).
   *
   * FOLDED MEANS ABSENT, not hidden with the rows still under the keyboard's fingers. `aria-expanded`
   * on the heading is what a screen reader is told, and it is the only assertion made: the rows are
   * removed rather than pointed at by `aria-controls`, which would name an element that is not there.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  type Props = WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, "children">, HTMLDivElement> & {
    /** What the heading says — the name of the band or the group it heads. */
    label: string;
    /** The column's top level (`band`) or a cluster inside one (`group`). */
    level?: "band" | "group";
    /** Whether what this heads is showing. Held by the consumer, never by this part. */
    expanded: boolean;
    /** Called when the heading is pressed. The consumer decides what the press means and records it. */
    onToggle: () => void;
    /** The glyph naming whose things these are, sized by the wrapper this part draws. */
    icon?: Snippet;
    /** What folds away: the groups inside a band, or the rows inside a group. */
    children: Snippet;
  };

  let {
    ref = $bindable(null),
    label,
    level = "group",
    expanded,
    onToggle,
    icon,
    children,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<div
  bind:this={ref}
  data-level={level}
  class={mergeClasses("mc-navigation-layout-group", className)}
  {...restProps}
>
  <!-- The heading carries the field-label register unchanged — same voice, same size, same
       tracking — and the recipe beside it adds only what a control needs. -->
  <button
    type="button"
    class="mc-field-label mc-navigation-layout-group-heading w-full"
    aria-expanded={expanded}
    data-expanded={expanded ? "true" : "false"}
    onclick={onToggle}
  >
    {#if icon}
      <span class="mc-navigation-layout-group-heading-icon" aria-hidden="true">{@render icon()}</span>
    {/if}
    <span class="mc-navigation-layout-group-heading-label">{label}</span>
    <ChevronDown
      class="mc-navigation-layout-group-chevron size-12 motion-reduce:transition-none {expanded
        ? ''
        : '-rotate-90'}"
      aria-hidden="true"
    />
  </button>
  {#if expanded}
    <div class="mc-navigation-layout-group-content">
      {@render children()}
    </div>
  {/if}
</div>
