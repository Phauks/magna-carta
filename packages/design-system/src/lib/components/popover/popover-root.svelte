<script lang="ts">
  /* Popover.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of
     its own. Thin wrapper over Bits UI Popover.Root. `open` is declared bindable and FORWARDED —
     a spread alone does not forward a two-way bind in Svelte 5, so a controlled popover would
     silently fail without the `$bindable`. */
  import { Popover as PopoverPrimitive } from "bits-ui";

  let { open = $bindable(false), ...restProps }: PopoverPrimitive.RootProps = $props();
</script>

<PopoverPrimitive.Root bind:open {...restProps} />
