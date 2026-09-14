<script lang="ts">
  /*
   * Popover.Content — the floating panel. Portaled to the body to escape overflow; Bits renders
   * the positioning wrapper internally (the two-level rule — see internal/floating.ts) and applies
   * this class to the inner content element. The z-layer (anchored — above modal, so it works inside dialogs) and the scale-fade presence
   * come from the floating module; the look is the mc-popover-content recipe.
   *
   * WHERE IT OPENS IS THE COMPONENT'S, NOT THE CALLER'S: the panel opens end-aligned to its
   * trigger (FLOATING_ALIGN — most popover triggers sit at the right-hand side of a row or a bar,
   * and a panel growing rightward from there ends up against the edge of the screen), never wider
   * than the room Bits measured (FLOATING_PANEL_STYLE), and Bits' Floating UI flips/shifts to keep
   * it in view (`avoidCollisions` on by default), held off the viewport edges by
   * FLOATING_COLLISION_PADDING. A caller whose trigger is left-anchored — a filter control at the
   * start of a toolbar — passes `align="start"` and wins. The panel's width is layout — a utility
   * on the element from the caller, not the recipe — and a caller's `style` is composed after the
   * panel's own, so it wins too.
   */
  import { Popover as PopoverPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    FLOATING_ALIGN,
    FLOATING_COLLISION_PADDING,
    FLOATING_PANEL_STYLE,
    floatingContentClasses,
    floatingContentStyle,
    PRESENCE_SCALE_FADE,
  } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    align = FLOATING_ALIGN,
    sideOffset = 6,
    collisionPadding = FLOATING_COLLISION_PADDING,
    style,
    ...restProps
  }: WithoutChild<PopoverPrimitive.ContentProps> & {
    /** Inline style, composed AFTER the panel's own width rule so a caller's declaration wins. */
    style?: string | null;
  } = $props();
</script>

<PopoverPrimitive.Portal>
  <PopoverPrimitive.Content
    bind:ref
    {align}
    {sideOffset}
    {collisionPadding}
    style={floatingContentStyle(FLOATING_PANEL_STYLE, style)}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-popover-content",
      className,
    )}
    {...restProps}
  />
</PopoverPrimitive.Portal>
