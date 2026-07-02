<script lang="ts">
  /* Popover.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of
     its own. Thin wrapper over Bits UI Popover.Root. `open` is bindable. */
  import { Popover as PopoverPrimitive } from "bits-ui";

  let { ...restProps }: PopoverPrimitive.RootProps = $props();
</script>

<PopoverPrimitive.Root {...restProps} />
