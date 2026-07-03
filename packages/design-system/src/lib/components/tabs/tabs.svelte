<script lang="ts">
  /*
   * Tabs (Tier 2 exemplar) — the styled wrapper over Bits UI Tabs.Root, and the loop EVERY Tier 2+
   * component copies: one thin wrapper per part, behaviour + accessibility from Bits, styling from
   * the `mc-tabs*` recipes keyed off Bits' `data-state`/`data-disabled` attributes. `ref` is the
   * Bits bindable element ref; `children` and the rest flow through the spread.
   */
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<TabsPrimitive.RootProps> = $props();
</script>

<TabsPrimitive.Root bind:ref class={mergeClasses("mc-tabs", className)} {...restProps} />
