<script lang="ts">
  /*
   * Card root (Tier 1: native <div>, no Bits UI). A flat, hairline-bordered raised surface — no
   * shadow (the register reserves shadow for floating layers only). Composes with the
   * sibling parts (Header/Title/Description/Content/Footer); this file owns the outer frame and
   * the vertical rhythm between sections. mergeClasses is the class seam; WithElementRef the ref.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();
</script>

<div bind:this={ref} class={mergeClasses("mc-card", className)} {...restProps}>
  {@render children?.()}
</div>
