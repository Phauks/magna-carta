<script lang="ts">
  /* DropdownMenu.Trigger — the button that opens the menu. Thin pass-through over Bits UI
     DropdownMenu.Trigger with NO built-in look, so the caller styles it (typically an mc-button
     variant) without a default recipe fighting their chosen background/border. A press, a key, or
     a tap opens the menu through Bits; a mouse pointer resting on it opens the menu through Root's
     hover controller (hover-open.ts), which also keeps a press on an already hover-opened trigger
     from toggling the menu shut. A caller's own pointer handlers run first, as they would on a
     plain button. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";
  import { getHoverOpenContext } from "./hover-open.ts";

  let {
    ref = $bindable(null),
    class: className,
    onpointerenter,
    onpointerleave,
    onpointerdown,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.TriggerProps> = $props();

  const hoverOpen = getHoverOpenContext();
</script>

<DropdownMenuPrimitive.Trigger
  bind:ref
  class={mergeClasses(className)}
  onpointerenter={(event) => {
    onpointerenter?.(event);
    // A disabled trigger opens nothing, by pointer as by press — browsers differ on whether a
    // disabled button still reports the pointer, so the check is made here.
    if (!restProps.disabled) hoverOpen.pointerEnter(event);
  }}
  onpointerleave={(event) => {
    onpointerleave?.(event);
    hoverOpen.pointerLeave(event);
  }}
  onpointerdown={(event) => {
    onpointerdown?.(event);
    hoverOpen.triggerPointerDown(event);
  }}
  {...restProps}
/>
