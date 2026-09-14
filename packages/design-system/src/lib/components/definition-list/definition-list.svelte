<script lang="ts">
  /*
   * DefinitionList — a set of named values, framed.
   *
   * A list of terms and their definitions is the second structure the product holds data in after
   * the table: a file's digests by algorithm, a call's facts, a server's identity. Written by hand
   * it was a `<dl>` with a different grid on every surface, and — the reason it is a component —
   * nowhere for the words about its emptiness to go except a paragraph loose on the canvas beside
   * it. So this is the frame, and `DefinitionList.Empty` is the row inside it that those words
   * live in: the terms stand with empty definitions while nothing is known, the message sits
   * beneath them inside the same frame, and a reader learns where the values will land before any
   * do. The same judgment the empty table makes with its header row over an empty body.
   *
   * Two columns, the term sized to its longest word and the definition taking the rest, so a long
   * value (a digest, an address) wraps inside the frame rather than widening it.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDListElement>, HTMLDListElement> = $props();
</script>

<dl bind:this={ref} class={mergeClasses("mc-definition-list", className)} {...restProps}>
  {@render children?.()}
</dl>
