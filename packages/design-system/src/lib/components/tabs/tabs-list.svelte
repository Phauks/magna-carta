<script lang="ts">
  /* Tabs.List — the trigger row (the hairline track). Thin wrapper over Bits UI Tabs.List. */
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<TabsPrimitive.ListProps> = $props();
</script>

<TabsPrimitive.List bind:ref class={mergeClasses("mc-tabs-list", className)} {...restProps} />
