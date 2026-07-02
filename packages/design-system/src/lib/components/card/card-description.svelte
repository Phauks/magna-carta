<script lang="ts">
  /* Card description — muted supporting text under the title. See card.svelte for rationale. */
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

<div bind:this={ref} class={mergeClasses("mc-card-description", className)} {...restProps}>
  {@render children?.()}
</div>
