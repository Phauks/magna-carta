<script lang="ts">
  /* Tooltip.Trigger — the element the tooltip anchors to (hover/focus). Thin wrapper over Bits UI
     Tooltip.Trigger; the flush focus ring is the mc-tooltip-trigger recipe. */
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<TooltipPrimitive.TriggerProps> = $props();
</script>

<TooltipPrimitive.Trigger
  bind:ref
  class={mergeClasses("mc-tooltip-trigger", className)}
  {...restProps}
/>
