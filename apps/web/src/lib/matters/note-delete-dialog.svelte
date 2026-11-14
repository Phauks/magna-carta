<script lang="ts">
  /*
   * Deleting a note.
   *
   * This is the one irreversible act on the notes surface, so it is a confirmation rather than a
   * click. What the dialog has to make unmissable is the pair of facts a reader needs before
   * pressing: the text is gone and cannot be recovered, and the documents the note pointed at are
   * not — deleting a note has never been a way to delete a document.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
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

  let failure = $state<StatedFailure | null>(null);

  const subtitle = $derived<RecordSubject>(
    note === null ? {} : { facts: [authorName, formatInstant(note.createdAt)] },
  );
  const attachedCount = $derived(note?.documents.length ?? 0);

  async function remove(): Promise<ActionOutcome> {
    if (note === null) return "refused";
    failure = null;
    const outcome = await deleteMatterNote(fetch, note.id, newWriteKey());
    if (outcome.kind === "ok") {
      onDeleted();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The note was not deleted.",
      "Couldn't connect. The note wasn't deleted.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Delete Note"
  {subtitle}
  commitLabel="Delete Note"
  commitBusyLabel="Deleting"
  unsavedChanges={false}
  onOpen={() => (failure = null)}
  onCommit={remove}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    <p class="text-sm">
      The note and its text are removed and cannot be recovered.
      {#if attachedCount > 0}
        The {attachedCount === 1 ? "document" : `${attachedCount} documents`} it points at
        {attachedCount === 1 ? "stays" : "stay"} in the matter&rsquo;s files, untouched.
      {/if}
    </p>
  {/snippet}
</ActionDialog>
