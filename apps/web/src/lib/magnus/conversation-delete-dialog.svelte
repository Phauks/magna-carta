<script lang="ts">
  /*
   * Deleting a conversation.
   *
   * This is the erasure instrument for everything typed into the assistant: the turns go wholesale
   * rather than being redacted line by line, and what stays on the firm's record is that a
   * conversation existed and was deleted, never what was in it. So the dialog states the two facts
   * a reader needs before pressing, and neither of them is softened.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    conversationDisplayName,
    deleteConversation,
    newWriteKey,
    type MagnusConversation,
  } from "./magnus-api.ts";

  let {
    open = $bindable(false),
    conversation,
    onDeleted,
  }: {
    open?: boolean;
    conversation: MagnusConversation | null;
    onDeleted: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);

  const subtitle = $derived<RecordSubject>(
    // A conversation carries no number anybody reads back, so what names it here is what names it
    // in the list: the words it was given. The empty case renders no line rather than an empty one.
    conversation === null ? {} : { facts: [conversationDisplayName(conversation)] },
  );

  async function remove(): Promise<ActionOutcome> {
    if (conversation === null) return "refused";
    failure = null;
    const outcome = await deleteConversation(fetch, conversation.id, newWriteKey());
    if (outcome.kind === "ok") {
      onDeleted();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The conversation wasn't deleted.",
      "Couldn't connect. The conversation wasn't deleted. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Delete Conversation"
  {subtitle}
  commitLabel="Delete Conversation"
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
      Every message in this conversation is deleted and can&rsquo;t be recovered. The firm&rsquo;s record shows only that a conversation existed and was deleted, not what was in it.
    </p>
  {/snippet}
</ActionDialog>
