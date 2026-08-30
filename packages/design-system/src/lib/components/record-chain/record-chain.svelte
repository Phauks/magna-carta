<script lang="ts">
  /*
   * RecordChain — where a record has got to, and what that costs it.
   *
   * QUIET BY CONSTRUCTION, in two separate ways, because two different facts are in play:
   *
   *   1. The STEPPER is review-flow vocabulary. A firm that has not turned review on never submits
   *      anything and never approves anything, so on that firm's screens Submitted and Approved are
   *      not disabled steps, greyed out for a workflow nobody uses: they are ABSENT, along with the
   *      chain that would have carried them. `reviewGate` therefore defaults to off, and off means
   *      nothing renders.
   *   2. The LOCK LINE is not review-flow vocabulary. A billed record is locked whether or not a
   *      firm reviews anything, and a read-only window has to say why once. So the lock renders
   *      independently of the gate, which is what lets the read-only window use this component for
   *      its single lock line rather than writing a second one.
   *
   * It does not lecture. Each step's meaning rides its hover, out of the status register, so the
   * chain and the chip on the row above it say the same thing about the same word. The one printed
   * sentence is the lock, which states its fact and links its object rather than explaining what
   * the reader may then do about it.
   *
   * There is no colour here beyond the surface's own text and border tones. The chain is background
   * for the record, not a second status indicator competing with the chip.
   */
  import Lock from "@lucide/svelte/icons/lock";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { statusEntry } from "../../status-register/index.ts";
  import {
    RECORD_CHAIN_STAGES,
    recordChainLockReason,
    recordChainStepState,
  } from "./chain-stages.ts";
  import type { RecordChainLock, RecordChainStage } from "./types.ts";

  let {
    ref = $bindable(null),
    current,
    reviewGate = false,
    lock,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The stage the record has actually reached. */
    current: RecordChainStage;
    /**
     * Whether this firm runs the review flow. Off by default, and off means the chain does not
     * render at all: an unused workflow's vocabulary is absent, never disabled.
     */
    reviewGate?: boolean;
    /**
     * The record's lock, where it has one. Renders whether or not the gate is on, because a
     * locked record is locked either way. Omit `reason` to state the stage's settled one.
     */
    lock?: RecordChainLock;
  } = $props();

  const lockReason = $derived(
    lock === undefined
      ? null
      : (lock.reason ?? recordChainLockReason(current, { hasLinkedObject: lock.object !== undefined })),
  );
</script>

{#if reviewGate || lockReason !== null}
  <div bind:this={ref} class={mergeClasses("mc-record-chain", className)} {...restProps}>
    {#if reviewGate}
      <ol class="mc-record-chain-steps">
        {#each RECORD_CHAIN_STAGES as stage (stage)}
          {@const state = recordChainStepState(stage, current)}
          <li
            class="mc-record-chain-step"
            data-state={state}
            title={statusEntry(stage).meaning}
            aria-current={state === "present" ? "step" : undefined}
          >
            <span class="mc-record-chain-marker" aria-hidden="true"></span>
            <span class="mc-record-chain-label">{statusEntry(stage).label}</span>
          </li>
        {/each}
      </ol>
    {/if}
    {#if lockReason !== null}
      <p class="mc-record-chain-lock">
        <Lock class="mc-record-chain-lock-icon" aria-hidden="true" />
        <span>{lockReason}</span>
        {#if lock?.object}
          <a class="mc-record-chain-lock-link" href={lock.object.href}>{lock.object.label}</a>
        {/if}
      </p>
    {/if}
  </div>
{/if}
