<script lang="ts">
  /*
   * Badge — a small non-interactive status/label chip (Tier 1: native <span>, no Bits UI).
   * Styling is the mc-badge recipe keyed by variant (variants.ts), with mergeClasses as the
   * single class seam and WithElementRef for the bindable ref. A span (not a button) because a
   * badge labels, it does not act; make it interactive only by wrapping it in a real control.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { badgeClasses, type BadgeVariant } from "./variants.ts";

  let {
    variant = "primary",
    caps = false,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
    /** Visual style of the badge. */
    variant?: BadgeVariant;
    /** Wear the letterspaced small-caps register, for a badge that labels a standing. */
    caps?: boolean;
  } = $props();
</script>

<span bind:this={ref} class={mergeClasses(badgeClasses({ variant, caps }), className)} {...restProps}>
  {@render children?.()}
</span>
