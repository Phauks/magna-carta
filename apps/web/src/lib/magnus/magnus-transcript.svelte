<script lang="ts">
  /*
   * The transcript: one conversation's turns, oldest first, with the way to earlier ones and the
   * words for a turn that is waiting, that failed, or that was built on part of the conversation.
   *
   * It is laid out as an EXCHANGE (the design-system Conversation component's second arrangement):
   * the members who asked sit on the right under their own names, never "You", because a
   * conversation can be read by a colleague it was shared with, and "You" is a different person to
   * every reader; Magnus answers on the left behind the product's blackletter letter. Every turn can
   * be copied. The owner's rulings for this layout are in docs/conventions/magnus-rulings.md.
   *
   * It holds only the turns. The name, the acts on the conversation and the composer are the
   * surface's; this is the region between them, and it carries the same states every region owes:
   * loading (the fixture), empty (a conversation started and not asked in), failed (the notice with
   * Retry), and the ordinary one.
   */
  import * as Conversation from "@magna-carta/design-system/conversation";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    SAMPLE_SENTENCE,
    sampleInstant,
    samplePerson,
  } from "@magna-carta/design-system/loading-fixtures";
  import {
    formatTimeOfDay,
    instantAttribute,
    personInitials,
  } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Copy from "@lucide/svelte/icons/copy";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { conversationAuthor } from "./conversation-author.svelte.ts";
  import type { ConversationSession } from "./conversation-session.svelte.ts";
  import { turnFailureSentence, type MagnusTurn } from "./magnus-api.ts";

  let { session }: { session: ConversationSession } = $props();

  const turns = $derived(session.turns);

  /* Who asked, named the same way the surface names a downloaded transcript. */
  const author = conversationAuthor(() => session.conversation?.createdBy ?? null);
  const memberName = $derived(author.name);

  /** The speaker's name as a reader meets it. */
  function speakerName(turn: MagnusTurn): string {
    return turn.speaker === "member" ? memberName : "Magnus";
  }

  /** The letters in the turn's mark: the member's initials, or the assistant's M. */
  function speakerMark(turn: MagnusTurn): string {
    return turn.speaker === "member" ? personInitials(memberName) : "M";
  }

  function turnState(turn: MagnusTurn): "settled" | "pending" | "failed" {
    if (turn.status === "pending") return "pending";
    return turn.status === "complete" ? "settled" : "failed";
  }

  async function copyTurn(turn: MagnusTurn): Promise<void> {
    if (turn.content === null) return;
    try {
      await navigator.clipboard.writeText(turn.content);
      toast.success("Message copied.");
    } catch {
      // Some embedded and locked-down browsers refuse the clipboard. The words are still on the
      // screen to select by hand, so the sentence says which way is left.
      toast.error("Your browser would not copy it. Select the words and copy them instead.");
    }
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

{#snippet transcriptShape(shown: readonly MagnusTurn[], live: boolean)}
  <Conversation.Transcript arrangement="exchange" label="This conversation with Magnus">
    {#each shown as turn, index (turn.id)}
      {@const failureSentence = turnFailureSentence(turn)}
      {@const name = live ? speakerName(turn) : turn.speaker === "member" ? samplePerson(index).name : "Magnus"}
      <Conversation.Turn speaker={turn.speaker} state={turnState(turn)}>
        <Conversation.TurnMark>
          {live ? speakerMark(turn) : turn.speaker === "member" ? personInitials(name) : "M"}
        </Conversation.TurnMark>
        <Conversation.TurnContent>
          <Conversation.TurnSpeaker>
            <span>{name}</span>
            <time
              class="text-xs font-normal text-text-muted"
              datetime={instantAttribute(turn.createdAt)}
            >
              {formatTimeOfDay(turn.createdAt)}
            </time>
          </Conversation.TurnSpeaker>
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
              This answer was built from part of the conversation: the earlier messages did not
              fit. If what was dropped bears on the answer, restate it and ask again.
            </Conversation.TurnNote>
          {/if}
          {#if turn.content !== null && turn.status !== "pending"}
            <Conversation.TurnActions>
              <!-- The control names whose words it copies and when, because a long conversation
                   otherwise offers a screen reader a column of controls all called Copy. -->
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="ghost"
                      size="icon-sm"
                      disabled={!live}
                      aria-label="Copy what {name} said at {formatTimeOfDay(turn.createdAt)}"
                      onclick={() => void copyTurn(turn)}
                    >
                      <Copy class="size-16" aria-hidden="true" />
                    </Button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>Copy</Tooltip.Content>
              </Tooltip.Root>
            </Conversation.TurnActions>
          {/if}
        </Conversation.TurnContent>
      </Conversation.Turn>
    {/each}
  </Conversation.Transcript>
{/snippet}

{#snippet fixture()}
  {@render transcriptShape(FIXTURE_TURNS, false)}
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
  {@render transcriptShape(turns ?? [], true)}
</LoadingRegion>
