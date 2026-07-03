<script lang="ts">
  /* Alert description — the supporting body. Inherits the variant foreground (set on the root) to
   * stay on the gated AA-safe status pairing (muting it would leave the gated set). */
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

<div bind:this={ref} class={mergeClasses("mc-alert-description", className)} {...restProps}>
  {@render children?.()}
</div>
