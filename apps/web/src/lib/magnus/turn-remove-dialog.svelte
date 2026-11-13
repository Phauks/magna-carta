<script lang="ts">
  /*
   * Removing one of your own messages.
   *
   * A removal takes the message and Magnus's answer to it out of the conversation and out of what
   * Magnus reads, and leaves a marker where they were. It does NOT erase them: a transcript is the
   * firm's work product, erased only when the whole conversation is deleted. The dialog says both
   * halves, because a member who expects the words to be gone has to learn otherwise before pressing.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { ConversationSession } from "./conversation-session.svelte.ts";
  import type { MagnusTurn } from "./magnus-api.ts";

  let {
    open = $bindable(false),
    session,
    turn,
  }: {
    open?: boolean;
    session: ConversationSession;
    /** The member's message being removed. */
    turn: MagnusTurn | null;
  } = $props();

  let failure = $state<StatedFailure | null>(null);

  async function remove(): Promise<ActionOutcome> {
    if (turn === null) return "refused";
    failure = null;
    const outcome = await session.remove(turn.id);
    if (outcome?.kind === "ok") return "committed";
    failure =
      outcome === null
        ? null
        : stated(
            outcome.failure,
            "The message was not removed.",
            "Nothing answered. The message was not removed and is unchanged.",
          );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Remove Message"
  commitLabel="Remove Message"
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
      Your message and Magnus&rsquo;s answer to it leave this conversation, and Magnus does not read
      them again. A note shows where they were.
    </p>
    <p class="text-sm">
      They are not erased. They stay on the firm&rsquo;s record, where a colleague allowed to read
      every conversation can still see them, until the whole conversation is deleted.
    </p>
  {/snippet}
</ActionDialog>
