<script lang="ts">
  /*
   * Tooltip.Content — the floating bubble. Portaled to the body to escape overflow; Bits renders
   * the positioning wrapper internally (the two-level rule — see internal/floating.ts) and applies
   * this class to the inner content element. The z-layer + fade presence come from the floating
   * module; the look is the mc-tooltip recipe. (Uses the `overlay` z-layer — a dedicated tooltip
   * layer token would be cleaner; flagged for the z-order review.)
   *
   * Stays harmonious with its surroundings: Bits' Floating UI flips/shifts to keep the bubble in
   * view (`avoidCollisions` on by default), `collisionPadding` holds it off the viewport edges, and
   * `max-w-xs` lets long text wrap instead of overflowing left/right.
   */
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    collisionPadding = 8,
    ...restProps
  }: WithoutChild<TooltipPrimitive.ContentProps> = $props();
</script>

<TooltipPrimitive.Portal>
  <TooltipPrimitive.Content
    bind:ref
    {sideOffset}
    {collisionPadding}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_FADE),
      "mc-tooltip max-w-xs",
      className,
    )}
    {...restProps}
  />
</TooltipPrimitive.Portal>
