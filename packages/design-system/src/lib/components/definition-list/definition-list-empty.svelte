<script lang="ts">
  /*
   * DefinitionList.Empty — the list's own empty state, inside its frame.
   *
   * The words about why the definitions are empty belong beneath the terms, in the same frame, and
   * nowhere else: a paragraph beside the list on the canvas is what the owner named as leaving the
   * reader unprepared for the values that will arrive. The message sits in the definition column,
   * under the values it stands in for, with a term of its own that holds the grid's term column at
   * no height and that only assistive technology reads, because a definition list's grammar has no
   * row without one.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    term = "Status",
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** What a screen reader hears the message named as. Sighted readers see only the message. */
    term?: string;
    /** The message: why the definitions are empty, and what fills them. */
    children: Snippet;
  } = $props();
</script>

<div
  bind:this={ref}
  class={mergeClasses("mc-definition-list-empty", className)}
  data-placeholder="true"
  {...restProps}
>
  <dt class="mc-definition-list-empty-term">{term}</dt>
  <dd class="mc-definition-list-empty-message">{@render children()}</dd>
</div>
