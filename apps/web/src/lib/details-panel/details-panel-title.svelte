<script lang="ts">
  /*
   * DetailsPanel.Title — what the panel is showing. An h2, because the panel sits inside a screen
   * whose masthead already holds the h1.
   *
   * Heading attributes forward through, so a title standing in for a fact the platform cannot serve
   * yet can explain itself on hover without this part learning what that fact is.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";

  let {
    children,
    ...restProps
  }: HTMLAttributes<HTMLHeadingElement> & { children: Snippet } = $props();
</script>

<h2 class="text-base leading-tight font-semibold" {...restProps}>{@render children()}</h2>
