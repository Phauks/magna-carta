<script lang="ts">
  /*
   * Removing a folder.
   *
   * Nothing in the folder is lost: its conversations go back to General. What cannot be put back is
   * the folder itself, which made again is a new folder with nothing in it, so the dialog says both.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { ConversationShelf } from "./conversation-shelf.svelte.ts";
  import type { MagnusFolder } from "./magnus-api.ts";

  let {
    open = $bindable(false),
    shelf,
    folder,
    onRemoved,
  }: {
    open?: boolean;
    shelf: ConversationShelf;
    folder: MagnusFolder | null;
    /** Called once the folder is gone, so General is read again with what it held. */
    onRemoved: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);

  const subtitle = $derived<RecordSubject>(folder === null ? {} : { facts: [folder.name] });

  async function remove(): Promise<ActionOutcome> {
    if (folder === null) return "refused";
    failure = null;
    const outcome = await shelf.remove(folder.id);
    if (outcome.kind === "ok") {
      onRemoved();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The folder wasn't removed.",
      "Couldn't connect. The folder wasn't removed. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Remove Folder"
  {subtitle}
  commitLabel="Remove Folder"
  commitBusyLabel="Removing"
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
      Conversations in this folder move to General. No conversation is deleted.
    </p>
  {/snippet}
</ActionDialog>
