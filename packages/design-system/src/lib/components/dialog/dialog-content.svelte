<script lang="ts">
  /*
   * Dialog.Content — the centered modal panel, composed with its backdrop. It portals to the body,
   * renders the Overlay scrim, then the panel; inside the panel it renders the caller's content
   * followed by a default top-right Close button (the Lucide X, deep-imported) when showClose is set
   * (the default).
   *
   * Where the panel sits is not this file's: it renders inside ModalStage (internal/modal-stage.svelte)
   * and carries `mc-modal-panel`, and the stage recipe (styles/recipes/modal-stage.css) centres it
   * in the screen less its gutter and caps it there — by flex, never by a centering transform,
   * which matters because the presence here is PRESENCE_SCALE_FADE, a Tailwind `scale-*` transform
   * that would overwrite a `translate(-50%, -50%)` and send the panel to a corner mid-animation.
   * The one choice a caller has about placement is the `placement` prop (internal/modal-placement.ts):
   * `centered` (the default) or `anchored`, for a panel that positions itself against the viewport
   * with its own insets, as the command palette does on its trigger. The panel's width is layout,
   * so it rides utilities on the wrapper (like Tabs' `max-w-md`), not the token-only recipe; its
   * height needs no utility, because the stage is the cap. Bits' Dialog.Content is NOT
   * Floating-UI-anchored, so the two-level wrapper rule does NOT apply: classes go straight on the
   * Content element.
   */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import X from "@lucide/svelte/icons/x";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    PRESENCE_FADE,
    PRESENCE_NONE,
    PRESENCE_SCALE_FADE,
    type PresenceClass,
  } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import {
    DEFAULT_MODAL_PLACEMENT,
    MODAL_PLACEMENT_ATTRIBUTE,
    type ModalPlacement,
  } from "../../internal/modal-placement.ts";
  import ModalStage from "../../internal/modal-stage.svelte";
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
    // Where the panel sits: centred in the stage, or anchored against the viewport by its own
    // insets. Destructured out so it does NOT spread onto Bits' Content; it lands as an attribute
    // the stage recipe matches and a reader of the DOM can see.
    placement = DEFAULT_MODAL_PLACEMENT,
    class: className,
    children,
    ...restProps
  }: WithoutChild<DialogPrimitive.ContentProps> & {
    showClose?: boolean;
    presence?: PresenceClass;
    placement?: ModalPlacement;
  } = $props();

  // An instant panel needs an instant scrim: the overlay fading in beneath a panel that is
  // already fully formed reads as the backdrop lagging. Every animated presence keeps the
  // scrim's own low-emphasis fade.
  const overlayPresence = $derived(presence === PRESENCE_NONE ? PRESENCE_NONE : PRESENCE_FADE);
</script>

<DialogPrimitive.Portal>
  <DialogOverlay presence={overlayPresence} />
  <ModalStage>
    <DialogPrimitive.Content
      bind:ref
      class={mergeClasses(presence, "mc-modal-panel mc-dialog-content w-full max-w-lg", className)}
      {...{ [MODAL_PLACEMENT_ATTRIBUTE]: placement }}
      {...restProps}
    >
      {@render children?.()}
      {#if showClose}
        <DialogPrimitive.Close class="mc-dialog-close" aria-label="Close">
          <X class="mc-dialog-close-icon" aria-hidden="true" />
        </DialogPrimitive.Close>
      {/if}
    </DialogPrimitive.Content>
  </ModalStage>
</DialogPrimitive.Portal>
