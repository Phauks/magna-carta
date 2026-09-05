<script lang="ts">
  /*
   * AlertDialog.Content — the centered modal panel, composed with its backdrop. It portals to the
   * body, renders the Overlay scrim, then the panel; inside the panel it renders ONLY the caller's
   * content. Unlike Dialog there is NO built-in corner ✕: an alert dialog is a deliberate decision
   * surface, so the user must pick Cancel or Action — there is no incidental dismiss.
   *
   * Where the panel sits is not this file's: it renders inside ModalStage (internal/modal-stage.svelte)
   * and carries `mc-modal-panel`, and the stage recipe (styles/recipes/modal-stage.css) centres it
   * in the screen less its gutter and caps it there — by flex, never by a centering transform,
   * which matters because the presence here is PRESENCE_SCALE_FADE, a Tailwind `scale-*` transform
   * that would overwrite a `translate(-50%, -50%)` and send the panel to a corner mid-animation. A
   * question is always centred, so there is no `placement` prop here; the panel still stamps its
   * placement so every modal panel in the DOM says where it sits. The panel's width is layout, so
   * it rides utilities on the wrapper, not the token-only recipe; its height needs no utility,
   * because the stage is the cap. Bits' AlertDialog.Content is NOT Floating-UI-anchored, so the
   * two-level wrapper rule does NOT apply: classes go straight on the Content element.
   */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    DEFAULT_MODAL_PLACEMENT,
    MODAL_PLACEMENT_ATTRIBUTE,
  } from "../../internal/modal-placement.ts";
  import ModalStage from "../../internal/modal-stage.svelte";
  import { PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import AlertDialogOverlay from "./alert-dialog-overlay.svelte";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.ContentProps> = $props();
</script>

<AlertDialogPrimitive.Portal>
  <AlertDialogOverlay />
  <ModalStage>
    <AlertDialogPrimitive.Content
      bind:ref
      class={mergeClasses(
        PRESENCE_SCALE_FADE,
        "mc-modal-panel mc-alert-dialog-content w-full max-w-lg",
        className,
      )}
      {...{ [MODAL_PLACEMENT_ATTRIBUTE]: DEFAULT_MODAL_PLACEMENT }}
      {...restProps}
    >
      {@render children?.()}
    </AlertDialogPrimitive.Content>
  </ModalStage>
</AlertDialogPrimitive.Portal>
