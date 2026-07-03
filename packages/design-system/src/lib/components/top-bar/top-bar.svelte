<script lang="ts">
  /* TopBar.Root — the app shell's horizontal chrome band (a <header> landmark). The app assembles
     the slots (Search trigger, +New, the timer/alerts seams, user); the recipe carries the ink
     register and pins the row to the sidebar's brand-corner height. */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> = $props();
</script>

<header bind:this={ref} class={mergeClasses("mc-top-bar", className)} {...restProps}>
  {@render children?.()}
</header>
