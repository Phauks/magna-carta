<script lang="ts">
  /* Masthead.Eyebrow — the letterspaced-caps kicker above the title (e.g. "Matter 2026-0114"). */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> = $props();
</script>

<span bind:this={ref} class={mergeClasses("mc-masthead-eyebrow", className)} {...restProps}>
  {@render children?.()}
</span>
