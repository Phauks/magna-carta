<script lang="ts">
  /* TopBar.Actions — the trailing region (+New, the timer/alerts seams, user/firm), pushed to
     the inline end. Slots are the app's domain knowledge; this is only the geometry. */
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

<div bind:this={ref} class={mergeClasses("mc-top-bar-actions", className)} {...restProps}>
  {@render children?.()}
</div>
