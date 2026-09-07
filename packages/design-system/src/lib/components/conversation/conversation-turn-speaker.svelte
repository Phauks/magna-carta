<script lang="ts">
  /*
   * The speaker label: who this turn belongs to, over the body rather than beside it.
   *
   * It is set in the record register a transcript is read in — small, letterspaced, uppercase, the
   * way a transcript names the person speaking — so the eye finds the turns by their labels and the
   * bodies stay uninterrupted prose. The label is the app's words, never this component's.
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

<p
  bind:this={ref}
  class={mergeClasses("mc-conversation-turn-speaker", className)}
  {...restProps}
>
  {@render children?.()}
</p>
