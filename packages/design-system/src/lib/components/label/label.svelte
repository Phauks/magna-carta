<script lang="ts">
  /*
   * Label — a styled native <label> (Tier 1: native element, no Bits UI; a label needs no
   * headless behavior). The native for/id association (or wrapping a control) is what links it
   * to its field; this component only styles it. Styling is the mc-label recipe
   * (src/lib/styles/components.css); callers layer Tailwind utilities via `class`, merged last
   * so they win (mergeClasses is the single class-merge path). WithElementRef adds `ref`.
   */
  import type { HTMLLabelAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLLabelAttributes, HTMLLabelElement> = $props();
</script>

<label bind:this={ref} class={mergeClasses("mc-label", className)} {...restProps}>
  {@render children?.()}
</label>
