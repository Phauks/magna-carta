<script lang="ts">
  /*
   * Popover.Content — the floating panel. Portaled to the body to escape overflow; Bits renders
   * the positioning wrapper internally (the two-level rule — see internal/floating.ts) and applies
   * this class to the inner content element. The z-layer (dropdown) and the scale-fade presence
   * come from the floating module; the look is the mc-popover-content recipe.
   *
   * Stays harmonious with its surroundings: Bits' Floating UI flips/shifts to keep the panel in
   * view (`avoidCollisions` on by default), and `collisionPadding` holds it off the viewport edges.
   * The panel's width is layout — a utility on the element from the caller, not the recipe.
   */
  import { Popover as PopoverPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    collisionPadding = 8,
    ...restProps
  }: WithoutChild<PopoverPrimitive.ContentProps> = $props();
</script>

<PopoverPrimitive.Portal>
  <PopoverPrimitive.Content
    bind:ref
    {sideOffset}
    {collisionPadding}
    class={mergeClasses(
      floatingContentClasses("dropdown", PRESENCE_SCALE_FADE),
      "mc-popover-content",
      className,
    )}
    {...restProps}
  />
</PopoverPrimitive.Portal>
