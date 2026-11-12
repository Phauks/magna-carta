<script lang="ts">
  /*
   * DropdownMenu.Content — the floating panel of actions. Portaled to the body to escape overflow;
   * Bits renders the positioning wrapper internally (the two-level rule — see internal/floating.ts)
   * and applies this class to the inner content element. The z-layer (anchored — above modal, so it works inside dialogs) and the scale-fade
   * presence come from the floating module; the look is the mc-dropdown-menu-content recipe.
   *
   * WHERE IT OPENS IS THE COMPONENT'S, NOT THE CALLER'S: the panel opens end-aligned to its
   * trigger (FLOATING_ALIGN — most menu triggers sit at the right-hand side of a row or a bar, and
   * a panel growing rightward from there ends up against the edge of the screen), never wider than
   * the room Bits measured (FLOATING_PANEL_STYLE), and Bits' Floating UI flips/shifts to keep it
   * in view (`avoidCollisions` on by default), held off the viewport edges by
   * FLOATING_COLLISION_PADDING. A caller whose trigger is left-anchored passes `align="start"` and
   * wins. The panel's min-width is layout — a utility on the element from the caller, not the
   * recipe — and a caller's `style` is composed after the panel's own, so it wins too.
   *
   * The panel is one of the places the pointer can be without the menu closing (hover-open.ts):
   * it reports the pointer's arrival and departure to Root's hover controller, and lets that
   * controller keep focus where it was when hover, not a press, opened the menu. A caller's own
   * handlers for the same events run first.
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
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
  import { getHoverOpenContext } from "./hover-open.ts";

  let {
    ref = $bindable(null),
    class: className,
    align = FLOATING_ALIGN,
    sideOffset = 6,
    collisionPadding = FLOATING_COLLISION_PADDING,
    style,
    // A dropdown menu is anchored, not modal: it should not freeze the page beneath it. Default to
    // leaving background scroll alone (Bits locks it otherwise) so the sidebar and work canvas stay
    // scrollable while a menu is open; the floating layer re-anchors as the page moves. A caller
    // that genuinely needs the lock can still pass preventScroll.
    preventScroll = false,
    onpointerenter,
    onpointerleave,
    onOpenAutoFocus,
    onCloseAutoFocus,
    portalTo,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.ContentProps> & {
    /** Inline style, composed AFTER the panel's own width rule so a caller's declaration wins. */
    style?: string | null;
    /**
     * Where the panel is portalled. The body by default; a menu opened from inside an element
     * that can go full screen (a player) names that element, or the panel is drawn outside the
     * full-screen layer and never seen.
     */
    portalTo?: Element | string;
  } = $props();

  const hoverOpen = getHoverOpenContext();
</script>

<DropdownMenuPrimitive.Portal to={portalTo}>
  <DropdownMenuPrimitive.Content
    bind:ref
    {align}
    {sideOffset}
    {collisionPadding}
    {preventScroll}
    style={floatingContentStyle(FLOATING_PANEL_STYLE, style)}
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
