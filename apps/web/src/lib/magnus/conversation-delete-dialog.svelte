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

  const identity = $derived(conversation === null ? "" : conversationDisplayName(conversation));

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
      "The conversation was not deleted.",
      "Nothing answered. The conversation was not deleted and is unchanged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Delete Conversation"
  subtitle={identity}
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
      Every message in this conversation, yours and the answers, is removed and cannot be recovered.
      What stays on the firm&rsquo;s record is that a conversation existed and was deleted, never
      what was in it.
    </p>
  {/snippet}
</ActionDialog>
