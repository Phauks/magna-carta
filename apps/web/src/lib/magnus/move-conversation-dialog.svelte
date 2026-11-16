<script lang="ts">
  /*
   * Keeping a conversation on another matter's file, or on none.
   *
   * WHICH MATTER A CONVERSATION IS KEPT ON DECIDES WHO MAY READ IT, so this is an access decision as
   * much as a filing one, and the dialog says so before the press rather than after. The matter
   * link still scopes only the RECORD: nothing of the matter's content reaches the assistant by
   * being kept there, and the sentence in the dialog says that too, because moving a conversation
   * onto a matter is exactly when a reader would assume the opposite.
   *
   * THE ATTACHMENTS GO WITH THE MOVE. Each is one of the old matter's files, and a conversation kept
   * elsewhere has no claim on it; the dialog counts them so nobody loses one by surprise.
   *
   * The picker offers every matter a member works on — the caseload, consultations and intakes —
   * through the same anchors the call log files onto; a closed matter is refused by the server with
   * its reason rather than hidden from the list.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { AnchorMatters } from "$lib/communications/anchor-matters.svelte.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import {
    conversationDisplayName,
    moveConversation,
    newWriteKey,
    type MagnusConversation,
  } from "./magnus-api.ts";

  let {
    open = $bindable(false),
    conversation,
    attachmentCount = 0,
    onMoved,
  }: {
    open?: boolean;
    /** The conversation being moved. Null while nothing is chosen, which keeps the dialog closed. */
    conversation: MagnusConversation | null;
    /** How many attachments the move takes off it, so the sentence can count them. */
    attachmentCount?: number;
    onMoved: (moved: MagnusConversation) => void;
  } = $props();

  const anchors = new AnchorMatters();
  let chosen = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);

  const subtitle = $derived<RecordSubject>(
    conversation === null ? {} : { facts: [conversationDisplayName(conversation)] },
  );
  const unchanged = $derived(conversation !== null && chosen === conversation.matterId);
  const refusal = $derived(
    unchanged ? "The conversation is already here." : undefined,
  );

  function reset(): void {
    chosen = conversation?.matterId ?? null;
    failure = null;
    void anchors.load(fetch);
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    if (conversation === null || unchanged) return "refused";
    const outcome = await moveConversation(fetch, conversation.id, chosen, newWriteKey());
    if (outcome.kind === "ok") {
      onMoved(outcome.value);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The conversation wasn't moved.",
      "Couldn't connect. The conversation wasn't moved. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Move to a Matter"
  {subtitle}
  commitLabel="Move It Here"
  commitBusyLabel="Moving"
  commitRefusal={refusal}
  unsavedChanges={!unchanged}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Not Moved"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
    {#if anchors.failure !== null}
      <p class="text-sm text-text-muted">{anchors.failure}</p>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label for="magnus-move-matter">Matter</Label>
      <MatterPicker
        matters={anchors.matters ?? []}
        capped={anchors.capped}
        disabled={busy || anchors.matters === null}
        inputId="magnus-move-matter"
        value={chosen}
        noMatterLabel="No matter"
        onpick={(picked) => (chosen = picked)}
      />
      <!-- The two facts a reader must hold before pressing: who can read it afterwards, and what
           goes with it. Neither is reassurance; both are consequences. -->
      <p class="text-sm text-text-muted">
        The matter decides who can read the conversation. On a matter, the transcript is part of that matter&rsquo;s file and follows its access. On no matter, only you and the firm&rsquo;s supervisors can read it. Magnus still can&rsquo;t read the matter.
        {#if attachmentCount === 1}
          The one file attached to it belongs to the current matter and is removed with the move.
        {:else if attachmentCount > 1}
          The {attachmentCount} files attached to it belong to the current matter and are removed with the move.
        {/if}
      </p>
    </div>
  {/snippet}
</ActionDialog>
