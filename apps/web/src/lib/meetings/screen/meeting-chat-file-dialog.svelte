<script lang="ts">
  /*
   * Sharing one of the matter's files in a meeting's chat: the Existing File half of the attach menu.
   *
   * The file is picked from the matter's own file store with the same control a waiver, a fee
   * arrangement and a Magnus conversation pick a document with, because a file chosen for a record
   * is chosen the same way everywhere. Pressing Share says a line in chat that points at the file;
   * what is typed in the message box goes with it.
   *
   * The dialog states the one consequence a reader must hold: everybody in the meeting can open the
   * file from the chat, for as long as they can read the meeting's record.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Label from "@magna-carta/design-system/label";
  import MatterDocumentPicker from "$lib/documents/matter-document-picker.svelte";

  let {
    open = $bindable(false),
    matterId,
    onShare,
  }: {
    open?: boolean;
    /** The meeting's matter, whose files may be shared. */
    matterId: string;
    /** Say the line. Answers whether it reached the record; a refusal is drawn by the chat. */
    onShare: (fileId: string) => Promise<boolean>;
  } = $props();

  let chosen = $state<string | null>(null);

  const refusal = $derived(chosen === null ? "Choose a file to share." : undefined);

  async function submit(): Promise<ActionOutcome> {
    if (chosen === null) return "refused";
    return (await onShare(chosen)) ? "committed" : "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Attach a File"
  commitLabel="Share"
  commitBusyLabel="Sharing"
  commitRefusal={refusal}
  unsavedChanges={chosen !== null}
  onOpen={() => (chosen = null)}
  onCommit={submit}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label for="meeting-chat-file">File</Label>
      <MatterDocumentPicker
        bind:value={chosen}
        {matterId}
        inputId="meeting-chat-file"
        fieldName="File"
        disabled={busy}
        noMatterNote="This meeting is kept on no matter, so there are no files to share."
        noFilesNote="This matter holds no files yet."
        chosenNoun="shared in this meeting's chat"
      />
      <p class="text-sm text-text-muted">
        Everybody in the meeting can open the file from the chat. It stays on the matter where it
        is.
      </p>
    </div>
  {/snippet}
</ActionDialog>
