<script lang="ts">
  /*
   * ContextMenu.SubContent — the floating panel of a nested submenu. Portaled to the body to escape
   * overflow; Bits renders the positioning wrapper internally (the two-level rule — see
   * internal/floating.ts) and applies this class to the inner content element. The z-layer
   * (anchored — above modal, like the top-level Content, so a submenu inside a dialog is usable)
   * and the scale-fade presence come from the floating module; the look is the
   * mc-context-menu-sub-content recipe (the same surface as the top-level Content).
   *
   * A submenu that hosts a field stays open while the field's own floating layer holds focus
   * (menu-field-layer.ts): the grid's date-range filter lives in one, and its calendar is portaled
   * outside the panel, where Bits would otherwise read it as focus leaving.
   */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import { keepMenuFieldLayer } from "./menu-field-layer.ts";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    collisionPadding = 8,
    onFocusOutside,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.SubContentProps> = $props();
</script>

<ContextMenuPrimitive.Portal>
  <ContextMenuPrimitive.SubContent
    bind:ref
    {sideOffset}
    {collisionPadding}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-context-menu-sub-content",
      className,
    )}
    onFocusOutside={(event) => {
      onFocusOutside?.(event);
      keepMenuFieldLayer(event);
    }}
    {...restProps}
  />
</ContextMenuPrimitive.Portal>
