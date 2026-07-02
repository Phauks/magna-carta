<script lang="ts">
  /* Masthead.MetaSeparator — the interpunct between citation-meta entries. Punctuation, not
     content: hidden from the accessibility tree so screen readers read the entries cleanly. */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> = $props();
</script>

<span
  bind:this={ref}
  class={mergeClasses("mc-masthead-meta-separator", className)}
  aria-hidden="true"
  {...restProps}
>
  ·
</span>
