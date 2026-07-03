<script lang="ts">
  /* AlertDialog.Overlay — the backdrop scrim behind the panel. Thin wrapper over Bits UI
     AlertDialog.Overlay; the z-layer + fade presence come from the floating module (the scrim fades,
     it does not scale), the scrim colour is the mc-alert-dialog-overlay recipe. Bits drives the fade
     off `data-state`. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { Z_LAYER_CLASSES, PRESENCE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.OverlayProps> = $props();
</script>

<AlertDialogPrimitive.Overlay
  bind:ref
  class={mergeClasses(Z_LAYER_CLASSES.overlay, PRESENCE_FADE, "mc-alert-dialog-overlay", className)}
  {...restProps}
/>
