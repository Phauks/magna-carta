<script lang="ts">
  /*
   * Masthead.Title — the display-serif heading, the only door to font.display/weight.display.
   * Defaults to <h1> (a page has one masthead); pass `level` when the masthead heads a section
   * inside an existing document outline instead.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    level = 1,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLHeadingElement>, HTMLHeadingElement> & {
    /** Heading level (h1–h6). A page masthead is the h1; section mastheads step down. */
    level?: 1 | 2 | 3 | 4 | 5 | 6;
  } = $props();
</script>

<svelte:element
  this={`h${level}`}
  bind:this={ref}
  class={mergeClasses("mc-masthead-title", className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
