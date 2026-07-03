<script lang="ts">
  /*
   * BrandMark — the product identity lockup: the blackletter illuminated "M" glyph beside the
   * letterspaced MAGNA CARTA wordmark (Tier 1: native <span>, no Bits UI). Chrome-register by
   * design: it renders on the dark ink surfaces (sidebar brand corner, auth, loading) where the
   * identity lives — never inside the work canvas.
   *
   * The glyph is presentation (aria-hidden); the wordmark span carries the accessible name and
   * KEEPS it when a collapsed sidebar rail hides the word visually (color, not display — the same
   * pattern as mc-sidebar-label). The glyph renders the letter "M" in the blackletter face as a
   * fixed piece of lettering (artwork); a drawn SVG mark is the planned successor and swaps in
   * here without changing consumers.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> = $props();
</script>

<span bind:this={ref} class={mergeClasses("mc-brand-mark", className)} {...restProps}>
  <span class="mc-brand-mark-glyph" aria-hidden="true">M</span>
  <span class="mc-brand-mark-word">Magna Carta</span>
</span>
