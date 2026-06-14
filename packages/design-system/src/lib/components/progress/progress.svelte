<script lang="ts">
  /*
   * Progress (Tier 2) — a determinate progress bar over Bits UI Progress.Root (role="progressbar",
   * aria-value*). The track is the recipe; the fill is an inner element whose width is the value as
   * a percentage of max — a runtime data dimension, so it's an inline width, not a token.
   */
  import { Progress as ProgressPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    value = 0,
    max = 100,
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();

  const percent = $derived(
    value == null ? 0 : Math.min(100, Math.max(0, (value / (max || 100)) * 100)),
  );
</script>

<ProgressPrimitive.Root
  bind:ref
  {value}
  {max}
  class={mergeClasses("mc-progress w-full", className)}
  {...restProps}
>
  <div class="mc-progress-fill" style="inline-size: {percent}%"></div>
</ProgressPrimitive.Root>
