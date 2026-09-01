<script lang="ts">
  /*
   * Masthead.Root — the page's ceremonial edge (Tier 1: native <header>, no Bits UI). Hosts the
   * heading stack (Eyebrow / Title / Meta) and the Actions slot; the recipe carries the register
   * (serif display title over caps eyebrow and citation meta). One per page — the Title defaults
   * to the page's <h1>.
   *
   * `density` steps the title down for a band that has to share its height with something else
   * (the matter chrome carries its section navigation in the same band). The step lives in the
   * recipe, never as a utility on the Title — see variants.ts.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { mastheadDensityClass, type MastheadDensity } from "./variants.ts";

  let {
    ref = $bindable(null),
    density = "default",
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & {
    density?: MastheadDensity;
  } = $props();
</script>

<header
  bind:this={ref}
  class={mergeClasses("mc-masthead", mastheadDensityClass(density), className)}
  {...restProps}
>
  {@render children?.()}
</header>
