<script lang="ts">
  /* Popover.Trigger — the button that opens the popover. Thin pass-through over Bits UI
     Popover.Trigger with NO built-in look, so the caller styles it (typically an mc-button variant)
     without a default recipe fighting their chosen background/border. Unlike a tooltip's quiet
     trigger, a popover is opened by a deliberate button. */
  import { Popover as PopoverPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<PopoverPrimitive.TriggerProps> = $props();
</script>

<PopoverPrimitive.Trigger bind:ref class={mergeClasses(className)} {...restProps} />
