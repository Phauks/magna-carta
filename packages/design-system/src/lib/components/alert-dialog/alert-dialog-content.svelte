<script lang="ts">
  /*
   * AlertDialog.Content — the centered modal panel, composed with its backdrop. It portals to the
   * body, renders the Overlay scrim, then the panel; inside the panel it renders ONLY the caller's
   * content. Unlike Dialog there is NO built-in corner ✕: an alert dialog is a deliberate decision
   * surface, so the user must pick Cancel or Action — there is no incidental dismiss.
   *
   * Centering vs. presence — the one subtlety. Bits' AlertDialog.Content is fixed/centered, NOT
   * Floating-UI-anchored, so the two-level wrapper rule does NOT apply: classes go straight on the
   * Content element. The centering itself is done in the CSS recipe with `position: fixed;
   * inset: 0; margin: auto; <fit-content size>` — i.e. NO centering transform. That matters because
   * the presence here is PRESENCE_SCALE_FADE, whose animation is opacity + Tailwind `scale-*` only
   * (no translate). A transform-based centre (`translate(-50%, -50%)`) would be overwritten by that
   * `scale-*` transform and the panel would jump to a corner mid-animation; with inset/margin
   * centering there is no transform to fight, so the scale-fade composes cleanly and the panel
   * stays centered throughout. The panel's width/max-height are layout, so they ride utilities on
   * the wrapper, not the token-only recipe.
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
  <AlertDialogPrimitive.Content
    bind:ref
    class={mergeClasses(
      Z_LAYER_CLASSES.modal,
      PRESENCE_SCALE_FADE,
      "mc-alert-dialog-content max-h-screen w-full max-w-lg",
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </AlertDialogPrimitive.Content>
</AlertDialogPrimitive.Portal>
