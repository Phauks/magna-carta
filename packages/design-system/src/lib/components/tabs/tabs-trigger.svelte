<script lang="ts">
  /* Tabs.Trigger — one tab (a button; `value` selects its panel). Thin wrapper over Bits UI
     Tabs.Trigger; the active/inactive/disabled look is the `mc-tabs-trigger` recipe via data-state. */
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<TabsPrimitive.TriggerProps> = $props();
</script>

<TabsPrimitive.Trigger bind:ref class={mergeClasses("mc-tabs-trigger", className)} {...restProps} />
