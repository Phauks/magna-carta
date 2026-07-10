<script module lang="ts">
  /** One node in a breadcrumb path. The last entry is the current page; give the others an `href`
   * to make them navigable links (an entry without one renders as inert text). */
  export type BreadcrumbEntry = {
    /** The visible label for this path segment. */
    label: string;
    /** Where the segment links to. Omit for the current page (the last entry) or an inert node. */
    href?: string;
  };
</script>

<script lang="ts">
  /*
   * Breadcrumb — folder-path navigation (Tier 1: a native <nav>/<ol>, no Bits UI). Data-driven from an
   * `items` array so the graceful-collapse logic lives in ONE place: when a path is deeper than
   * `maxItems`, the MIDDLE collapses behind an ellipsis affordance (the root and the current folder are
   * always kept — the current folder is the one the user needs to read, so it is never collapsed or
   * truncated). Clicking the ellipsis reveals the full path in place (no floating layer, no z-index).
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

  const before = $derived(Math.max(0, itemsBeforeCollapse));
  const after = $derived(Math.max(0, itemsAfterCollapse));

  const collapsed = $derived(
    !expanded && maxItems > 0 && items.length > maxItems && before + after < items.length,
  );

  type Part =
    | { kind: "item"; entry: BreadcrumbEntry; index: number }
    | { kind: "ellipsis"; hiddenCount: number };

  const parts = $derived.by<Part[]>(() => {
    if (!collapsed) {
      return items.map((entry, index) => ({ kind: "item", entry, index }));
    }
    const leading: Part[] = items
      .slice(0, before)
      .map((entry, index) => ({ kind: "item", entry, index }));
    const trailing: Part[] = items
      .slice(items.length - after)
      .map((entry, offset) => ({ kind: "item", entry, index: items.length - after + offset }));
    return [...leading, { kind: "ellipsis", hiddenCount: items.length - before - after }, ...trailing];
  });

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
