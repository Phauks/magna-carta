<script lang="ts">
  /*
   * EmptyState — the archetype "empty (initial)" pattern (Tier 1, native elements): the
   * illuminated-M watermark in the palest ink, a plain statement of what belongs here, and one
   * clear primary action (the `actions` snippet). An empty screen is an invitation to act.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    title,
    ref = $bindable(null),
    class: className,
    children,
    actions,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The plain statement of what belongs here (e.g. "No matters yet"). */
    title: string;
    /** The invitation's primary action(s) — usually one Button. */
    actions?: Snippet;
  } = $props();
</script>

<div bind:this={ref} class={mergeClasses("mc-empty-state", className)} {...restProps}>
  <span class="mc-empty-state-mark" aria-hidden="true">M</span>
  <p class="mc-empty-state-title">{title}</p>
  {#if children}
    <p class="mc-empty-state-description">{@render children()}</p>
  {/if}
  {#if actions}
    <div class="mc-empty-state-actions">{@render actions()}</div>
  {/if}
</div>
