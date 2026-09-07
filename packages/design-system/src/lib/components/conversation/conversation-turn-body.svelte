<script lang="ts">
  /*
   * The turn's text.
   *
   * PLAIN TEXT ONLY. Nothing here renders markup, and there is no prop that would: a body is
   * rendered as children, so the only thing that reaches the page is text a caller passed. A model's
   * output is untrusted content, and an HTML-rendering path through this component would be the one
   * place that stopped being true. Nothing added here may introduce one.
   *
   * The author's own line breaks survive (`white-space: pre-wrap` on the recipe): a question typed
   * over three lines reads as three lines, because the shape somebody gave their own words is part
   * of what they wrote.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLParagraphElement>, HTMLParagraphElement> = $props();
</script>

<p bind:this={ref} class={mergeClasses("mc-conversation-turn-body", className)} {...restProps}>
  {@render children?.()}
</p>
