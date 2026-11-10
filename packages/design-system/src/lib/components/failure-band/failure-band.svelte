<script lang="ts">
  /*
   * FailureBand — an action failed and the screen is otherwise fine. One line, the handle a report
   * needs, and the one control that moves the person forward.
   *
   * IT COMPOSES Alert RATHER THAN RESTATING IT. The tint, the hairline, the leading glyph and the
   * ARIA role are already the Alert's job; what this adds is the part that kept being hand-built at
   * every call site and kept coming out different — the Error ID beside the message, and an actions
   * row that is present only when there is something to press.
   *
   * The Error ID is a BUTTON, not decoration: it copies itself. A person reading it aloud to support
   * over the phone is fine, but most of the time they want it in a message, and eight characters
   * transcribed by hand is eight chances to send the wrong one.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import * as Alert from "../alert/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { copyText, type CopyResult } from "../failure-details/copy-text.ts";
  import type { AlertVariant } from "../alert/variants.ts";

  let {
    variant = "danger",
    title,
    message,
    note,
    errorId = null,
    children,
    actions,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The status register. Danger for a fault, warning for a limit, info for a next step. */
    variant?: AlertVariant;
    title: string;
    message: string;
    /** One more fact — attempts remaining, most often. */
    note?: string;
    /** The correlation handle, where the server issued one. Rendered as a copyable chip. */
    errorId?: string | null;
    /**
     * One more thing this surface has to say — a link to the setting that would fix it, most often.
     * Rendered after the message, inside the description, so it reads as part of the same sentence
     * rather than as a second alert.
     */
    children?: Snippet;
    /** The remedy, where there is one. A band with nothing to press renders no action row. */
    actions?: Snippet;
  } = $props();

  let copied = $state<CopyResult | null>(null);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  /** What pressing the chip does, or what the last press came to. */
  const copyHint = $derived(
    copied === "copied" ? "copied" : copied === "failed" ? "select to copy" : "copy",
  );

  async function copyErrorId(): Promise<void> {
    if (errorId === null) return;
    copied = await copyText(errorId);
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (copied = null), 2000);
  }
</script>

<Alert.Root {variant} bind:ref class={mergeClasses(className)} {...restProps}>
  <Alert.Title>{title}</Alert.Title>
  <Alert.Description>{message}</Alert.Description>
  {#if children !== undefined}
    <Alert.Description>{@render children()}</Alert.Description>
  {/if}
  {#if note !== undefined}
    <Alert.Description>{note}</Alert.Description>
  {/if}
  {#if errorId !== null || actions !== undefined}
    <div class="mc-failure-band-footer">
      {#if errorId === null}
        <span></span>
      {:else}
        <!-- The name reads the chip as it is drawn, ID first and then the hint, because a name
             has to hold the words a reader sees on the control and a speech user says those. -->
        <button
          type="button"
          class="mc-failure-band-error-id"
          onclick={copyErrorId}
          aria-label="Error ID {errorId}, {copyHint}"
        >
          <span>{errorId}</span>
          <span class="mc-failure-band-error-id-hint" aria-live="polite">{copyHint}</span>
        </button>
      {/if}
      {#if actions !== undefined}
        <span class="mc-failure-band-actions">{@render actions()}</span>
      {/if}
    </div>
  {/if}
</Alert.Root>
