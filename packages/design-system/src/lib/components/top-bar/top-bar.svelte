<script lang="ts">
  /* TopBar.Root — the app shell's horizontal chrome band (a <header> landmark). The app assembles
     the slots (Search trigger, +New, the timer/alerts seams, user); the recipe carries the ink
     register and pins the row to the sidebar's brand-corner height.

     THE BAR HOLDS ONE OPEN OVERLAY AT A TIME. Its controls sit a few pixels apart and nearly every
     one of them opens a panel over the work canvas; two of those open at once cover each other and
     the screen underneath, and pressing the second control is how a member says they are done with
     the first. So the bar declares itself an overlay band (internal/overlay-band.svelte.ts) and
     every popover and menu seated in it hands its place on when the next one opens. The bar needs
     to know nothing about what those panels hold — only that they share one place. */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { OverlayBand, setOverlayBand } from "../../internal/overlay-band.svelte.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> = $props();

  setOverlayBand(new OverlayBand());
</script>

<header bind:this={ref} class={mergeClasses("mc-top-bar", className)} {...restProps}>
  {@render children?.()}
</header>
