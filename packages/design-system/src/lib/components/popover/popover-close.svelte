<script lang="ts">
  /* Popover.Close — a close affordance the CALLER styles and places (e.g. an "Apply" or "Cancel"
     button inside the panel). Thin pass-through over Bits UI Popover.Close with NO built-in look or
     positioning, so it sits wherever the caller puts it and takes whatever classes the caller gives
     it (typically the mc-button recipes). A popover has no built-in corner dismiss — dismissal is
     outside-click, Escape, or this caller-placed Close. */
  import { Popover as PopoverPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<PopoverPrimitive.CloseProps> = $props();
</script>

<PopoverPrimitive.Close bind:ref class={mergeClasses(className)} {...restProps} />
