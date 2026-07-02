<script lang="ts">
  /* Dialog.Overlay — the backdrop scrim behind the panel. Thin wrapper over Bits UI Dialog.Overlay;
     the z-layer + fade presence come from the floating module (the scrim fades, it does not scale),
     the scrim colour is the mc-dialog-overlay recipe. Bits drives the fade off `data-state`. */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { Z_LAYER_CLASSES, PRESENCE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.OverlayProps> = $props();
</script>

<DialogPrimitive.Overlay
  bind:ref
  class={mergeClasses(Z_LAYER_CLASSES.overlay, PRESENCE_FADE, "mc-dialog-overlay", className)}
  {...restProps}
/>
