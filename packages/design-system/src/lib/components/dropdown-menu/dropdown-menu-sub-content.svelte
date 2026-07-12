<script lang="ts">
  /*
   * DropdownMenu.SubContent — the floating panel of a nested submenu. Portaled to the body to escape
   * overflow; Bits renders the positioning wrapper internally (the two-level rule — see
   * internal/floating.ts) and applies this class to the inner content element. The z-layer
   * (anchored — above modal, so it works inside dialogs) and the scale-fade presence come from the floating module; the look is the
   * mc-dropdown-menu-sub-content recipe (the same surface as the top-level Content).
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    collisionPadding = 8,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.SubContentProps> = $props();
</script>

<DropdownMenuPrimitive.Portal>
  <DropdownMenuPrimitive.SubContent
    bind:ref
    {sideOffset}
    {collisionPadding}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-dropdown-menu-sub-content",
      className,
    )}
    {...restProps}
  />
</DropdownMenuPrimitive.Portal>
