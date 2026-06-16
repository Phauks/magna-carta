<script lang="ts" generics="T">
  /*
   * VirtualList — the internal virtualization primitive: a generic wrapper over virtua's Virtualizer
   * (virtua/svelte) inside our own scroll container, so only the rows in (and near) the viewport mount
   * and a list of thousands keeps a bounded DOM. The container scrolls (overflow-y) and the caller
   * sizes it — pass a `max-height` (style/class) so it FITS its content when there are few rows and
   * caps + scrolls + virtualizes when there are many. (A plain `height` would leave empty space below
   * a short list.) Roles and styling come from whatever the `item` snippet renders (e.g.
   * Combobox.Item). Used past ~200 rows; below that a plain list is simpler.
   *
   * `getKey` should be specified whenever items have a stable id (virtua keys by index otherwise).
   */
  import { Virtualizer } from "virtua/svelte";
  import type { Snippet } from "svelte";
  import { mergeClasses } from "./merge-classes.ts";

  type Props = {
    /** The full data set; virtua renders only the visible window. */
    items: readonly T[];
    /** Renders one row. Receives the item and its index in `items`. */
    item: Snippet<[item: T, index: number]>;
    /** Stable key per item — strongly recommended for correct reuse while scrolling. */
    getKey?: (item: T, index: number) => string | number;
    /** Item-size hint in pixels; helps virtua reduce scroll jump before rows are measured. */
    itemSize?: number;
    class?: string;
    /** Inline style on the scroll container — typically a bounded `max-height` so it caps + scrolls. */
    style?: string;
  };

  let { items, item, getKey, itemSize, class: className, style }: Props = $props();
</script>

<!-- Virtualizer scrolls within this element (its direct parent), so the container owns overflow. -->
<div class={mergeClasses("overflow-y-auto", className)} {style}>
  <Virtualizer data={items} {getKey} {itemSize}>
    {#snippet children(entry, index)}
      {@render item(entry, index)}
    {/snippet}
  </Virtualizer>
</div>
