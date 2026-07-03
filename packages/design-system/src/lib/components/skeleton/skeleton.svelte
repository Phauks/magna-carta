<script lang="ts">
  /*
   * Skeleton — a loading placeholder (Tier 1: native <div>, no Bits UI). It carries the pulse
   * and shape (mc-skeleton recipe) but no intrinsic size: the caller sizes each placeholder to
   * the content it stands in for via utilities (h-4 w-48, size-10 rounded-full, …). aria-hidden
   * keeps the decorative shimmer out of the accessibility tree — the loading STATE is announced
   * by the region's own aria-busy/live wiring, not by these boxes.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();
</script>

<div
  bind:this={ref}
  aria-hidden="true"
  class={mergeClasses("mc-skeleton", className)}
  {...restProps}
></div>
