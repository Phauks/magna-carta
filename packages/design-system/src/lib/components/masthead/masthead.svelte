<script lang="ts">
  /*
   * Masthead.Root — the page's ceremonial edge (Tier 1: native <header>, no Bits UI). Hosts the
   * heading stack (Eyebrow / Title / Meta) and the Actions slot; the recipe carries the register
   * (serif display title over caps eyebrow and citation meta). One per page — the Title defaults
   * to the page's <h1>.
   */
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

<header bind:this={ref} class={mergeClasses("mc-masthead", className)} {...restProps}>
  {@render children?.()}
</header>
