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
    /** The remedy, where there is one. A band with nothing to press renders no action row. */
    actions?: Snippet;
  } = $props();

  let copied = $state<CopyResult | null>(null);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

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
  {#if note !== undefined}
    <Alert.Description>{note}</Alert.Description>
  {/if}
  {#if errorId !== null || actions !== undefined}
    <div class="mc-failure-band-footer">
      {#if errorId === null}
        <span></span>
      {:else}
        <button
          type="button"
          class="mc-failure-band-error-id"
          onclick={copyErrorId}
          aria-label="Copy error ID {errorId}"
        >
          <span aria-hidden="true">{errorId}</span>
          <span class="mc-failure-band-error-id-hint" aria-live="polite">
            {#if copied === "copied"}
              copied
            {:else if copied === "failed"}
              select to copy
            {:else}
              copy
            {/if}
          </span>
        </button>
      {/if}
      {#if actions !== undefined}
        <span class="mc-failure-band-actions">{@render actions()}</span>
      {/if}
    </div>
  {/if}
</Alert.Root>
