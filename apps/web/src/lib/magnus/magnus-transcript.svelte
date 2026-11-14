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
   *
   * A member's own message can be edited or removed (the owner's ruling R2.5). Neither erases
   * anything. An edit asks again from that message: the turns it set aside are left out of the
   * transcript, and the new message says "Edited". A removal leaves a marker where the message and
   * its answer were. The words of both stay on the firm's record until the whole conversation is
   * deleted.
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
    formatInstant,
    instantAttribute,
    personInitials,
  } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Copy from "@lucide/svelte/icons/copy";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { conversationAuthor } from "./conversation-author.svelte.ts";
  import type { ConversationSession } from "./conversation-session.svelte.ts";
  import MarkedText from "$lib/search/marked-text.svelte";
  import TurnThinking from "./turn-thinking.svelte";
  import { findMarks, shownTurns } from "./conversation-find.ts";
  import { versionsWrittenBy } from "./artifact-text.ts";
  import FileText from "@lucide/svelte/icons/file-text";
  import { turnFailureSentence, type MagnusTurn } from "./magnus-api.ts";

  let {
    session,
    onEdit,
    onRemove,
    find = "",
    currentMatchId = null,
    onOpenDocument,
  }: {
    session: ConversationSession;
    /** Words being found in this conversation, already trimmed; marked wherever they stand. */
    find?: string;
    /** The message the find has stepped to, brought into view. */
    currentMatchId?: string | null;
    /** Start editing one of the reader's own messages. */
    onEdit?: (turn: MagnusTurn) => void;
    /** Ask to remove one of the reader's own messages and its answer. */
    onRemove?: (turn: MagnusTurn) => void;
    /** Open a document an answer wrote, at the version it wrote, in the pane. */
    onOpenDocument?: (artifactId: string, versionNumber: number) => void;
  } = $props();

  /*
   * What the transcript shows: every turn except those an edit set aside, and except a removed
   * answer whose words the reader is not shown (its question's marker stands for both).
   */
  const turns = $derived(session.turns === null ? null : shownTurns(session.turns));

  /*
   * Bring the message a find stepped to into view. Only the live transcript stamps a turn's id (the
   * loading fixture's turns carry none), and an id names one turn, so the document is searched.
   */
  $effect(() => {
    if (currentMatchId === null || turns === null) return;
    const target = document.querySelector(`[data-turn-id="${CSS.escape(currentMatchId)}"]`);
    target?.scrollIntoView({ block: "center" });
  });
  /** Nothing in the conversation is being answered, so a message may be changed. */
  const settled = $derived((turns ?? []).every((turn) => turn.status !== "pending"));

  /* Who asked, named the same way the surface names a downloaded transcript. */
  const author = conversationAuthor(() => session.conversation?.createdBy ?? null);
  const memberName = $derived(author.name);
  /** The reader started the conversation, so its messages are theirs to edit or remove. */
  const ownMessages = $derived(author.readerIsAuthor);

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
      effort: null,
      thinking: null,
      removedAt: null,
      supersededAt: null,
      replacesTurnId: null,
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
      effort: null,
      thinking: null,
      removedAt: null,
      supersededAt: null,
      replacesTurnId: null,
      createdAt: sampleInstant(1),
      completedAt: sampleInstant(1),
    },
  ];
</script>

{#snippet transcriptShape(shown: readonly MagnusTurn[], live: boolean)}
  <Conversation.Transcript
    arrangement="exchange"
    label="This conversation with Magnus"
    class="*:mx-auto *:w-full *:max-w-5xl"
  >
    {#each shown as turn, index (turn.id)}
      {@const failureSentence = turnFailureSentence(turn)}
      {@const name = live ? speakerName(turn) : turn.speaker === "member" ? samplePerson(index).name : "Magnus"}
      <Conversation.Turn
        class="group/turn"
        speaker={turn.speaker}
        state={turnState(turn)}
        data-turn-id={live ? turn.id : undefined}
      >
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
              {formatInstant(turn.createdAt)}
            </time>
            {#if turn.replacesTurnId !== null}
              <span class="text-xs font-normal text-text-muted">Edited</span>
            {/if}
          </Conversation.TurnSpeaker>
          {#if turn.removedAt !== null}
            <Conversation.TurnNote tone="quiet">
              {turn.speaker === "member"
                ? `${name} removed this message. It is kept on the firm's record, and Magnus no longer reads it or the answer to it.`
                : "Removed with the message it answered."}
            </Conversation.TurnNote>
          {/if}
          {#if turn.speaker === "magnus" && turn.removedAt === null}
            <TurnThinking thinking={turn.thinking} pending={turn.status === "pending"} />
          {/if}
          {#if turn.content !== null}
            <!-- No whitespace inside the body: it keeps the author's line breaks, so any would show. -->
            <Conversation.TurnBody
              >{#if live && find !== ""}<MarkedText
                  text={turn.content}
                  marks={findMarks(turn.content, find)}
                />{:else}{turn.content}{/if}</Conversation.TurnBody
            >
          {/if}
          {#if live && turn.speaker === "magnus" && turn.removedAt === null}
            <!-- A document the answer wrote is kept beside the conversation with its versions, so
                 the answer carries a card for it rather than its whole text. -->
            {#each versionsWrittenBy(session.artifacts, turn.id) as written (written.artifact.id)}
              <button
                type="button"
                class="flex w-full max-w-md items-center gap-12 rounded-md border border-border-default bg-surface-raised px-12 py-8 text-left hover:border-border-strong"
                onclick={() => onOpenDocument?.(written.artifact.id, written.version.versionNumber)}
              >
                <FileText class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
                <span class="flex min-w-0 flex-1 flex-col gap-2">
                  <span class="truncate text-sm font-semibold">{written.artifact.title}</span>
                  <span class="text-xs text-text-muted">
                    Version {written.version.versionNumber} of {written.artifact.versions.length}{written
                      .version.note !== null
                      ? ` · ${written.version.note}`
                      : ""}
                  </span>
                </span>
                <span class="text-sm font-medium text-text-muted">Open</span>
              </button>
            {/each}
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
          {#if turn.content !== null && turn.status !== "pending" && turn.removedAt === null}
            <!-- The owner's ruling (2026-11-14): the acts on a message show while the pointer is over it or
                 focus is inside it, and always on a touch screen, which has no hover. -->
            <Conversation.TurnActions
              class="opacity-0 transition-opacity group-focus-within/turn:opacity-100 group-hover/turn:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"
            >
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
                      aria-label="Copy what {name} said at {formatInstant(turn.createdAt)}"
                      onclick={() => void copyTurn(turn)}
                    >
                      <Copy class="size-16" aria-hidden="true" />
                    </Button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>Copy</Tooltip.Content>
              </Tooltip.Root>
              {#if live && ownMessages && turn.speaker === "member"}
                {#if onEdit !== undefined}
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="icon-sm"
                          disabled={!settled}
                          aria-label="Edit your message from {formatInstant(turn.createdAt)}"
                          onclick={() => onEdit?.(turn)}
                        >
                          <PencilLine class="size-16" aria-hidden="true" />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {settled ? "Edit and Ask Again" : "Wait for the answer to finish"}
                    </Tooltip.Content>
                  </Tooltip.Root>
                {/if}
                {#if onRemove !== undefined}
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="icon-sm"
                          disabled={!settled}
                          aria-label="Remove your message from {formatInstant(turn.createdAt)}"
                          onclick={() => onRemove?.(turn)}
                        >
                          <Trash2 class="size-16" aria-hidden="true" />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {settled ? "Remove" : "Wait for the answer to finish"}
                    </Tooltip.Content>
                  </Tooltip.Root>
                {/if}
              {/if}
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
