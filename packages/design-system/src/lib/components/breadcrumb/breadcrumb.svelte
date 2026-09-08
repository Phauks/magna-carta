<script lang="ts">
  /*
   * Breadcrumb — folder-path navigation (Tier 1: a native <nav>/<ol>, no Bits UI). Data-driven from an
   * `items` array, folded by the shared rule in `collapse.ts` so that every surface drawing a path
   * collapses the same way: when a path is deeper than `maxItems`, the MIDDLE collapses behind an
   * ellipsis affordance (the root and the current folder are always kept — the current folder is the
   * one the user needs to read, so it is never collapsed or truncated). Clicking the ellipsis reveals
   * the full path in place (no floating layer, no z-index).
   *
   * Accessibility: a <nav> landmark labelled "Breadcrumb", an ordered list, links for navigable
   * segments, and `aria-current="page"` on the leaf. Separators are decorative (aria-hidden). A single
   * over-long intermediate label truncates with an ellipsis so it never pushes the leaf out of view;
   * the leaf itself never shrinks or truncates.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { collapseBreadcrumb } from "./collapse.ts";
  import type { BreadcrumbEntry } from "./types.ts";

  let {
    items,
    label = "Breadcrumb",
    maxItems = 4,
    itemsBeforeCollapse = 1,
    itemsAfterCollapse = 1,
    expandLabel = "Show the collapsed folders",
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & {
    /** The path, root first, current folder last. */
    items: BreadcrumbEntry[];
    /** Accessible name for the navigation landmark. */
    label?: string;
    /** Collapse the middle once the path has more than this many segments. `0` never collapses. */
    maxItems?: number;
    /** How many leading segments to keep visible when collapsed (the root and beyond). */
    itemsBeforeCollapse?: number;
    /** How many trailing segments to keep visible when collapsed (the current folder and beyond). */
    itemsAfterCollapse?: number;
    /** Accessible name for the ellipsis button that reveals the collapsed segments. */
    expandLabel?: string;
  } = $props();

  let expanded = $state(false);

  /*
   * The fold itself is `collapseBreadcrumb` — shared with the matter file manager's path, which
   * draws the same fold as buttons and a menu. Expanding here reveals the path IN PLACE (no
   * floating layer, no z-index), which is a `maxItems` of zero: the rule that never collapses.
   */
  const parts = $derived(
    collapseBreadcrumb(items, {
      maxItems: expanded ? 0 : maxItems,
      itemsBeforeCollapse,
      itemsAfterCollapse,
    }),
  );

  const lastIndex = $derived(items.length - 1);
</script>

<nav bind:this={ref} class={mergeClasses("mc-breadcrumb", className)} aria-label={label} {...restProps}>
  <ol class="mc-breadcrumb-list">
    {#each parts as part, position (part.kind === "ellipsis" ? "ellipsis" : `item-${part.index}`)}
      {#if position > 0}
        <li class="mc-breadcrumb-separator" role="presentation" aria-hidden="true">
          <ChevronRight class="mc-breadcrumb-separator-icon" aria-hidden="true" />
        </li>
      {/if}
      <li class="mc-breadcrumb-item">
        {#if part.kind === "ellipsis"}
          <button
            type="button"
            class="mc-breadcrumb-ellipsis"
            aria-label={expandLabel}
            aria-expanded={expanded}
            onclick={() => (expanded = true)}
          >
            <Ellipsis class="mc-breadcrumb-ellipsis-icon" aria-hidden="true" />
          </button>
        {:else if part.index === lastIndex}
          <span class="mc-breadcrumb-page" aria-current="page">{part.entry.label}</span>
        {:else if part.entry.href !== undefined}
          <a class="mc-breadcrumb-link" href={part.entry.href}>{part.entry.label}</a>
        {:else}
          <span class="mc-breadcrumb-text">{part.entry.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>
