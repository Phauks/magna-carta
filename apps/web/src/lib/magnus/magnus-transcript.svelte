<script lang="ts">
  /*
   * The transcript: one conversation's turns, oldest first, with the way to earlier ones and the
   * words for a turn that is waiting, that failed, or that was built on part of the conversation.
   *
   * It reads as a RECORD, not a chat window (the design-system Conversation component says why),
   * and it holds only the turns. The name, the acts on the conversation and the composer are the
   * surface's; this is the region between them, and it carries the same states every region owes:
   * loading (the fixture), empty (a conversation started and not asked in), failed (the notice with
   * Retry), and the ordinary one.
   */
  import * as Conversation from "@magna-carta/design-system/conversation";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { ConversationSession } from "./conversation-session.svelte.ts";
  import { turnFailureSentence, type MagnusTurn } from "./magnus-api.ts";

  let { session }: { session: ConversationSession } = $props();

  const turns = $derived(session.turns);

  /** The speaker's name as a reader meets it. */
  function speakerName(turn: MagnusTurn): string {
    return turn.speaker === "member" ? "You" : "Magnus";
  }

  function turnState(turn: MagnusTurn): "settled" | "pending" | "failed" {
    if (turn.status === "pending") return "pending";
    return turn.status === "complete" ? "settled" : "failed";
  }

  const FIXTURE_TURNS: readonly MagnusTurn[] = [
    {
      id: "fixture-turn-0",
      sequence: 1,
      speaker: "member",
      content: SAMPLE_SENTENCE,
      status: "complete",
      failureLabel: null,
      modelId: null,
      snapshotId: null,
      contextTruncated: false,
      createdAt: sampleInstant(0),
      completedAt: sampleInstant(0),
    },
    {
      id: "fixture-turn-1",
      sequence: 2,
      speaker: "magnus",
      content: SAMPLE_SENTENCE,
      status: "complete",
      failureLabel: null,
      modelId: null,
      snapshotId: null,
      contextTruncated: false,
      createdAt: sampleInstant(1),
      completedAt: sampleInstant(1),
    },
  ];
</script>

{#snippet transcriptShape(shown: readonly MagnusTurn[])}
  <Conversation.Transcript>
    {#each shown as turn (turn.id)}
      {@const failureSentence = turnFailureSentence(turn)}
      <Conversation.Turn speaker={turn.speaker} state={turnState(turn)}>
        <Conversation.TurnSpeaker>{speakerName(turn)}</Conversation.TurnSpeaker>
        {#if turn.content !== null}
          <Conversation.TurnBody>{turn.content}</Conversation.TurnBody>
        {/if}
        {#if turn.status === "pending"}
          {#if session.answerIsSlow}
            <Conversation.TurnNote tone="warning">
              Magnus is still answering. This is taking longer than it should. The question is on
              the record and the answer appears here if it arrives; you can ask something else in
              the meantime, or come back to this conversation later.
            </Conversation.TurnNote>
          {:else}
            <Conversation.TurnNote tone="quiet">Magnus is answering.</Conversation.TurnNote>
          {/if}
        {/if}
        {#if failureSentence !== null}
          <Conversation.TurnNote tone="warning">{failureSentence}</Conversation.TurnNote>
        {/if}
        {#if turn.contextTruncated}
          <Conversation.TurnNote tone="warning">
            This answer was built from part of the conversation: the earlier messages did not fit.
            If what was dropped bears on the answer, restate it and ask again.
          </Conversation.TurnNote>
        {/if}
      </Conversation.Turn>
    {/each}
  </Conversation.Transcript>
{/snippet}

{#snippet fixture()}
  {@render transcriptShape(FIXTURE_TURNS)}
{/snippet}

<LoadingRegion
  loading={turns === null}
  failed={session.failure !== null && (turns?.length ?? 0) === 0}
  empty={session.failure === null && turns !== null && turns.length === 0}
  label="Reading this conversation"
  onRetry={() => session.reload()}
  {fixture}
  class="flex min-h-0 flex-1 flex-col gap-8"
>
  {#snippet emptyState()}
    <!-- A conversation is written when the first question is sent, so this is the narrow case
         where the record was created and the question that would have filled it was not. -->
    <div class="flex min-h-0 flex-1 items-center justify-center px-24">
      <EmptyState title="Nothing In This Conversation">
        This conversation was started and nothing was asked in it. Type a question below.
      </EmptyState>
    </div>
  {/snippet}
  {#snippet failure()}
    {#if session.failure !== null}
      <FailureNotice
        failure={session.failure}
        title="This Conversation Could Not Be Read"
        fallback="The messages in this conversation could not be read."
        onRetry={() => session.reload()}
      />
    {/if}
  {/snippet}
  {#if session.earlierCursor !== null}
    <div class="flex justify-center px-24 pt-8">
      <Button variant="ghost" disabled={session.loadingEarlier} onclick={() => session.loadEarlier()}>
        Show earlier messages
      </Button>
    </div>
  {/if}
  {#if session.failure !== null && (turns?.length ?? 0) > 0}
    <!-- A read that did not land over messages that did. What is on screen was read and stands. -->
    <div class="px-24">
      <FailureNotice
        failure={session.failure}
        title="The Rest Of This Conversation Could Not Be Read"
        fallback="More of this conversation could not be read. What is shown was read and stands."
        onRetry={() => session.resumePolling()}
      />
    </div>
  {/if}
  {@render transcriptShape(turns ?? [])}
</LoadingRegion>
