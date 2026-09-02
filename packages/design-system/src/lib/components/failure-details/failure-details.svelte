<script lang="ts">
  /*
   * The diagnostics a failure hands over: the four facts a reader scans, and the whole trace a
   * report needs, with one control that puts the trace on the clipboard.
   *
   * THE FACTS ARE STATED, NOT HIDDEN BEHIND A CONSOLE. The person who can act on a request line and
   * an Error ID is the one looking at the screen, and asking them to open developer tools to find
   * what the app already knows is asking them to do our job.
   *
   * `trace` is always copied in full even where it is not shown — the summary rows are for reading,
   * the trace is for sending, and they are not the same job. `Copy` reports what actually happened:
   * the clipboard can be refused, and a button that claims success after a refusal sends somebody to
   * support with an empty paste.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Button from "../button/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { copyText, type CopyResult } from "./copy-text.ts";
  import type { FailureDetailRow } from "./types.ts";

  let {
    rows,
    trace,
    showTrace = false,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The facts worth scanning, in the order they answer "what failed, and when". */
    rows: readonly FailureDetailRow[];
    /**
     * The whole report, as one block of text. Copied whether or not it is shown.
     *
     * A FUNCTION, where the report carries a timestamp. The block is assembled when the failure
     * renders and copied whenever somebody presses the button, and on a crash screen left open those
     * are not the same minute — a fixed string would put a time in the report that reads as "when I
     * copied this" and is not. Pass a getter and it is re-read at the press.
     */
    trace: string | (() => string);
    /**
     * Render the trace as well as the rows. True where the failure owns the screen and there is room
     * to be complete; false in a panel, where the rows are already the answer and the trace would
     * bury it.
     */
    showTrace?: boolean;
  } = $props();

  const shown = $derived(typeof trace === "function" ? trace() : trace);

  let result = $state<CopyResult | null>(null);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    result = await copyText(typeof trace === "function" ? trace() : trace);
    clearTimeout(resetTimer);
    // A failure holds longer than a success: it carries an instruction the reader has to act on.
    resetTimer = setTimeout(() => (result = null), result === "copied" ? 2000 : 6000);
  }
</script>

<div
  bind:this={ref}
  class={mergeClasses("mc-failure-details w-full", className)}
  {...restProps}
>
  <dl class="mc-failure-details-facts">
    {#each rows as row (row.label)}
      <div class="mc-failure-details-row">
        <dt class="mc-failure-details-term">{row.label}</dt>
        <dd class={row.mono ? "mc-failure-details-value-mono" : "mc-failure-details-value"}>
          {row.value}
        </dd>
      </div>
    {/each}
  </dl>

  {#if showTrace}
    <pre class="mc-failure-details-trace">{shown}</pre>
  {/if}

  <div class="mc-failure-details-actions">
    <p class="mc-failure-details-status" aria-live="polite">
      {#if result === "copied"}
        <Check class="size-16" aria-hidden="true" />
        Copied
      {:else if result === "failed"}
        <TriangleAlert class="size-16" aria-hidden="true" />
        Your browser would not let us copy. Select the details and copy them.
      {/if}
    </p>
    <Button variant="secondary" size="sm" onclick={copy}>
      <Copy class="size-16" aria-hidden="true" />
      Copy details
    </Button>
  </div>
</div>
