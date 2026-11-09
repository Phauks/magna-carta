<script lang="ts">
  /*
   * The acts on one turn — copy it, edit or delete one's own — as a quiet row beneath the body. The
   * controls are the app's (design-system Buttons with their own names); this part only lines them
   * up on the side the turn sits on.
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

<div bind:this={ref} class={mergeClasses("mc-conversation-turn-actions", className)} {...restProps}>
  {@render children?.()}
</div>
