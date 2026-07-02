<script lang="ts">
  /*
   * Card title. A <div>, not a heading: the correct heading level depends on the card's place in
   * the page outline, which the card cannot know — a caller that needs a landmark heading passes
   * its own element via `class`/composition. Styling only here.
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

<div bind:this={ref} class={mergeClasses("mc-card-title", className)} {...restProps}>
  {@render children?.()}
</div>
