<script lang="ts">
  /*
   * Masthead.Meta — the citation-style line under the title (number · practice area · client ·
   * responsible). Compose plain spans separated by <Masthead.MetaSeparator /> interpuncts.
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

<div bind:this={ref} class={mergeClasses("mc-masthead-meta", className)} {...restProps}>
  {@render children?.()}
</div>
