<script lang="ts">
  /* DropdownMenu.Trigger — the button that opens the menu. Thin pass-through over Bits UI
     DropdownMenu.Trigger with NO built-in look, so the caller styles it (typically an mc-button
     variant) without a default recipe fighting their chosen background/border. A press, a key, or
     a tap opens the menu through Bits; a mouse pointer resting on it opens the menu through Root's
     hover controller (hover-open.ts), which also keeps a press on an already hover-opened trigger
     from toggling the menu shut. A caller's own pointer handlers run first, as they would on a
     plain button.

     A TRIGGER WITH NO WORDS NEVER OPENS ON HOVER (owner ruling 2026-11-13: "don't auto-open ...
     menu on hover"). Hover earns its place on a word like Money, which a member points at to learn
     what is behind it. A "..." button, a cog or any other icon-only trigger says nothing until it is
     pressed, sits beside rows and headers the pointer crosses all the time, and opening it under a
     passing pointer drops a panel over whatever the member was reading. So the trigger is asked at
     the moment of the hover whether it carries any text; an icon with only an aria-label does not,
     and its menu opens by press, key or tap alone. */
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

  /** Whether the trigger shows any text, as opposed to an icon named only by its aria-label. */
  function hasVisibleWords(trigger: EventTarget): boolean {
    return trigger instanceof HTMLElement && (trigger.textContent ?? "").trim() !== "";
  }
</script>

<DropdownMenuPrimitive.Trigger
  bind:ref
  class={mergeClasses(className)}
  onpointerenter={(event) => {
    onpointerenter?.(event);
    // A disabled trigger opens nothing, by pointer as by press — browsers differ on whether a
    // disabled button still reports the pointer, so the check is made here.
    if (!restProps.disabled && hasVisibleWords(event.currentTarget)) hoverOpen.pointerEnter(event);
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
