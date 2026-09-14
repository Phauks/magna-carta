<script lang="ts">
  /*
   * Combobox.Content — the floating listbox panel (role="listbox"), portaled to escape overflow. Bits
   * renders the positioning wrapper internally (the two-level rule — see internal/floating.ts) and
   * applies this class to the inner element; the z-layer + scale-fade presence come from the floating
   * module, and the surface reuses the shared mc-select-content recipe (a Combobox listbox looks like
   * a Select's).
   *
   * WHERE IT OPENS AND HOW WIDE IT GROWS IS THE COMPONENT'S, NOT THE CALLER'S. The panel opens
   * end-aligned to the field (FLOATING_ALIGN) and never extends past the field's end edge: at least
   * the field's width, at most the room Bits measured (LISTBOX_PANEL_STYLE), with Bits' collision
   * handling held off the viewport edges by FLOATING_COLLISION_PADDING. Bits anchors a combobox to
   * its INPUT element alone, which is the text box inside the bordered field, not the field — so
   * end-aligned to that the panel would stop short of the chevron. Root shares the field box that
   * Combobox.Input renders, and it is the anchor unless a caller passes `customAnchor`.
   *
   * ANCHORED, NEVER MODAL. The panel positions itself against whatever opened it and nothing else
   * happens: no scrim, no focus trap, no dialog. `side`/`align`/`sideOffset` pass through, so a
   * listbox opened from a menu opens as a flyout BESIDE its menu item (`side="right"`,
   * `align="start"`) rather than jumping to the middle of the screen. Where the thing that opened the
   * listbox is not the field — a menu item, a table cell, a row's chip — pass that element as
   * `customAnchor`; anchoring to an element that is about to be unmounted is what produces a panel
   * measured against a zero-sized rect and parked at the screen edge, so the anchor must be an element
   * that outlives the open.
   *
   * The list is CAPPED AND SCROLLABLE by default: a dropdown that grows to the bottom of the screen is
   * not a dropdown. The cap is the smaller of the space Bits measured and a fixed maximum of about
   * eight rows, and it rides an inline style because those are Bits-owned positioning variables rather
   * than --mc- tokens (the components.css purity gate keeps them off the recipe).
   *
   * `virtualized` turns that off for the one shape that must own its own scroller: a VirtualList
   * inside the panel is already the bounded, scrolling region, and wrapping it in a second scrolling
   * viewport makes the two fight over the same scroll.
   *
   * The Content carries the shared listbox id so the Input's aria-controls resolves to it.
   */
  import { Combobox as ComboboxPrimitive } from "bits-ui";
  import { getContext } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    FLOATING_ALIGN,
    FLOATING_COLLISION_PADDING,
    floatingContentClasses,
    floatingContentStyle,
    LISTBOX_PANEL_STYLE,
    PRESENCE_SCALE_FADE,
  } from "../../internal/floating.ts";
  import { COMBOBOX_FIELD_ANCHOR, COMBOBOX_LISTBOX_ID, type ComboboxFieldAnchor } from "./context.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    align = FLOATING_ALIGN,
    sideOffset = 6,
    collisionPadding = FLOATING_COLLISION_PADDING,
    customAnchor,
    style,
    virtualized = false,
    children,
    ...restProps
  }: WithoutChild<ComboboxPrimitive.ContentProps> & {
    /** Inline style, composed AFTER the panel's own width rules so a caller's declaration wins. */
    style?: string | null;
    /**
     * Whether the caller nests its own bounded scroller (a VirtualList). The panel then imposes no
     * viewport of its own, so the two do not fight over the scroll.
     */
    virtualized?: boolean;
  } = $props();

  const listboxId = getContext<string>(COMBOBOX_LISTBOX_ID);
  const fieldAnchor = getContext<ComboboxFieldAnchor | undefined>(COMBOBOX_FIELD_ANCHOR);
  // The field box is the anchor unless the caller named one; Bits' own default (the input) is not
  // the control a person sees, so it is never what the panel aligns to.
  const anchor = $derived(customAnchor ?? fieldAnchor?.element ?? null);
</script>

<ComboboxPrimitive.Portal>
  <ComboboxPrimitive.Content
    bind:ref
    id={listboxId}
    {align}
    {sideOffset}
    {collisionPadding}
    customAnchor={anchor}
    style={floatingContentStyle(LISTBOX_PANEL_STYLE, style)}
    class={mergeClasses(
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
      "mc-select-content",
      className,
    )}
    {...restProps}
  >
    {#if virtualized}
      {@render children?.()}
    {:else}
      <ComboboxPrimitive.Viewport
        class="mc-select-viewport mc-scrollbar"
        style="max-height: min(var(--bits-floating-available-height, 18rem), 18rem)"
      >
        {@render children?.()}
      </ComboboxPrimitive.Viewport>
    {/if}
  </ComboboxPrimitive.Content>
</ComboboxPrimitive.Portal>
