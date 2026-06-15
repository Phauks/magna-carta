<script lang="ts">
  /*
   * Sheet.Content — the edge-pinned drawer panel, composed with its backdrop. A Sheet is a Dialog
   * variant: it portals to the body, renders the Overlay scrim, then the panel, and inside the
   * panel renders the caller's content followed by a default top-right Close button (the Lucide X,
   * deep-imported) — a drawer needs an obvious dismiss, exactly like Dialog.
   *
   * Edge-pin vs. presence — the one subtlety. Unlike Dialog (centered, scale-fade), the Sheet panel
   * is fixed to a screen EDGE and slides in from that edge. The `side` prop selects BOTH halves of
   * that pairing through one typed lookup: side → the edge-pinning recipe class (mc-sheet-content-
   * <side>) and side → the matching directional slide presence. A right/left sheet is full height
   * (a vertical edge); a top/bottom sheet is full width (a horizontal edge). The panel's
   * width/height are layout, so they ride utilities on the element (like Dialog's `max-w-lg`), not
   * the token-only recipe. The slide is a Tailwind translate transform with no centering transform
   * to fight, so it composes cleanly.
   */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import X from "@lucide/svelte/icons/x";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    Z_LAYER_CLASSES,
    PRESENCE_SLIDE_FROM_TOP,
    PRESENCE_SLIDE_FROM_BOTTOM,
    PRESENCE_SLIDE_FROM_LEFT,
    PRESENCE_SLIDE_FROM_RIGHT,
  } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import SheetOverlay from "./sheet-overlay.svelte";

  export type SheetSide = "top" | "right" | "bottom" | "left";

  /*
   * side → directional slide presence. Plain typed Record (the house variant pattern — see
   * button/variants.ts): the surface is a small closed union, so a record lookup is clearer and
   * fully type-checked. A right-edge panel slides in from the right, and so on.
   */
  const SIDE_PRESENCE: Record<SheetSide, string> = {
    top: PRESENCE_SLIDE_FROM_TOP,
    right: PRESENCE_SLIDE_FROM_RIGHT,
    bottom: PRESENCE_SLIDE_FROM_BOTTOM,
    left: PRESENCE_SLIDE_FROM_LEFT,
  };

  /* side → edge-pinning recipe class. */
  const SIDE_CLASS: Record<SheetSide, string> = {
    top: "mc-sheet-content-top",
    right: "mc-sheet-content-right",
    bottom: "mc-sheet-content-bottom",
    left: "mc-sheet-content-left",
  };

  /* Width (right/left) or height (top/bottom) is layout, set by a utility here, not the recipe. */
  const SIDE_SIZE: Record<SheetSide, string> = {
    top: "h-fit max-h-screen",
    right: "w-full max-w-sm",
    bottom: "h-fit max-h-screen",
    left: "w-full max-w-sm",
  };

  let {
    ref = $bindable(null),
    class: className,
    side = "right",
    children,
    ...restProps
  }: WithoutChild<DialogPrimitive.ContentProps> & { side?: SheetSide } = $props();
</script>

<DialogPrimitive.Portal>
  <SheetOverlay />
  <DialogPrimitive.Content
    bind:ref
    class={mergeClasses(
      Z_LAYER_CLASSES.modal,
      SIDE_PRESENCE[side],
      "mc-sheet-content",
      SIDE_CLASS[side],
      SIDE_SIZE[side],
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
    <DialogPrimitive.Close class="mc-sheet-close" aria-label="Close">
      <X class="mc-sheet-close-icon" aria-hidden="true" />
    </DialogPrimitive.Close>
  </DialogPrimitive.Content>
</DialogPrimitive.Portal>
