<script lang="ts">
  /* Dialog.Overlay — the backdrop scrim behind the panel. Thin wrapper over Bits UI Dialog.Overlay;
     the z-layer + fade presence come from the floating module (the scrim fades, it does not scale),
     the scrim colour is the mc-dialog-overlay recipe. Bits drives the fade off `data-state`. */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { Z_LAYER_CLASSES, PRESENCE_FADE, PRESENCE_NONE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    // The scrim either fades or does not animate at all — scale/settle make no sense on a
    // full-viewport backdrop, so the type admits only those two. Dialog.Content threads
    // PRESENCE_NONE through when its panel appears instantly: a scrim still fading in under
    // an instant panel reads as the panel lagging its own backdrop.
    presence = PRESENCE_FADE,
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.OverlayProps> & {
    presence?: typeof PRESENCE_FADE | typeof PRESENCE_NONE;
  } = $props();
</script>

<DialogPrimitive.Overlay
  bind:ref
  class={mergeClasses(Z_LAYER_CLASSES.overlay, presence, "mc-dialog-overlay", className)}
  {...restProps}
/>
