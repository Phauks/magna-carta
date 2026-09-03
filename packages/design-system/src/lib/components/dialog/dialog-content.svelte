<script lang="ts">
  /*
   * Dialog.Content — the centered modal panel, composed with its backdrop. It portals to the body,
   * renders the Overlay scrim, then the panel; inside the panel it renders the caller's content
   * followed by a default top-right Close button (the Lucide X, deep-imported) when showClose is set
   * (the default).
   *
   * Centering vs. presence — the one subtlety. Bits' Dialog.Content is fixed/centered, NOT
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
   * rides utilities on the wrapper (like Tabs' `max-w-md`), not the token-only recipe. A caller
   * that must sit somewhere other than the stage's centre (the command palette, anchored on its
   * trigger) leaves the stage's layout with the `fixed` utility and its own insets.
   */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import X from "@lucide/svelte/icons/x";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    Z_LAYER_CLASSES,
    PRESENCE_FADE,
    PRESENCE_NONE,
    PRESENCE_SCALE_FADE,
    type PresenceClass,
  } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import DialogOverlay from "./dialog-overlay.svelte";

  let {
    ref = $bindable(null),
    // A content dialog wants the corner ✕ as its natural dismiss, so it defaults true (preserving the
    // built-in Close). A dialog with explicit footer actions can pass showClose={false}; a
    // confirmation should not use this component at all — use AlertDialog. Destructured out so it does
    // NOT spread onto Bits' Content.
    showClose = true,
    // The panel's entrance/exit recipe — one of the closed presence constants from
    // internal/floating.ts, defaulting to the standard scale-fade. A caller whose panel should
    // not read as growing from center picks fade, settle-fade, or none. Destructured out so it
    // does NOT spread onto Bits' Content.
    presence = PRESENCE_SCALE_FADE,
    class: className,
    children,
    ...restProps
  }: WithoutChild<DialogPrimitive.ContentProps> & {
    showClose?: boolean;
    presence?: PresenceClass;
  } = $props();

  // An instant panel needs an instant scrim: the overlay fading in beneath a panel that is
  // already fully formed reads as the backdrop lagging. Every animated presence keeps the
  // scrim's own low-emphasis fade.
  const overlayPresence = $derived(presence === PRESENCE_NONE ? PRESENCE_NONE : PRESENCE_FADE);
</script>

<DialogPrimitive.Portal>
  <DialogOverlay presence={overlayPresence} />
  <!-- The stage carries the modal z-layer, not only the panel: a fixed box is a stacking context
       of its own, so a z-index on the panel alone would leave it beneath the scrim. -->
  <div class={mergeClasses(Z_LAYER_CLASSES.modal, "mc-modal-stage")}>
    <DialogPrimitive.Content
      bind:ref
      class={mergeClasses(presence, "mc-dialog-content w-full max-w-lg", className)}
      {...restProps}
    >
      {@render children?.()}
      {#if showClose}
        <DialogPrimitive.Close class="mc-dialog-close" aria-label="Close">
          <X class="mc-dialog-close-icon" aria-hidden="true" />
        </DialogPrimitive.Close>
      {/if}
    </DialogPrimitive.Content>
  </div>
</DialogPrimitive.Portal>
