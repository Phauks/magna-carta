<script lang="ts">
  /* Alert title — the headline line. Inherits the variant's foreground colour (set on the root),
   * so it stays on the gated AA-safe status pairing; weight alone distinguishes it from the body. */
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

<div bind:this={ref} class={mergeClasses("mc-alert-title", className)} {...restProps}>
  {@render children?.()}
</div>
