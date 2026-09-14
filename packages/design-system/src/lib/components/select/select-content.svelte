<script lang="ts">
  /*
   * Select.Content — the floating listbox panel. Portaled to the body to escape overflow; Bits
   * renders the positioning wrapper internally (the two-level rule — see internal/floating.ts) and
   * applies this class to the inner content element. The z-layer (anchored — above modal, so it
   * works inside dialogs) and the scale-fade presence come from the floating module; the look is
   * the mc-select-content recipe.
   *
   * WHERE IT OPENS AND HOW WIDE IT GROWS IS THE COMPONENT'S, NOT THE CALLER'S. The panel opens
   * end-aligned to the trigger (FLOATING_ALIGN) and never extends past the trigger's end edge: it
   * is at least the trigger's width and at most the room Bits measured (LISTBOX_PANEL_STYLE), so a
   * long option wraps inside the panel rather than running it off the screen, and Bits' collision
   * handling (on by default, held off the viewport edges by FLOATING_COLLISION_PADDING) flips or
   * shifts it only when it cannot fit where it was asked to. A caller's explicit `align`, `side`
   * or `style` still wins. The Viewport is bounded by `--bits-floating-available-height` so a long
   * list scrolls within it (Bits mounts the scroll buttons when there is overflow). The GENERIC
   * floating variables (not the `--bits-select-*` aliases) are used so this same component serves
   * Combobox.Content too. Those Bits-owned positioning variables ride an inline style — they are
   * not `--mc-` tokens, so they belong on the element, never in the recipe (the components.css
   * purity gate). The caller nests Item/Group rows, which Bits places inside the scrollable
   * Viewport.
   */
  import { Select as SelectPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    FLOATING_ALIGN,
    FLOATING_COLLISION_PADDING,
    floatingContentClasses,
    floatingContentStyle,
    LISTBOX_PANEL_STYLE,
    PRESENCE_SCALE_FADE,
  } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import SelectScrollUpButton from "./select-scroll-up-button.svelte";
  import SelectScrollDownButton from "./select-scroll-down-button.svelte";

  let {
    ref = $bindable(null),
    class: className,
    align = FLOATING_ALIGN,
    sideOffset = 6,
    collisionPadding = FLOATING_COLLISION_PADDING,
    style,
    children,
    ...restProps
  }: WithoutChild<SelectPrimitive.ContentProps> & {
    /** Inline style, composed AFTER the panel's own width rules so a caller's declaration wins. */
    style?: string | null;
  } = $props();
</script>

<SelectPrimitive.Portal>
  <SelectPrimitive.Content
    bind:ref
    {align}
    {sideOffset}
    {collisionPadding}
    style={floatingContentStyle(LISTBOX_PANEL_STYLE, style)}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-select-content",
      className,
    )}
    {...restProps}
  >
    <SelectScrollUpButton />
    <SelectPrimitive.Viewport
      class="mc-select-viewport mc-scrollbar"
      style="max-height: var(--bits-floating-available-height)"
    >
      {@render children?.()}
    </SelectPrimitive.Viewport>
    <SelectScrollDownButton />
  </SelectPrimitive.Content>
</SelectPrimitive.Portal>
