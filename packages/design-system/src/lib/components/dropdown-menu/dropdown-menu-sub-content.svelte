<script lang="ts">
  /*
   * DropdownMenu.SubContent — the floating panel of a nested submenu. Portaled to the body to escape
   * overflow; Bits renders the positioning wrapper internally (the two-level rule — see
   * internal/floating.ts) and applies this class to the inner content element. The z-layer
   * (anchored — above modal, so it works inside dialogs) and the scale-fade presence come from the floating module; the look is the
   * mc-dropdown-menu-sub-content recipe (the same surface as the top-level Content).
   *
   * A submenu panel is portaled beside its parent panel, not inside it, so the pointer crossing
   * from one to the other LEAVES the parent. It therefore reports the pointer to the root menu's
   * hover controller (hover-open.ts) exactly as the parent panel does, or a hover-opened menu would
   * close under a member reaching into its submenu.
   *
   * A submenu that hosts a field stays open while the field's own floating layer holds focus
   * (../context-menu/menu-field-layer.ts): a calendar or a list portaled outside the panel would
   * otherwise read to Bits as focus leaving.
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import { getHoverOpenContext } from "./hover-open.ts";
  import { keepMenuFieldLayer } from "../context-menu/menu-field-layer.ts";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    collisionPadding = 8,
    onpointerenter,
    onpointerleave,
    onFocusOutside,
    portalTo,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.SubContentProps> & {
    /** Where the panel is portalled; the same element its parent menu's Content names. */
    portalTo?: Element | string;
  } = $props();

  const hoverOpen = getHoverOpenContext();
</script>

<DropdownMenuPrimitive.Portal to={portalTo}>
  <DropdownMenuPrimitive.SubContent
    bind:ref
    {sideOffset}
    {collisionPadding}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-dropdown-menu-sub-content",
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
    onFocusOutside={(event) => {
      onFocusOutside?.(event);
      keepMenuFieldLayer(event);
    }}
    {...restProps}
  />
</DropdownMenuPrimitive.Portal>
