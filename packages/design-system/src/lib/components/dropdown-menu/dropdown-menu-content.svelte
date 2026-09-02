<script lang="ts">
  /*
   * DropdownMenu.Content — the floating panel of actions. Portaled to the body to escape overflow;
   * Bits renders the positioning wrapper internally (the two-level rule — see internal/floating.ts)
   * and applies this class to the inner content element. The z-layer (anchored — above modal, so it works inside dialogs) and the scale-fade
   * presence come from the floating module; the look is the mc-dropdown-menu-content recipe.
   *
   * Stays harmonious with its surroundings: Bits' Floating UI flips/shifts to keep the panel in
   * view (`avoidCollisions` on by default), and `collisionPadding` holds it off the viewport edges.
   * The panel's min-width is layout — a utility on the element from the caller, not the recipe.
   *
   * The panel is one of the places the pointer can be without the menu closing (hover-open.ts):
   * it reports the pointer's arrival and departure to Root's hover controller, and lets that
   * controller keep focus where it was when hover, not a press, opened the menu. A caller's own
   * handlers for the same events run first.
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import { getHoverOpenContext } from "./hover-open.ts";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    collisionPadding = 8,
    // A dropdown menu is anchored, not modal: it should not freeze the page beneath it. Default to
    // leaving background scroll alone (Bits locks it otherwise) so the sidebar and work canvas stay
    // scrollable while a menu is open; the floating layer re-anchors as the page moves. A caller
    // that genuinely needs the lock can still pass preventScroll.
    preventScroll = false,
    onpointerenter,
    onpointerleave,
    onOpenAutoFocus,
    onCloseAutoFocus,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.ContentProps> = $props();

  const hoverOpen = getHoverOpenContext();
</script>

<DropdownMenuPrimitive.Portal>
  <DropdownMenuPrimitive.Content
    bind:ref
    {sideOffset}
    {collisionPadding}
    {preventScroll}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-dropdown-menu-content",
      className,
    )}
    onpointerenter={(event) => {
      onpointerenter?.(event);
      hoverOpen.pointerEnter(event);
    }}
    onpointerleave={(event) => {
      onpointerleave?.(event);
      hoverOpen.pointerLeave(event);
    }}
    onOpenAutoFocus={(event) => {
      onOpenAutoFocus?.(event);
      if (!event.defaultPrevented) hoverOpen.openAutoFocus(event);
    }}
    onCloseAutoFocus={(event) => {
      onCloseAutoFocus?.(event);
      if (!event.defaultPrevented) hoverOpen.closeAutoFocus(event, ref);
    }}
    {...restProps}
  />
</DropdownMenuPrimitive.Portal>
