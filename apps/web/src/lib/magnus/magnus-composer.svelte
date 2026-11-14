<script lang="ts">
  /*
   * The composer: where a question is typed, with the one honest line about what leaves the
   * platform and which model receives it, the files attached to the conversation, and the firm's
   * allowance when it is worth saying.
   *
   * THE DISCLOSURE LINE IS COMPOSED FROM WHAT IS TRUE. "Magnus reads only what you type" stops being
   * true the moment a file is attached, so the sentence is built from the attachment count rather
   * than written once (magnus-vocabulary.ts), and inside a matter it still says that keeping the
   * conversation on the file does not let the assistant read the file — standing inside a matter is
   * the whole reason a reader would assume the opposite.
   *
   * EACH ATTACHMENT STATES WHAT THE MODEL SAW. A file attached by reference has four outcomes on the
   * most recent question, and an answer built without the document it was asked about is a
   * different answer, so every row says which outcome it got. The Attach control stays on the row
   * when it cannot be pressed, refused with the reason, rather than disappearing.
   *
   * THE MODEL LINE NAMES WHAT WILL ANSWER. The member may choose a model and effort for the next
   * question (model-picker.svelte); the line beside the disclosure names the chosen model, not the
   * firm's, because that is the one the question will be sent to.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as Conversation from "@magna-carta/design-system/conversation";
  import * as Popover from "@magna-carta/design-system/popover";
  import Textarea from "@magna-carta/design-system/textarea";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import FileText from "@lucide/svelte/icons/file-text";
  import Info from "@lucide/svelte/icons/info";
  import X from "@lucide/svelte/icons/x";
  import type {
    MagnusAnsweringModel,
    MagnusAttachment,
    MagnusModelChoice,
  } from "./magnus-api.ts";
  import ModelPicker from "./model-picker.svelte";
  import {
    answeringModelLine,
    attachmentName,
    attachmentStatusSentence,
    composerDisclosureLine,
  } from "./magnus-vocabulary.ts";

  let {
    draft = $bindable(""),
    composerElement = $bindable(null),
    onMatter,
    attachments,
    readsEarlierConversations = false,
    model,
    models = [],
    choice = $bindable(null),
    sending = false,
    editing = false,
    onCancelEdit,
    sendRefused = false,
    allowanceSpent = false,
    remainingDailyTurns,
    allowanceWorthSaying = false,
    attachRefusal,
    detachingFileId = null,
    onSend,
    onAttach,
    onDetach,
  }: {
    draft?: string;
    composerElement?: HTMLTextAreaElement | null;
    /** True inside a matter, where the disclosure line owes one more sentence. */
    onMatter: boolean;
    attachments: readonly MagnusAttachment[];
    /** True when this conversation also reads the author's other conversations on the matter. */
    readsEarlierConversations?: boolean;
    /** Which model answers; undefined before the read lands, null where the firm's choice is gone. */
    model: MagnusAnsweringModel | null | undefined;
    /** Every model the member may choose; empty where the server offered none. */
    models?: readonly MagnusAnsweringModel[];
    /** The member's choice for the next question, or null for the firm's model. */
    choice?: MagnusModelChoice | null;
    sending?: boolean;
    /** True while the member is rewriting one of their messages rather than asking a new one. */
    editing?: boolean;
    /** Stop editing and put the composer back to asking. */
    onCancelEdit?: () => void;
    sendRefused?: boolean;
    allowanceSpent?: boolean;
    remainingDailyTurns?: number | undefined;
    allowanceWorthSaying?: boolean;
    /** Why a file cannot be attached right now, or undefined while one can. */
    attachRefusal?: string | undefined;
    detachingFileId?: string | null;
    onSend: () => void;
    onAttach: () => void;
    onDetach: (fileId: string) => void;
  } = $props();

  function composerKeydown(event: KeyboardEvent): void {
    // Enter sends and Shift+Enter starts a new line (owner ruling, 2026-11-14). A key pressed while
    // an input method is still composing a word belongs to that word, so it never sends.
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    onSend();
  }

  const answering = $derived(
    choice === null || model === null || model === undefined
      ? model
      : (models.find((candidate) => candidate.modelId === choice?.modelId) ?? model),
  );
  const modelLine = $derived(answeringModelLine(answering));
</script>

<!-- The owner's board (round 2): one card holding the attached files as chips, the field, and a
     row of controls under it: attach on the start side; the model, what Magnus reads, and Send on
     the end side. What Magnus reads sits behind the Info control rather than over the field, and the
     allowance still says itself when it is about to bind. -->
<Conversation.Composer class="border-t-0 pt-8 pb-16">
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-8">
    {#if editing}
      <p
        class="flex flex-wrap items-center justify-between gap-8 rounded-md border border-border-default bg-surface-sunken px-12 py-8 text-sm"
      >
        <span>
          Editing your message. Sending it asks Magnus again from here and sets aside the replies after it.
        </span>
        <Button variant="ghost" size="sm" onclick={() => onCancelEdit?.()}>Cancel Edit</Button>
      </p>
    {/if}
    <div
      class="flex flex-col rounded-lg border border-border-field bg-surface-field focus-within:border-border-focus"
    >
      {#if attachments.length > 0}
        <ul class="flex flex-wrap gap-8 px-12 pt-12" aria-label="Files attached to this conversation">
          {#each attachments as attachment (attachment.fileId)}
            <li
              class="flex max-w-full min-w-0 items-center gap-4 rounded-md border border-border-default bg-surface-sunken py-2 ps-8 pe-2 text-xs"
              title={attachmentStatusSentence(attachment)}
            >
              <FileText class="size-12 shrink-0 text-text-muted" aria-hidden="true" />
              <span class="truncate font-medium">{attachmentName(attachment)}</span>
              <span class="sr-only">{attachmentStatusSentence(attachment)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={detachingFileId === attachment.fileId}
                onclick={() => onDetach(attachment.fileId)}
                aria-label="Take {attachmentName(attachment)} off this conversation"
              >
                <X class="size-12" aria-hidden="true" />
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
      <label for="magnus-composer" class="sr-only">
        {editing ? "Your edited message" : "Your message"}
      </label>
      <Textarea
        id="magnus-composer"
        bind:ref={composerElement}
        bind:value={draft}
        rows={2}
        placeholder="Ask Magnus"
        class="resize-none border-none bg-transparent shadow-none focus-visible:outline-none"
        disabled={sendRefused}
        onkeydown={composerKeydown}
      />
      <div class="flex flex-wrap items-center justify-between gap-8 px-8 pb-8">
        <div class="flex items-center gap-4">
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Attach files"
                  disabled={attachRefusal !== undefined}
                  onclick={onAttach}
                >
                  <Paperclip class="size-16" aria-hidden="true" />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">{attachRefusal ?? "Attach Files"}</Tooltip.Content>
          </Tooltip.Root>
        </div>
        <div class="flex min-w-0 flex-wrap items-center justify-end gap-4">
          {#if model !== null && model !== undefined && models.length > 0}
            <ModelPicker bind:choice firmModel={model} {models} disabled={sendRefused} />
          {/if}
          <Popover.Root>
            <Popover.Trigger
              class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
              aria-label="What Magnus reads, and the firm's allowance"
            >
              <Info class="size-16" aria-hidden="true" />
            </Popover.Trigger>
            <Popover.Content class="flex w-xs flex-col gap-8 text-sm">
              <p>
                {composerDisclosureLine({
                  onMatter,
                  attachmentCount: attachments.length,
                  readsEarlierConversations,
                })}
                {#if modelLine !== ""}
                  {modelLine}
                {/if}
              </p>
              {#if remainingDailyTurns !== undefined}
                <p class="text-text-muted">
                  {remainingDailyTurns === 1
                    ? "One message left in the firm's daily allowance today."
                    : `${String(remainingDailyTurns)} messages left in the firm's daily allowance today.`}
                </p>
              {/if}
            </Popover.Content>
          </Popover.Root>
          <Button
            size="icon-sm"
            onclick={onSend}
            disabled={draft.trim() === "" || sendRefused}
            aria-label={sending ? "Sending" : editing ? "Send Edit" : "Send"}
            title={allowanceSpent
              ? "The firm's daily allowance for Magnus is spent."
              : "Send this message to Magnus."}
          >
            <ArrowUp class="size-16" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
    {#if allowanceSpent}
      <p class="text-sm text-text-muted">
        The firm&rsquo;s daily allowance for Magnus is spent. It resets tomorrow. An administrator can raise it in the firm&rsquo;s settings.
      </p>
    {:else if allowanceWorthSaying && remainingDailyTurns !== undefined}
      <p class="text-sm text-text-muted">
        {remainingDailyTurns === 1
          ? "One message left in the firm's daily allowance today."
          : `${String(remainingDailyTurns)} messages left in the firm's daily allowance today.`}
      </p>
    {/if}
  </div>
</Conversation.Composer>
