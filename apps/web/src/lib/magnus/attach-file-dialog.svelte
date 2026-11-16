<script lang="ts">
  /*
   * Attaching one of the matter's files to a conversation, by reference.
   *
   * The file is picked from the matter's own file store, never typed and never uploaded here: the
   * conversation records a reference, and on each later question the file's current version is read
   * and its readable text sent ahead of the question. So the dialog states the one consequence a
   * reader must hold before pressing — the file's text will leave the platform with the next
   * question — and what it will do if the file has no readable text, because a scan with no words
   * in it attaches fine and sends nothing.
   *
   * The picker is the same control the conflicts waiver and the fee arrangement pick a document
   * with (the precedent the owner named), because a file chosen for a record is chosen the same way
   * everywhere.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MatterDocumentPicker from "$lib/documents/matter-document-picker.svelte";
  import {
    attachFile,
    conversationDisplayName,
    newWriteKey,
    type MagnusAttachment,
    type MagnusConversation,
  } from "./magnus-api.ts";

  let {
    open = $bindable(false),
    conversation,
    onAttached,
  }: {
    open?: boolean;
    /** The conversation the file joins. Null while nothing is chosen, which keeps the dialog closed. */
    conversation: MagnusConversation | null;
    onAttached: (attachments: readonly MagnusAttachment[]) => void;
  } = $props();

  let chosen = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);

  const subtitle = $derived<RecordSubject>(
    conversation === null ? {} : { facts: [conversationDisplayName(conversation)] },
  );
  const refusal = $derived(chosen === null ? "Choose a file to attach." : undefined);

  function reset(): void {
    chosen = null;
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    if (conversation === null || chosen === null) return "refused";
    const outcome = await attachFile(fetch, conversation.id, chosen, newWriteKey());
    if (outcome.kind === "ok") {
      onAttached(outcome.value);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The file wasn't attached.",
      "Couldn't connect. The file wasn't attached. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Attach a File"
  {subtitle}
  commitLabel="Attach It"
  commitBusyLabel="Attaching"
  commitRefusal={refusal}
  unsavedChanges={chosen !== null}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Not Attached"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label for="magnus-attach-file">File</Label>
      <MatterDocumentPicker
        bind:value={chosen}
        matterId={conversation?.matterId ?? null}
        inputId="magnus-attach-file"
        fieldName="File"
        disabled={busy}
        noMatterNote="This conversation isn't on a matter, so there are no files to attach. Move it to a matter first."
        noFilesNote="This matter has no files yet."
        chosenNoun="attached to this conversation"
      />
      <p class="text-sm text-text-muted">
        Magnus reads the file&rsquo;s text with every question from now on. A file with no readable text attaches but sends nothing, and the conversation shows that beside it.
      </p>
    </div>
  {/snippet}
</ActionDialog>
