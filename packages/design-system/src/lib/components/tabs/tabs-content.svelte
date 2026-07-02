<script lang="ts">
  /* Tabs.Content — a tab panel (shown when its `value` is selected). Thin wrapper over Bits UI
     Tabs.Content; Bits handles show/hide + focus management. */
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<TabsPrimitive.ContentProps> = $props();
</script>

<TabsPrimitive.Content bind:ref class={mergeClasses("mc-tabs-content", className)} {...restProps} />
