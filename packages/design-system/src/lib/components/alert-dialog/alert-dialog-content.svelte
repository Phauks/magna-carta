<script lang="ts">
  /*
   * AlertDialog.Content — the centered modal panel, composed with its backdrop. It portals to the
   * body, renders the Overlay scrim, then the panel; inside the panel it renders ONLY the caller's
   * content. Unlike Dialog there is NO built-in corner ✕: an alert dialog is a deliberate decision
   * surface, so the user must pick Cancel or Action — there is no incidental dismiss.
   *
   * Centering vs. presence — the one subtlety. Bits' AlertDialog.Content is fixed/centered, NOT
   * Floating-UI-anchored, so the two-level wrapper rule does NOT apply: classes go straight on the
   * Content element. The centering is done by the STAGE the panel renders inside — a fixed box
   * pulled in from the screen's edges by size.modal-gutter that centres its one flex item
   * (styles/recipes/modal-stage.css) — i.e. NO centering transform. That matters because the
   * presence here is PRESENCE_SCALE_FADE, whose animation is opacity + Tailwind `scale-*` only (no
   * translate). A transform-based centre (`translate(-50%, -50%)`) would be overwritten by that
   * `scale-*` transform and the panel would jump to a corner mid-animation; with flex centering
   * there is no transform to fight, so the scale-fade composes cleanly and the panel stays
   * centered throughout. The stage is also the panel's cap: a column flex item shrinks to its
   * container, so a panel taller than the screen less its gutter scrolls inside that box rather
   * than running edge to edge, and no height utility is needed. The panel's width is layout, so it
   * rides utilities on the wrapper, not the token-only recipe.
   */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { Z_LAYER_CLASSES, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
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
  <!-- The stage carries the modal z-layer, not only the panel: a fixed box is a stacking context
       of its own, so a z-index on the panel alone would leave it beneath the scrim. -->
  <div class={mergeClasses(Z_LAYER_CLASSES.modal, "mc-modal-stage")}>
    <AlertDialogPrimitive.Content
      bind:ref
      class={mergeClasses(PRESENCE_SCALE_FADE, "mc-alert-dialog-content w-full max-w-lg", className)}
      {...restProps}
    >
      {@render children?.()}
    </AlertDialogPrimitive.Content>
  </div>
</AlertDialogPrimitive.Portal>
