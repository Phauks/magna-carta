<script lang="ts">
  /*
   * The column beside a turn's mark: the speaker line, the body, the notes and the acts on the
   * turn, stacked. In the record arrangement it is simply the turn's own column; in the exchange
   * arrangement it is what sits beside the mark and keeps to a readable measure, so a short question
   * does not stretch across the whole canvas.
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

<div bind:this={ref} class={mergeClasses("mc-conversation-turn-content", className)} {...restProps}>
  {@render children?.()}
</div>
