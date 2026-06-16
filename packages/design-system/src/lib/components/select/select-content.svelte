<script lang="ts">
  /*
   * Select.Content — the floating listbox panel. Portaled to the body to escape overflow; Bits
   * renders the positioning wrapper internally (the two-level rule — see internal/floating.ts) and
   * applies this class to the inner content element. The z-layer (dropdown) and the scale-fade
   * presence come from the floating module; the look is the mc-select-content recipe.
   *
   * The panel matches the Trigger width via Bits' `--bits-select-anchor-width` and the Viewport is
   * bounded by `--bits-select-content-available-height` so a long list scrolls within the viewport
   * (Bits mounts the scroll buttons when there is overflow). Those Bits-owned positioning variables
   * ride an inline style — they are not `--mc-` tokens, so they belong on the element, never in the
   * recipe (the components.css purity gate). The Trigger's selection is the children: the caller
   * nests Item/Group rows, which Bits places inside the scrollable Viewport.
   */
  import { Select as SelectPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import SelectScrollUpButton from "./select-scroll-up-button.svelte";
  import SelectScrollDownButton from "./select-scroll-down-button.svelte";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    children,
    ...restProps
  }: WithoutChild<SelectPrimitive.ContentProps> = $props();
</script>

<SelectPrimitive.Portal>
  <SelectPrimitive.Content
    bind:ref
    {sideOffset}
    style="min-width: var(--bits-select-anchor-width)"
    class={mergeClasses(
      floatingContentClasses("dropdown", PRESENCE_SCALE_FADE),
      "mc-select-content",
      className,
    )}
    {...restProps}
  >
    <SelectScrollUpButton />
    <SelectPrimitive.Viewport
      class="mc-select-viewport"
      style="max-height: var(--bits-select-content-available-height)"
    >
      {@render children?.()}
    </SelectPrimitive.Viewport>
    <SelectScrollDownButton />
  </SelectPrimitive.Content>
</SelectPrimitive.Portal>
