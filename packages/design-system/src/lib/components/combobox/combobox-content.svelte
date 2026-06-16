<script lang="ts">
  /*
   * Combobox.Content — the floating listbox panel (role="listbox"), portaled to escape overflow. Bits
   * renders the positioning wrapper internally (the two-level rule — see internal/floating.ts) and
   * applies this class to the inner element; the z-layer + scale-fade presence come from the floating
   * module, and the surface reuses the shared mc-select-content recipe (a Combobox listbox looks like
   * a Select's). It does NOT impose its own scroll: the caller nests a VirtualList (the matter-picker
   * shape), which is the bounded scroller — a scrolling Viewport here would fight virtua's scroll.
   *
   * The Content carries the shared listbox id so the Input's aria-controls resolves to it.
   */
  import { Combobox as ComboboxPrimitive } from "bits-ui";
  import { getContext } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import { COMBOBOX_LISTBOX_ID } from "./context.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    ...restProps
  }: WithoutChild<ComboboxPrimitive.ContentProps> = $props();

  const listboxId = getContext<string>(COMBOBOX_LISTBOX_ID);
</script>

<ComboboxPrimitive.Portal>
  <ComboboxPrimitive.Content
    bind:ref
    id={listboxId}
    {sideOffset}
    style="min-width: var(--bits-floating-anchor-width)"
    class={mergeClasses(
      floatingContentClasses("dropdown", PRESENCE_SCALE_FADE),
      "mc-select-content",
      className,
    )}
    {...restProps}
  />
</ComboboxPrimitive.Portal>
