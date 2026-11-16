<script lang="ts">
  /*
   * Removing one of your own messages.
   *
   * A removal takes the message out of the conversation and leaves a marker where it was. Magnus's
   * answer stays readable, and neither is read by Magnus again. It does NOT erase them: a transcript is the
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
            "The message wasn't removed.",
            "Couldn't connect. The message wasn't removed. Try again.",
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
    {#if session.pendingTurn !== null}
      <p class="text-sm">
        Your message is removed from this conversation, and a note marks where it was. Magnus is still answering, and removing the message stops that answer. Magnus won't read the message again.
      </p>
    {:else}
      <p class="text-sm">
        Your message is removed from this conversation, and a note marks where it was. Magnus&rsquo;s answer stays visible, but Magnus won&rsquo;t read either one again.
      </p>
    {/if}
    <p class="text-sm">
      Neither is deleted. They stay on the firm&rsquo;s record until the whole conversation is deleted, and staff allowed to read every conversation can still see them.
    </p>
  {/snippet}
</ActionDialog>
