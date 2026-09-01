<script lang="ts">
  /*
   * Deleting a note.
   *
   * This is the one irreversible act on the notes surface, so it is a confirmation rather than a
   * click. What the dialog has to make unmissable is the pair of facts a reader needs before
   * pressing: the text is gone and cannot be recovered, and the documents the note pointed at are
   * not — deleting a note has never been a way to delete a document.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as AlertDialog from "@magna-carta/design-system/alert-dialog";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { deleteMatterNote, newWriteKey, type MatterNote } from "./notes-api.ts";

  let {
    open = $bindable(false),
    note,
    authorName,
    onDeleted,
  }: {
    open?: boolean;
    note: MatterNote | null;
    authorName: string;
    onDeleted: () => void;
  } = $props();

  let sending = $state(false);
  let failure = $state<string | null>(null);

  $effect(() => {
    const subject = note?.id ?? null;
    if (subject === null) return;
    failure = null;
  });

  const identity = $derived(note === null ? "" : `${authorName}, ${formatInstant(note.createdAt)}`);
  const attachedCount = $derived(note?.documents.length ?? 0);

  async function remove(): Promise<void> {
    if (note === null || sending) return;
    sending = true;
    failure = null;
    const outcome = await deleteMatterNote(fetch, note.id, newWriteKey());
    sending = false;
    if (outcome.kind === "ok") {
      open = false;
      onDeleted();
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The note was not deleted and is unchanged."
        : `${outcome.problem.detail ?? "The note was not deleted."}${
            outcome.problem.errorId === undefined ? "" : ` Error ID ${outcome.problem.errorId}.`
          }`;
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Title>Delete Note</AlertDialog.Title>
    <AlertDialog.Description>{identity}</AlertDialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Changed</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    <p class="text-sm">
      The note and its text are removed and cannot be recovered.
      {#if attachedCount > 0}
        The {attachedCount === 1 ? "document" : `${attachedCount} documents`} it points at
        {attachedCount === 1 ? "stays" : "stay"} in the matter&rsquo;s files, untouched.
      {/if}
    </p>

    <div class="flex justify-end gap-8">
      <AlertDialog.Cancel
        class={buttonClasses({ variant: "secondary", size: "default" })}
        disabled={sending}
      >
        Cancel
      </AlertDialog.Cancel>
      <!-- Bits' Action does not self-close: the write decides when the panel goes, so a refusal
           stays on screen with its reason rather than closing over it. -->
      <AlertDialog.Action
        class={buttonClasses({ variant: "destructive", size: "default" })}
        disabled={sending}
        title="Remove this note and its text"
        onclick={(event) => {
          event.preventDefault();
          void remove();
        }}
      >
        Delete Note
      </AlertDialog.Action>
    </div>
  </AlertDialog.Content>
</AlertDialog.Root>
