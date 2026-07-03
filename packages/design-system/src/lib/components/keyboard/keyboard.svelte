<script lang="ts">
  /*
   * Keyboard — a keyboard-key hint (Tier 1: native <kbd>, no Bits UI). Renders a single key or
   * token of a shortcut; compose several side by side for a chord. Styling is the mc-keyboard
   * recipe (a sunken, mono, hairline-bordered chip); mergeClasses is the class seam,
   * WithElementRef the ref.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> = $props();
</script>

<kbd bind:this={ref} class={mergeClasses("mc-keyboard", className)} {...restProps}>
  {@render children?.()}
</kbd>
