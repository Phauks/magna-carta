<script lang="ts">
  /*
   * ContextMenu.Content — the floating panel of actions, anchored to the pointer position where the
   * menu was summoned. Portaled to the body to escape overflow; Bits renders the positioning wrapper
   * internally (the two-level rule — see internal/floating.ts) and applies this class to the inner
   * content element. The z-layer (anchored — above modal, so a menu raised inside a dialog is
   * usable; on the old dropdown layer it painted under the panel, there and unreachable) and the
   * scale-fade presence come from the floating module; the look is the mc-context-menu-content
   * recipe.
   *
   * Stays in view: Bits' Floating UI flips/shifts to keep the panel visible (`avoidCollisions` on by
   * default), and `collisionPadding` holds it off the viewport edges. `sideOffset` keeps Bits' small
   * default (the menu opens right at the cursor), and so does `align`: a context menu anchors to
   * the pointer, not a control, so the end-alignment the control-anchored surfaces share does not
   * apply — it opens from the cursor in the reading direction as every platform's does.
   */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    collisionPadding = 8,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.ContentProps> = $props();
</script>

<ContextMenuPrimitive.Portal>
  <ContextMenuPrimitive.Content
    bind:ref
    {collisionPadding}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-context-menu-content",
      className,
    )}
    {...restProps}
  />
</ContextMenuPrimitive.Portal>
