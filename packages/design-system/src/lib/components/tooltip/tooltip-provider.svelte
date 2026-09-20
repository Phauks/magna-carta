<script lang="ts">
  /* Tooltip.Provider — shared open/close delay and skip-delay state for every Tooltip.Root beneath.
     Place once near the app root; the Storybook stories wrap their own.

     A TOOLTIP OPENS ON HOVER AND ON KEYBOARD FOCUS, NEVER ON A FOCUS THE POINTER CAUSED. The
     header's bell and download tray share one button between a tooltip and a popover; closing the
     popover by pressing that button again hands focus back to it, and the primitive's default
     treats that as a reason to show the tooltip — which then stood until something else was
     pressed (owner, 2026-09-18: "when I click an item in the header and then click to close it,
     the hover text will still appear until I click out of it"). The primitive's own answer is
     `ignoreNonKeyboardFocus`: a focus that is not focus-visible opens nothing. Set here, once, so
     every tooltip behaves the same; a Root may still say otherwise. */
  import { Tooltip as TooltipPrimitive } from "bits-ui";

  let { ignoreNonKeyboardFocus = true, ...restProps }: TooltipPrimitive.ProviderProps = $props();
</script>

<TooltipPrimitive.Provider {ignoreNonKeyboardFocus} {...restProps} />
