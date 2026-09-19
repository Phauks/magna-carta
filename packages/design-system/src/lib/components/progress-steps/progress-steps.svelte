<script lang="ts">
  /*
   * ProgressSteps (Tier 2) — a short, named sequence that reports itself as it advances: each step
   * is pending, active, done, or failed. It exists for work the page HANDS OFF and then waits on,
   * where a spinner would be a lie about what is happening: a passkey ceremony is three distinct
   * moments (the browser is asked, the authenticator is exercised, a credential comes back), and a
   * control that simply turns green misreports all three.
   *
   * The list is a live region so the sequence is announced as it moves, not only seen. It is
   * `polite`, deliberately: these steps progress on their own and interrupting the reader mid-word
   * to say "Waiting for your device" is worse than telling them a beat later. A failure replaces
   * the step's own label with the reason, so the failed step reads as one sentence rather than a
   * struck-through step plus a stray error elsewhere on the card.
   *
   * No motion: the active marker is a filled dot, not a spinner. A spinner on a surface that is
   * already waiting on a native operating-system sheet adds nothing, and every motion here would
   * need a reduced-motion path to say the same thing anyway.
   */
  import Check from "@lucide/svelte/icons/check";
  import X from "@lucide/svelte/icons/x";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { ProgressStep } from "./types.ts";

  let {
    ref = $bindable(null),
    steps,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLOListElement>, HTMLOListElement> & {
    /** The sequence, in order. Each carries its own label and status. */
    steps: readonly ProgressStep[];
  } = $props();
</script>

<ol
  bind:this={ref}
  aria-live="polite"
  class={mergeClasses("mc-progress-steps", className)}
  {...restProps}
>
  {#each steps as step (step.label)}
    <li class="mc-progress-steps-step" data-status={step.status}>
      <span class="mc-progress-steps-marker" aria-hidden="true">
        {#if step.status === "done"}
          <Check size={14} />
        {:else if step.status === "failed"}
          <X size={14} />
        {/if}
      </span>
      <span class="mc-progress-steps-label">
        {step.status === "failed" && step.failure ? step.failure : step.label}
      </span>
      {#if step.note !== undefined}
        <span class="mc-progress-steps-note" aria-hidden="true">{step.note}</span>
      {/if}
    </li>
  {/each}
</ol>
