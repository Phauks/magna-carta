<script lang="ts">
  /*
   * The question queue: what the room has asked whoever is running it, in the order a host works it.
   *
   * IT IS A READING PANEL ON THE WAITING ROOM'S PRECEDENT, for the reason the polls panel is. The
   * design calls for a sheet and the product admits only its declared shells, so it is an
   * `ActionDialog` of the reading kind: the action bar carries only the way out, and every act —
   * upvoting, marking answered, taking a question back, asking one — is a step in place beside the
   * thing it changes.
   *
   * THE ORDER IS THE BROWSER'S. Unanswered first and the most upvoted first within each group, worked
   * out over the whole queue this browser holds, so it moves the moment a tally arrives rather than on
   * the next read. The rows arrive in that order; this file only draws them.
   *
   * THE UPVOTE READS ITS OWN STATE. One control, pressed or not, whose press does the other thing —
   * an upvote that could not be taken back would be a vote rather than a signal.
   *
   * A QUESTION IS TAKEN BACK, NEVER DELETED, and the row says so where the words were: the record
   * keeps that something was asked, when, and by which stay. A host may take back any question and an
   * author their own, on chat's own rule.
   *
   * IT TAKES MODELS AND HANDLERS, NOT THE CLIENT, like every other screen component here.
   */
  import ArrowBigUp from "@lucide/svelte/icons/arrow-big-up";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
  import {
    SAMPLE_SENTENCE,
    sampleInstant,
    samplePerson,
  } from "@magna-carta/design-system/loading-fixtures";
  import {
    MAX_MEETING_QUESTION_LENGTH,
    type MeetingQuestionView,
  } from "$lib/meetings/client/questions.svelte.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    inline = false,
    draft = $bindable(""),
    subject,
    queue,
    hosting = false,
    loading = false,
    failed = false,
    asking = false,
    upvoting = new Set<string>(),
    nameOf,
    isMine,
    onAsk,
    onToggleUpvote,
    onMarkAnswered,
    onRedact,
    readFailure,
    writeFailure,
  }: {
    /** Drawn in the room's side panel rather than as a dialog over the room. */
    inline?: boolean;
    open?: boolean;
    /** What is typed and not yet asked. Bindable, so it survives the panel being closed. */
    draft?: string;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /** The queue, already in the order a host works it. */
    queue: readonly MeetingQuestionView[];
    /**
     * Whether this member is running the meeting. A member who is not sees no Mark Answered, and a
     * Redact only on their own questions — absent rather than disabled.
     */
    hosting?: boolean;
    loading?: boolean;
    failed?: boolean;
    /** True while a question is on its way. */
    asking?: boolean;
    /** The questions an upvote or its withdrawal is on its way for. */
    upvoting?: ReadonlySet<string>;
    /** Who asked, out of the roster the room screen holds. */
    nameOf: (question: MeetingQuestionView) => string;
    /** Whether this reader asked it, which is what offers them Redact on their own row. */
    isMine: (question: MeetingQuestionView) => boolean;
    /** Ask. Answers whether the record has it, which is when the field is cleared. */
    onAsk: (body: string) => Promise<boolean>;
    onToggleUpvote: (questionId: string) => void;
    onMarkAnswered: (questionId: string, answered: boolean) => void;
    onRedact: (questionId: string) => void;
    readFailure?: Snippet;
    writeFailure?: Snippet;
  } = $props();

  const stated = $derived(draft.trim());
  /** How much room is left, counted down from the whole ceiling. Negative once there is none. */
  const roomLeft = $derived(MAX_MEETING_QUESTION_LENGTH - stated.length);
  const canAsk = $derived(stated !== "" && roomLeft >= 0 && !asking);

  /** How much room is left, said the way a person would say it. */
  function roomLeftStatement(left: number): string {
    const count = Math.abs(left);
    const noun = count === 1 ? "character" : "characters";
    return left < 0 ? `${String(count)} ${noun} too many.` : `${String(count)} ${noun} left.`;
  }

  async function ask(): Promise<void> {
    if (!canAsk) return;
    // Cleared only once the record has it, so a refused question is still there to try again with.
    if (await onAsk(stated)) draft = "";
  }

  /** The queue's shape over words that are plainly invented, for the read in flight. */
  const FIXTURE: readonly MeetingQuestionView[] = [0, 1].map((index) => ({
    questionId: `fixture-question-${String(index)}`,
    participantId: `fixture-stay-${String(index)}`,
    participantKind: "member",
    userId: null,
    body: SAMPLE_SENTENCE,
    askedAt: sampleInstant(index),
    answeredAt: null,
    redactedAt: null,
    upvotes: 0,
    upvotedByMe: false,
  }));
</script>

{#snippet rows(shown: readonly MeetingQuestionView[], live: boolean)}
  <ul class="flex flex-col gap-16" aria-label="Questions asked in this meeting">
    {#each shown as question, index (question.questionId)}
      {@const name = live ? nameOf(question) : samplePerson(index).name}
      {@const asked = formatTimeOfDay(question.askedAt)}
      {@const redacted = question.redactedAt !== null}
      <li class="flex items-start gap-12">
        <!-- The upvote leads the row, where a reader scanning the queue meets the number that
             ordered it. Pressed means this member has upvoted; pressing it again takes that back. -->
        <Button
          variant={question.upvotedByMe ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={question.upvotedByMe}
          aria-label={question.upvotedByMe
            ? `Take back your upvote of the question ${name} asked at ${asked}`
            : `Upvote the question ${name} asked at ${asked}`}
          disabled={!live || redacted || upvoting.has(question.questionId)}
          onclick={() => onToggleUpvote(question.questionId)}
        >
          <ArrowBigUp class="size-16" aria-hidden="true" />
          <span class="tabular-nums">{question.upvotes}</span>
        </Button>

        <div class="flex min-w-0 flex-1 flex-col gap-4">
          <div class="flex flex-wrap items-baseline gap-8">
            <span class="min-w-0 truncate text-sm font-medium" title={name}>{name}</span>
            <span class="text-xs text-text-muted">{asked}</span>
            {#if question.answeredAt !== null}
              <Badge variant="success" caps>Answered</Badge>
            {/if}
          </div>
          {#if redacted}
            <!-- The row stays where it was. What it says is that something was asked here and
                 somebody removed it, which is what the record itself now holds. -->
            <p class="text-sm text-text-muted">Redacted.</p>
          {:else}
            <p class="text-sm whitespace-pre-wrap">{question.body}</p>
          {/if}
          {#if live && !redacted && (hosting || isMine(question))}
            <div class="flex flex-wrap items-center gap-8">
              {#if hosting}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={question.answeredAt === null
                    ? `Mark the question ${name} asked at ${asked} answered`
                    : `Mark the question ${name} asked at ${asked} unanswered`}
                  onclick={() =>
                    onMarkAnswered(question.questionId, question.answeredAt === null)}
                >
                  <CircleCheck class="size-16" aria-hidden="true" />
                  {question.answeredAt === null ? "Mark Answered" : "Mark Unanswered"}
                </Button>
              {/if}
              <Button
                variant="ghost"
                size="sm"
                aria-label="Redact the question {name} asked at {asked}"
                onclick={() => onRedact(question.questionId)}
              >
                Redact
              </Button>
            </div>
          {/if}
        </div>
      </li>
    {:else}
      <!-- What to do, not that there is nothing: the composer is right beneath. -->
      <li class="text-sm text-text-muted">Ask the first question.</li>
    {/each}
  </ul>
{/snippet}

{#snippet fixture()}
  {@render rows(FIXTURE, false)}
{/snippet}

{#snippet panelNotice()}
    {@render writeFailure?.()}
  {/snippet}

{#snippet panelBody()}
    <div class="flex flex-col gap-24">
      <LoadingRegion
        class="flex flex-col"
        {loading}
        {failed}
        label="Reading the questions asked in this meeting"
        {fixture}
        failure={readFailure}
      >
        {@render rows(queue, true)}
      </LoadingRegion>

      <div class="flex flex-col gap-4">
        <Label for="meeting-question-body">Your question</Label>
        <Textarea id="meeting-question-body" bind:value={draft} rows={3} />
        <!-- Counted down from the whole ceiling and always mounted, so the field never moves as the
             count arrives. -->
        <p class="text-xs text-text-muted">
          {roomLeftStatement(roomLeft)}
        </p>
        <div class="flex justify-end">
          <Button disabled={!canAsk} onclick={() => void ask()}>
            <SendHorizontal class="size-16" aria-hidden="true" />
            {asking ? "Asking" : "Ask"}
          </Button>
        </div>
      </div>
    </div>
  {/snippet}

{#if inline}
  <!-- Drawn in the room's side panel, beside the picture rather than over it. -->
  <div class="flex flex-col gap-16">
    {@render panelNotice()}
    {@render panelBody()}
  </div>
{:else}
  <ActionDialog bind:open kind="reading" heading="Q&amp;A" subtitle={subject}>
    {#snippet notice()}
      {@render panelNotice()}
    {/snippet}

    {#snippet fields()}
      {@render panelBody()}
    {/snippet}
  </ActionDialog>
{/if}
