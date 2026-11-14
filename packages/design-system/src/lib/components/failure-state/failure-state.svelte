<script lang="ts">
  /*
   * FailureState — a panel or a screen that could not be read, at the scale where the failure owns
   * the space it is in.
   *
   * IT COMPOSES EmptyState RATHER THAN RESTATING IT. The watermark, the title, the description and
   * the action row are the same furniture an empty screen uses, and the difference between "nothing
   * is here yet" and "we could not fetch what is here" is the words and the diagnostics, not the
   * layout. Two copies of this shape had already grown in the app — one for costs, one for billing —
   * and they had begun to disagree; this is the extraction of the better half of both.
   *
   * `reassurance` is the sentence that says the record is unharmed. It is a prop because it is the
   * one genuinely per-area line and it is the most valuable sentence on the screen: a person whose
   * trust ledger will not load does not know whether the money is gone, and saying so before
   * anything else is the difference between an inconvenience and a panic.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import EmptyState from "../empty-state/index.ts";
  import FailureDetails from "../failure-details/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { FailureDetailRow } from "../failure-details/types.ts";

  let {
    title,
    message,
    reassurance,
    note,
    rows,
    trace,
    showTrace = false,
    steps,
    summary,
    actions,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** What could not be done, as a heading. */
    title: string;
    /** What happened, in words a reader can act on. */
    message: string;
    /** The area's own statement that its record survived this. Rendered right after the message. */
    reassurance?: string;
    /** One more fact the message had no room for — attempts remaining, most often. */
    note?: string;
    rows: readonly FailureDetailRow[];
    trace: string | (() => string);
    showTrace?: boolean;
    /** What to try, in order. Rendered as a numbered list under the diagnostics. */
    steps?: readonly string[];
    /** The controls — Retry, Report a problem, or whatever remedy the failure actually names. */
    actions?: Snippet;
    /** Area, action and kind of failure, as short labels. Given, the facts wait behind Show details. */
    summary?: readonly string[];
  } = $props();
</script>

<div bind:this={ref} class={mergeClasses("mc-failure-state", className)} {...restProps}>
  <EmptyState {title} {actions}>
    {message}{#if reassurance !== undefined}&nbsp;{reassurance}{/if}
  </EmptyState>

  {#if note !== undefined}
    <p class="mc-failure-state-note">{note}</p>
  {/if}

  <FailureDetails {rows} {trace} {showTrace} {summary} />

  {#if steps !== undefined && steps.length > 0}
    <ol class="mc-failure-state-steps">
      {#each steps as step (step)}
        <li>{step}</li>
      {/each}
    </ol>
  {/if}
</div>
