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
  import Button from "@magna-carta/design-system/button";
  import * as Conversation from "@magna-carta/design-system/conversation";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
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
    // Enter writes a newline, because a question worth asking often runs past one line. The visible
    // way to send is the button beside the field; this is the shortcut for a reader who prefers it.
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
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

<Conversation.Composer>
  <!-- One flowing line, not stacked sentences: what the assistant reads, and which model reads it. -->
  <p class="text-sm text-text-muted">
    {composerDisclosureLine({ onMatter, attachmentCount: attachments.length })}
    {#if modelLine !== ""}
      {modelLine}
    {/if}
  </p>

  {#if attachments.length > 0}
    <ul class="flex flex-col gap-4" aria-label="Files attached to this conversation">
      {#each attachments as attachment (attachment.fileId)}
        <li class="flex items-start justify-between gap-8">
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-sm font-medium">{attachmentName(attachment)}</span>
            <span class="text-xs text-text-muted">{attachmentStatusSentence(attachment)}</span>
          </span>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  disabled={detachingFileId === attachment.fileId}
                  onclick={() => onDetach(attachment.fileId)}
                  aria-label="Take {attachmentName(attachment)} off this conversation"
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>Remove</Tooltip.Content>
          </Tooltip.Root>
        </li>
      {/each}
    </ul>
  {/if}

  {#if editing}
    <!-- Editing is a mode the composer is in, so it says so above the field and offers the way out
         beside the sentence rather than leaving the reader to guess that Send now does something
         different. -->
    <p class="flex items-center justify-between gap-8 text-sm">
      <span>
        Editing your message. Sending it asks Magnus again from there; the replies after it are set
        aside.
      </span>
      <Button variant="ghost" size="sm" onclick={() => onCancelEdit?.()}>Cancel Edit</Button>
    </p>
  {/if}
  <Label for="magnus-composer">{editing ? "Your edited message" : "Your message"}</Label>
  <Textarea
    id="magnus-composer"
    bind:ref={composerElement}
    bind:value={draft}
    rows={3}
    disabled={sendRefused}
    onkeydown={composerKeydown}
  />
  {#snippet actions()}
    {#if model !== null && model !== undefined && models.length > 0}
      <ModelPicker bind:choice firmModel={model} {models} disabled={sendRefused} />
    {/if}
    <!-- The attach control is a named control on the row, refused with its reason when it cannot
         be pressed: a conversation on no matter has no files to reach, and a picker that vanished
         would leave the reader wondering where the capability went. -->
    <Button
      variant="secondary"
      onclick={onAttach}
      disabled={attachRefusal !== undefined}
      title={attachRefusal ?? "Attach one of the matter's files to this conversation."}
    >
      <Paperclip aria-hidden="true" />
      Attach a File
    </Button>
    <Button
      onclick={onSend}
      disabled={draft.trim() === "" || sendRefused}
      title={allowanceSpent
        ? "The firm's daily allowance for Magnus is spent."
        : "Send this message to Magnus."}
    >
      <SendHorizontal aria-hidden="true" />
      {sending ? "Sending" : editing ? "Send Edit" : "Send"}
    </Button>
  {/snippet}
  {#if allowanceSpent}
    <p class="text-sm text-text-muted">
      The firm&rsquo;s daily allowance for Magnus is spent. It resets tomorrow, and an administrator
      can raise it in the firm&rsquo;s settings.
    </p>
  {:else if allowanceWorthSaying && remainingDailyTurns !== undefined}
    <p class="text-sm text-text-muted">
      {remainingDailyTurns === 1
        ? "One message left in the firm's daily allowance today."
        : `${String(remainingDailyTurns)} messages left in the firm's daily allowance today.`}
    </p>
  {/if}
</Conversation.Composer>
