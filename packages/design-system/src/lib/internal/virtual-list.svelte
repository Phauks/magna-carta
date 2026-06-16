<script lang="ts" generics="T">
  /*
   * VirtualList — the internal virtualization primitive: a thin generic wrapper over virtua's VList
   * (virtua/svelte) that mounts only the rows in (and near) the viewport, so a list of thousands keeps
   * a bounded DOM. The list itself carries no design — it is a scroll container the caller sizes (a
   * height utility/style); roles and styling come from whatever the `item` snippet renders inside it
   * (e.g. Combobox.Item). Used past ~200 rows; below that a plain list is simpler.
   *
   * `getKey` should be specified whenever items have a stable id (virtua keys by index otherwise).
   */
  import { VList } from "virtua/svelte";
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
    /** Inline style on the scroll container — typically a bounded height so virtua can virtualize. */
    style?: string;
  };

  let { items, item, getKey, itemSize, class: className, style }: Props = $props();
</script>

<VList data={items} {getKey} {itemSize} class={mergeClasses(className)} {style}>
  {#snippet children(entry, index)}
    {@render item(entry, index)}
  {/snippet}
</VList>
