<script lang="ts" module>
  /** What an anonymous poll says above its options. The whole of what it promises, and no more. */
  export const NOT_ATTRIBUTED_SENTENCE = "Answers are not shown with names";
</script>

<script lang="ts">
  /*
   * The polls: what a host has asked the room, and the answers as they come in.
   *
   * IT IS A READING PANEL ON THE WAITING ROOM'S PRECEDENT. The design calls for a sheet, and the
   * product's one-implementation rule admits only the declared shells, so this is the shape the
   * lobby and the hands queue already take: an `ActionDialog` of the reading kind, whose action bar
   * carries only the way out and whose every act is offered in place, on the card it is about. A
   * member opens it to answer as often as a host opens it to ask, and both are steps beside the
   * thing they change rather than a commit at the foot of the panel.
   *
   * A CARD IS A QUESTION UNTIL IT IS ANSWERED, AND A TALLY AFTER. One choice is a radio group and
   * several are checkboxes; once this member has answered, or the poll has closed, the same card
   * becomes one bar per option in the order the room was shown them, with the count, the share and
   * how many of the room have answered. An answer cannot be changed, so there is nothing to go back
   * to.
   *
   * WHAT ANONYMITY MEANS IS SAID BEFORE THE ANSWER, IN THE WORDS THAT ARE TRUE. "Answers are not
   * shown with names" is what the record keeps its promise to — no read, no export and no frame can
   * say who chose what — and it stops short of "anonymous", which would promise more than a row
   * stored in the order it was written can. It stands above the options, where the decision to
   * answer is made, rather than under a tally after the fact.
   *
   * A HOST ASKS FROM THE TOP OF THE SAME PANEL. Two to ten options that add and remove, whether names
   * are shown, and how many choices one person may make — chosen from a list, which the product
   * answers with its one closed-choice field rather than a select. Closing a poll is asked about first
   * because it cannot be undone and the room is mid-answer; who answered what is a host's read, and
   * only of a poll that shows names.
   *
   * IT TAKES MODELS AND HANDLERS, NOT THE CLIENT, like every other screen component here.
   */
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Progress from "@magna-carta/design-system/progress";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Switch from "@magna-carta/design-system/switch";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
  import { SAMPLE_SENTENCE, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import {
    isAcceptableAnswer,
    isOpenablePoll,
    MAX_MEETING_POLL_OPTIONS,
    MAX_MEETING_POLL_QUESTION_LENGTH,
    MIN_MEETING_POLL_OPTIONS,
    shareOf,
    type MeetingPollAnswerPageView,
    type MeetingPollAnswerView,
    type MeetingPollDraft,
    type MeetingPollView,
  } from "$lib/meetings/client/polls.svelte.ts";
  import type { MeetingWrite } from "$lib/meetings/meetings-api.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { Snippet } from "svelte";

  /**
   * How close to the ceiling a question gets before the room left is stated. Five hundred characters
   * is a long question, and a count that is always on screen is one nobody reads.
   */
  const ROOM_LEFT_STATED_FROM = 100;

  let {
    open = $bindable(false),
    subject,
    polls,
    hosting = false,
    inRoom = 0,
    loading = false,
    failed = false,
    opening = false,
    answering = new Set<string>(),
    onOpenPoll,
    onAnswer,
    onClosePoll,
    onReadAnswers,
    nameOfAnswer,
    readFailure,
    writeFailure,
  }: {
    /** Whether the panel is showing. Bindable, so the band and the count agree about it. */
    open?: boolean;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /** Every poll this room has opened, newest first. */
    polls: readonly MeetingPollView[];
    /**
     * Whether this member is running the meeting. A member who is not sees no New Poll form, no
     * Close Poll and no See Who Answered — absent rather than disabled, on the band's standing rule.
     */
    hosting?: boolean;
    /** How many are in the room, for "12 of 30 answered". */
    inRoom?: number;
    /** True while the first read has not arrived. A later backstop read is not this state. */
    loading?: boolean;
    /** True where the polls could not be read and there is nothing to show instead. */
    failed?: boolean;
    /** True while a new poll is on its way. */
    opening?: boolean;
    /** The polls an answer is on its way for. */
    answering?: ReadonlySet<string>;
    /** Ask the room. Answers whether the record has it, which is when the form is cleared. */
    onOpenPoll: (draft: MeetingPollDraft) => Promise<boolean>;
    /** Answer one poll. Answers whether the record has it. */
    onAnswer: (pollId: string, optionIds: readonly string[]) => Promise<boolean>;
    /** Close one poll. Answers whether the record has closed it. */
    onClosePoll: (pollId: string) => Promise<boolean>;
    /** One page of who answered what on a poll that shows names. */
    onReadAnswers: (
      pollId: string,
      cursor: string | null,
    ) => Promise<MeetingWrite<MeetingPollAnswerPageView>>;
    /** Who gave one answer, out of the roster the room screen holds. */
    nameOfAnswer: (answer: MeetingPollAnswerView) => string;
    /** A refused read, in the app's own words. */
    readFailure?: Snippet;
    /** A refused write, in the app's own words, in the panel's reserved band. */
    writeFailure?: Snippet;
  } = $props();

  // ---- a host asking --------------------------------------------------------------------------

  let question = $state("");
  let options = $state<string[]>(["", ""]);
  let hideNames = $state(false);
  let maxChoices = $state("1");

  const draft = $derived<MeetingPollDraft>({
    question,
    options,
    anonymous: hideNames,
    maxChoices: Number(maxChoices),
  });
  const canOpen = $derived(!opening && isOpenablePoll(draft));
  const questionRoomLeft = $derived(MAX_MEETING_POLL_QUESTION_LENGTH - question.trim().length);

  /** One choice, or up to as many as there are options to choose. */
  const choiceCounts = $derived(
    Array.from({ length: Math.max(options.length, MIN_MEETING_POLL_OPTIONS) }, (_, index) => ({
      value: String(index + 1),
      label: index === 0 ? "One" : `Up to ${String(index + 1)}`,
    })),
  );

  /** How much room is left, said the way a person would say it. */
  function roomLeftStatement(left: number): string {
    const count = Math.abs(left);
    const noun = count === 1 ? "character" : "characters";
    return left < 0 ? `${String(count)} ${noun} too many.` : `${String(count)} ${noun} left.`;
  }

  function addOption(): void {
    if (options.length >= MAX_MEETING_POLL_OPTIONS) return;
    options = [...options, ""];
  }

  function removeOption(index: number): void {
    if (options.length <= MIN_MEETING_POLL_OPTIONS) return;
    options = options.filter((_, at) => at !== index);
    // A poll cannot let somebody choose more options than it has.
    if (Number(maxChoices) > options.length) maxChoices = String(options.length);
  }

  async function openPoll(): Promise<void> {
    if (!canOpen) return;
    // The form is cleared only once the record has the poll, so a refused one is still there to try
    // again with rather than something the host has to type out a second time.
    if (!(await onOpenPoll(draft))) return;
    question = "";
    options = ["", ""];
    hideNames = false;
    maxChoices = "1";
  }

  // ---- a member answering ---------------------------------------------------------------------

  /** What each card has chosen and not yet sent, by poll. */
  let chosen = $state<Record<string, readonly string[]>>({});

  function chosenFor(pollId: string): readonly string[] {
    return chosen[pollId] ?? [];
  }

  function choose(pollId: string, optionIds: readonly string[]): void {
    chosen = { ...chosen, [pollId]: optionIds };
  }

  function toggleChoice(pollId: string, optionId: string, checked: boolean): void {
    const held = chosenFor(pollId).filter((one) => one !== optionId);
    choose(pollId, checked ? [...held, optionId] : held);
  }

  async function sendAnswer(poll: MeetingPollView): Promise<void> {
    const picked = chosenFor(poll.pollId);
    if (!isAcceptableAnswer(poll, picked)) return;
    if (await onAnswer(poll.pollId, picked)) choose(poll.pollId, []);
  }

  /**
   * The poll a card is, or the tally it has become: once this member has answered, once the poll
   * has closed, and always for somebody running the meeting — a host who asks the room is watching
   * the answers arrive, which is what the panel switches to the moment a poll opens.
   */
  function showsTally(poll: MeetingPollView): boolean {
    return hosting || poll.answered || poll.closedAt !== null;
  }

  function answeredLine(poll: MeetingPollView): string {
    // "Of how many" is a fact about who is in the room NOW, which is only worth saying while the
    // poll is still taking answers.
    return poll.closedAt === null && inRoom > 0
      ? `${String(poll.respondents)} of ${String(inRoom)} answered`
      : `${String(poll.respondents)} answered`;
  }

  // ---- a host closing -------------------------------------------------------------------------

  let closing = $state<MeetingPollView | null>(null);
  let closeOpen = $state(false);

  function askToClose(poll: MeetingPollView): void {
    closing = poll;
    closeOpen = true;
  }

  async function closePoll(): Promise<ActionOutcome> {
    if (closing === null) return "refused";
    return (await onClosePoll(closing.pollId)) ? "committed" : "refused";
  }

  // ---- a host reading who answered --------------------------------------------------------------

  let reading = $state<MeetingPollView | null>(null);
  let answersOpen = $state(false);
  let answers = $state<readonly MeetingPollAnswerView[]>([]);
  let answersCursor = $state<string | null>(null);
  let answersLoading = $state(false);
  let answersFailed = $state(false);

  async function readAnswers(poll: MeetingPollView, cursor: string | null): Promise<void> {
    answersLoading = cursor === null;
    answersFailed = false;
    const outcome = await onReadAnswers(poll.pollId, cursor);
    answersLoading = false;
    if (outcome.kind !== "ok") {
      answersFailed = true;
      return;
    }
    answers = cursor === null ? outcome.value.answers : [...answers, ...outcome.value.answers];
    answersCursor = outcome.value.nextCursor;
  }

  function seeWhoAnswered(poll: MeetingPollView): void {
    reading = poll;
    answers = [];
    answersCursor = null;
    answersOpen = true;
    void readAnswers(poll, null);
  }

  /** The words of the options one person chose, in the order the poll offered them. */
  function chosenLabels(poll: MeetingPollView, answer: MeetingPollAnswerView): string {
    return poll.options
      .filter((option) => answer.optionIds.includes(option.optionId))
      .map((option) => option.label)
      .join(", ");
  }

  /** The shape of a card over words that are plainly invented, for the read in flight. */
  const FIXTURE: readonly MeetingPollView[] = [
    {
      pollId: "fixture-poll",
      question: SAMPLE_SENTENCE,
      anonymous: false,
      maxChoices: 1,
      openedAt: sampleInstant(0),
      closedAt: null,
      options: [0, 1, 2].map((position) => ({
        optionId: `fixture-option-${String(position)}`,
        position,
        label: SAMPLE_SENTENCE,
        count: 0,
      })),
      respondents: 0,
      answered: true,
    },
  ];
</script>

{#snippet pollCard(poll: MeetingPollView, live: boolean)}
  <Card.Root>
    <Card.Header>
      <Card.Title>{poll.question}</Card.Title>
      {#if poll.anonymous}
        <!-- Before the answer, where the decision to answer is made. -->
        <Card.Description>{NOT_ATTRIBUTED_SENTENCE}</Card.Description>
      {/if}
    </Card.Header>

    <Card.Content>
      {#if showsTally(poll)}
        <!-- Every option, in the order the room was shown them, including the ones nobody chose:
             a tally that left out a zero would be a poll with fewer options than it was asked with. -->
        <ul class="flex flex-col gap-12" aria-label="Answers so far">
          {#each poll.options as option (option.optionId)}
            {@const share = Math.round(shareOf(option, poll) * 100)}
            <li class="flex flex-col gap-4">
              <span class="flex items-baseline gap-8 text-sm">
                <span class="min-w-0 flex-1">{option.label}</span>
                <span class="shrink-0 tabular-nums text-text-muted">
                  {option.count} · {share}%
                </span>
              </span>
              <Progress
                value={option.count}
                max={Math.max(poll.respondents, 1)}
                aria-label="{option.label}: {option.count} of {poll.respondents}"
              />
            </li>
          {/each}
        </ul>
      {:else if poll.maxChoices === 1}
        <RadioGroup.Root
          aria-label={poll.question}
          bind:value={
            () => chosenFor(poll.pollId)[0] ?? "", (next) => choose(poll.pollId, [next])
          }
          class="flex flex-col gap-8"
        >
          {#each poll.options as option (option.optionId)}
            {@const id = `poll-${poll.pollId}-${option.optionId}`}
            <div class="flex items-center gap-8">
              <RadioGroup.Item {id} value={option.optionId} />
              <Label for={id}>{option.label}</Label>
            </div>
          {/each}
        </RadioGroup.Root>
      {:else}
        {@const picked = chosenFor(poll.pollId)}
        <fieldset class="flex flex-col gap-8">
          <legend class="text-xs text-text-muted">
            {picked.length > poll.maxChoices
              ? `Choose no more than ${String(poll.maxChoices)}.`
              : `Choose up to ${String(poll.maxChoices)}.`}
          </legend>
          {#each poll.options as option (option.optionId)}
            {@const id = `poll-${poll.pollId}-${option.optionId}`}
            <div class="flex items-center gap-8">
              <Checkbox
                {id}
                bind:checked={
                  () => picked.includes(option.optionId),
                  (next) => toggleChoice(poll.pollId, option.optionId, next)
                }
              />
              <Label for={id}>{option.label}</Label>
            </div>
          {/each}
        </fieldset>
      {/if}
    </Card.Content>

    <Card.Footer class="flex-wrap">
      <!-- Whether it still takes answers is said as the fact it is, with the instant it stopped. -->
      <span class="min-w-0 flex-1 text-xs text-text-muted">
        {answeredLine(poll)} · {poll.closedAt === null
          ? `Opened ${formatTimeOfDay(poll.openedAt)}`
          : `Closed ${formatTimeOfDay(poll.closedAt)}`}
      </span>
      {#if live && hosting && poll.closedAt === null}
        <Button variant="ghost" size="sm" onclick={() => askToClose(poll)}>Close Poll</Button>
      {/if}
      {#if live && hosting && !poll.anonymous}
        <Button variant="ghost" size="sm" onclick={() => seeWhoAnswered(poll)}>
          See Who Answered
        </Button>
      {/if}
      {#if live && !showsTally(poll)}
        <Button
          variant="secondary"
          size="sm"
          disabled={!isAcceptableAnswer(poll, chosenFor(poll.pollId)) || answering.has(poll.pollId)}
          onclick={() => void sendAnswer(poll)}
        >
          {answering.has(poll.pollId) ? "Answering" : "Answer"}
        </Button>
      {/if}
    </Card.Footer>
  </Card.Root>
{/snippet}

{#snippet fixture()}
  {#each FIXTURE as poll (poll.pollId)}
    {@render pollCard(poll, false)}
  {/each}
{/snippet}

<ActionDialog bind:open kind="reading" heading="Polls" subtitle={subject}>
  {#snippet notice()}
    {@render writeFailure?.()}
  {/snippet}

  {#snippet fields()}
    <div class="flex flex-col gap-24">
      {#if hosting}
        <section class="flex flex-col gap-12" aria-labelledby="meeting-new-poll-heading">
          <h3 id="meeting-new-poll-heading" class="text-sm font-medium">New Poll</h3>

          <div class="flex flex-col gap-4">
            <Label for="meeting-new-poll-question">Question</Label>
            <Textarea id="meeting-new-poll-question" bind:value={question} rows={2} />
            {#if questionRoomLeft <= ROOM_LEFT_STATED_FROM}
              <p class="text-xs text-text-muted">
                {roomLeftStatement(questionRoomLeft)}
              </p>
            {/if}
          </div>

          <fieldset class="flex flex-col gap-8">
            <legend class="text-sm">Options</legend>
            {#each options as _, index (index)}
              <div class="flex items-center gap-8">
                <Input
                  class="min-w-0 flex-1"
                  aria-label="Option {index + 1}"
                  bind:value={options[index]}
                />
                {#if options.length > MIN_MEETING_POLL_OPTIONS}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove option {index + 1}"
                    onclick={() => removeOption(index)}
                  >
                    <X class="size-16" aria-hidden="true" />
                  </Button>
                {/if}
              </div>
            {/each}
            {#if options.length < MAX_MEETING_POLL_OPTIONS}
              <div>
                <Button variant="ghost" size="sm" onclick={addOption}>
                  <Plus class="size-16" aria-hidden="true" />
                  Add Option
                </Button>
              </div>
            {/if}
          </fieldset>

          <div class="flex flex-wrap items-end gap-16">
            <div class="flex flex-col gap-4">
              <Label for="meeting-new-poll-choices">Choices each person may make</Label>
              <ChoicePicker
                inputId="meeting-new-poll-choices"
                label="Choices each person may make"
                options={choiceCounts}
                bind:value={maxChoices}
              />
            </div>
            <div class="flex items-center gap-8">
              <Switch aria-labelledby="meeting-new-poll-names-label" bind:checked={hideNames} />
              <Label id="meeting-new-poll-names-label">Do not show names with answers</Label>
            </div>
          </div>

          <div class="flex justify-end">
            <Button disabled={!canOpen} onclick={() => void openPoll()}>
              {opening ? "Opening" : "Open Poll"}
            </Button>
          </div>
        </section>
      {/if}

      <LoadingRegion
        class="flex flex-col gap-16"
        {loading}
        {failed}
        label="Reading this meeting's polls"
        {fixture}
        failure={readFailure}
      >
        {#each polls as poll (poll.pollId)}
          {@render pollCard(poll, true)}
        {:else}
          <!-- Said as what to do, not as an absence: a host asks from the form above, and a member
               learns where a question will appear when one is asked. -->
          <p class="text-sm text-text-muted">
            {hosting ? "Ask the room a question." : "When a host opens a poll, it appears here."}
          </p>
        {/each}
      </LoadingRegion>
    </div>
  {/snippet}
</ActionDialog>

<!-- Asked first: a closed poll takes no more answers, it cannot be opened again, and somebody in the
     room may be halfway through choosing. -->
<ActionDialog
  bind:open={closeOpen}
  kind="destructive"
  heading="Close Poll"
  subtitle={subject}
  commitLabel="Close Poll"
  commitBusyLabel="Closing"
  unsavedChanges={false}
  onCommit={closePoll}
>
  {#snippet notice()}
    {@render writeFailure?.()}
  {/snippet}

  {#snippet fields()}
    <p class="text-sm">
      Nobody can answer it once it is closed, and it cannot be opened again. The answers already
      given stay on the meeting's record.
    </p>
  {/snippet}
</ActionDialog>

<!-- Who chose what, on a poll that shows names. A host's read, paged. -->
<ActionDialog bind:open={answersOpen} kind="reading" heading="Who Answered" subtitle={subject}>
  {#snippet fields()}
    <LoadingRegion
      class="flex flex-col gap-8"
      loading={answersLoading}
      failed={answersFailed}
      label="Reading who answered this poll"
    >
      {#snippet failure()}
        <p class="text-sm">Who answered this poll could not be read.</p>
        {#if reading !== null}
          {@const poll = reading}
          <div>
            <Button variant="secondary" size="sm" onclick={() => void readAnswers(poll, null)}>
              Retry
            </Button>
          </div>
        {/if}
      {/snippet}

      {#if reading !== null}
        {@const poll = reading}
        <ul class="flex flex-col gap-8">
          {#each answers as answered (answered.participantId)}
            <li class="flex items-baseline gap-8 text-sm">
              <span class="min-w-0 flex-1">
                <span class="font-medium">{nameOfAnswer(answered)}</span>
                <span class="text-text-muted">{chosenLabels(poll, answered)}</span>
              </span>
              <span class="shrink-0 text-xs text-text-muted">
                {formatTimeOfDay(answered.answeredAt)}
              </span>
            </li>
          {:else}
            <li class="text-sm text-text-muted">Nobody has answered this poll yet.</li>
          {/each}
        </ul>
        {#if answersCursor !== null}
          {@const cursor = answersCursor}
          <div>
            <Button variant="ghost" size="sm" onclick={() => void readAnswers(poll, cursor)}>
              Show More
            </Button>
          </div>
        {/if}
      {/if}
    </LoadingRegion>
  {/snippet}
</ActionDialog>
