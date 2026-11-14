<script lang="ts">
  /*
   * What is being said in the room, behind the Chat control in the band.
   *
   * IT IS A POPOVER, AND THAT IS THE SAME JUDGMENT THE CONNECTION PANEL MADE. Both shells the
   * product asks with are modal: `ActionDialog` asks a reader for an act, `RecordWindow` reads and
   * changes a record, and each draws a scrim over what is behind it. Chat is READ WHILE THE MEETING
   * GOES ON — somebody types a name into it with one eye on the person saying it — so a scrim over
   * the room would hide the very thing the messages are about, and a focus trap would take the
   * microphone control away from a member mid-sentence. The lints admit either: `lint:one-ui`'s
   * hand-composed-modal rule names `Dialog`, `AlertDialog` and `Sheet` (a popover is not a modal
   * surface and re-answers none of what the shells settle), and `lint:modal-headers` reads only the
   * two shells, so a reading dialog would be admitted too. It is the room behind it that decides.
   *
   * IT TAKES MODELS AND HANDLERS, NOT THE CLIENT, like every other screen component here. Who
   * somebody is and whether this reader may take a message back are questions about the roster and
   * the grant, so they arrive as functions the room screen supplies; this file knows only what a
   * message row says about itself.
   *
   * A MESSAGE IS TAKEN BACK, NEVER DELETED, and the row says so where the words were. The record
   * keeps that something was said, when, and from which stay — so a row that simply vanished would
   * disagree with the file, and a reader who saw the message before it went would be the only one
   * who knew it had ever existed.
   *
   * A QUESTION IS A KIND OF CHAT MESSAGE HERE. Where the room screen hands over the question queue,
   * questions sit in the same timeline as everything else said, marked as questions, with their
   * upvote and (for a host) Mark Answered on the row. "Ask as a question" under the message box sends
   * the words to the queue instead of the chat, and the Questions filter shows only the queue, in
   * the order a host works it. They stay two records, because a question is answered and upvoted
   * and a message is not.
   *
   * A LINE CAN POINT AT ONE OF THE MATTER'S FILES. In a meeting kept on a matter the paperclip
   * beside Send offers Existing File (picked from the matter's own store) and Upload File (filed
   * onto the matter in "Meeting files" first); either says a line pointing at the file, with what
   * is typed in the box as its words. The line draws the file as a link to its own download route,
   * so the file is opened under the same scan and permissions as anywhere else on the matter.
   */
  import ArrowBigUp from "@lucide/svelte/icons/arrow-big-up";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import MessageCircleQuestionMark from "@lucide/svelte/icons/message-circle-question-mark";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import FileText from "@lucide/svelte/icons/file-text";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { downloadUrl } from "$lib/file-manager/folder-api.ts";
  import MeetingChatFileDialog from "./meeting-chat-file-dialog.svelte";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as Conversation from "@magna-carta/design-system/conversation";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Popover from "@magna-carta/design-system/popover";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
  import { SAMPLE_SENTENCE, samplePerson, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import { wasTakenBack } from "$lib/meetings/client/chat.svelte.ts";
  import { MAX_MEETING_MESSAGE_LENGTH } from "$lib/meetings/meetings-api.ts";
  import {
    MAX_MEETING_QUESTION_LENGTH,
    type MeetingQuestionView,
  } from "$lib/meetings/client/questions.svelte.ts";
  import { chatTimeline } from "./chat-timeline.ts";
  import type { MeetingMessage } from "@magna-carta/api-client";
  import type { Snippet } from "svelte";

  /**
   * How close to the ceiling a message gets before the room left is stated.
   *
   * Never from the first character: a count that is always on screen is a count nobody reads, and
   * four thousand characters is a long message somebody will not reach by accident. It appears
   * where the answer starts to matter.
   */
  const ROOM_LEFT_STATED_FROM = 200;

  let {
    open = $bindable(false),
    inline = false,
    draft = $bindable(""),
    messages,
    unread = 0,
    loading = false,
    failed = false,
    sending = false,
    nameOf,
    canTakeBack,
    onSend,
    onTakeBack,
    readFailure,
    writeFailure,
    questions,
    hosting = false,
    asking = false,
    upvoting = new Set<string>(),
    questionNameOf,
    isMyQuestion,
    onAsk,
    onToggleUpvote,
    onMarkAnswered,
    onRedactQuestion,
    questionFailure,
    matterId = null,
    uploading = false,
    onShareFile,
    onUploadFile,
  }: {
    /** Drawn in the room's side panel rather than as a popover from the band. */
    inline?: boolean;
    /** Whether the panel is showing. Bindable, so the band and the count agree about it. */
    open?: boolean;
    /** What is typed and not yet said. Bindable, so it survives the panel being closed. */
    draft?: string;
    /** Everything said in this room, oldest first, as the record states it. */
    messages: readonly MeetingMessage[];
    /** How much has been said since the panel was last open. */
    unread?: number;
    /** True while the transcript has not arrived yet. A later poll is not this state. */
    loading?: boolean;
    /** True where the transcript could not be read and there is nothing to show instead. */
    failed?: boolean;
    /** True while a message is on its way. */
    sending?: boolean;
    /** Who said it, out of the roster the room screen holds. */
    nameOf: (message: MeetingMessage) => string;
    /** Whether this reader may take this message back: their own, or any while hosting. */
    canTakeBack: (message: MeetingMessage) => boolean;
    /** Say it. Answers whether it reached the record, which is when the field is cleared. */
    onSend: (body: string) => Promise<boolean>;
    onTakeBack: (messageId: string) => void;
    /** A refused read, in the app's own words. */
    readFailure?: Snippet;
    /** A refused write, in the app's own words. */
    writeFailure?: Snippet;
    /**
     * The question queue, in the order a host works it. When given, questions are drawn in the
     * timeline and the composer can ask one; without it this is chat alone.
     */
    questions?: readonly MeetingQuestionView[];
    /** Whether this member is running the meeting, which offers Mark Answered on a question. */
    hosting?: boolean;
    /** True while a question is on its way. */
    asking?: boolean;
    /** The questions an upvote or its withdrawal is on its way for. */
    upvoting?: ReadonlySet<string>;
    questionNameOf?: (question: MeetingQuestionView) => string;
    isMyQuestion?: (question: MeetingQuestionView) => boolean;
    onAsk?: (body: string) => Promise<boolean>;
    onToggleUpvote?: (questionId: string) => void;
    onMarkAnswered?: (questionId: string, answered: boolean) => void;
    onRedactQuestion?: (questionId: string) => void;
    /** A refused question write, in the app's own words. */
    questionFailure?: Snippet;
    /** The meeting's matter. Files are offered only where there is one and both handlers are given. */
    matterId?: string | null;
    /** True while a file is being filed onto the matter before it is said. */
    uploading?: boolean;
    /** Say a line pointing at one of the matter's files, with these words. */
    onShareFile?: (fileId: string, body: string) => Promise<boolean>;
    /** File a new document onto the matter, then say a line pointing at it, with these words. */
    onUploadFile?: (file: File, body: string) => Promise<boolean>;
  } = $props();

  const sharesFiles = $derived(
    matterId !== null && onShareFile !== undefined && onUploadFile !== undefined,
  );
  let sharingExisting = $state(false);
  let filePicker = $state<HTMLInputElement>();

  /** The words in the box go with the file, and are cleared once the line is on the record. */
  async function shareExisting(fileId: string): Promise<boolean> {
    if (onShareFile === undefined || tooLong) return false;
    const sent = await onShareFile(fileId, stated);
    if (sent) draft = "";
    return sent;
  }

  async function uploadPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Emptied at once, so choosing the same file again after a refusal is a change the input sees.
    input.value = "";
    if (file === undefined || onUploadFile === undefined || tooLong) return;
    if (await onUploadFile(file, stated)) draft = "";
  }

  /** Whether a line's words are only the file's name, which the file's own link already says. */
  function onlyNamesTheFile(message: MeetingMessage): boolean {
    return message.attachedFile !== null && message.body === message.attachedFile.name;
  }

  const withQuestions = $derived(questions !== undefined && onAsk !== undefined);
  /** Whether the words in the box go to the question queue rather than the chat. */
  let asQuestion = $state(false);
  /** Everything, or only the questions. */
  let showing = $state<"all" | "questions">("all");

  const timeline = $derived(chatTimeline(messages, questions ?? []));

  const stated = $derived(draft.trim());
  /** How much room is left in this message. Negative once there is none. */
  const asking_ = $derived(withQuestions && asQuestion);
  const roomLeft = $derived(
    (asking_ ? MAX_MEETING_QUESTION_LENGTH : MAX_MEETING_MESSAGE_LENGTH) - stated.length,
  );
  const tooLong = $derived(roomLeft < 0);
  const canSay = $derived(stated !== "" && !tooLong && !(asking_ ? asking : sending));

  async function say(): Promise<void> {
    if (!canSay) return;
    // The field is cleared only once the record has it, so a refused message is still there to try
    // again with rather than something the reader has to type a second time.
    const sent = asking_ && onAsk !== undefined ? await onAsk(stated) : await onSend(stated);
    if (sent) {
      draft = "";
      asQuestion = false;
    }
  }

  /**
   * Enter says it; Shift and Enter writes a line.
   *
   * The opposite way round from the assistant's composer, and deliberately: a question to Magnus is
   * composed and often runs to a paragraph, while a message across a meeting is a sentence said
   * while somebody is still talking. `isComposing` is what keeps this off an input method's own
   * Enter, which would send half a word in Japanese or Chinese.
   */
  function composerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void say();
  }

  /** The transcript's shape over words that are plainly invented, for the read in flight. */
  const FIXTURE: readonly MeetingMessage[] = [0, 1].map((index) => ({
    id: `fixture-message-${String(index)}`,
    meetingId: "fixture-meeting",
    participantKind: "member" as const,
    participantId: `fixture-stay-${String(index)}`,
    userId: null,
    sentAt: sampleInstant(index),
    body: SAMPLE_SENTENCE,
    redactedAt: null,
    redactedByUserId: null,
    attachedFile: null,
  }));
</script>

{#snippet fixture()}
  {@render transcript(FIXTURE, false)}
{/snippet}

{#snippet questionTurn(question: MeetingQuestionView)}
  {@const name = questionNameOf?.(question) ?? ""}
  {@const asked = formatTimeOfDay(question.askedAt)}
  {@const redacted = question.redactedAt !== null}
  <Conversation.Turn speaker="member">
    <div class="flex items-baseline gap-8">
      <MessageCircleQuestionMark
        class="size-16 shrink-0 self-center text-accent-default"
        aria-label="Question"
      />
      <Conversation.TurnSpeaker class="min-w-0 flex-1 truncate">{name}</Conversation.TurnSpeaker>
      <span class="text-xs text-text-muted">{asked}</span>
    </div>
    {#if redacted}
      <Conversation.TurnNote>Taken back.</Conversation.TurnNote>
    {:else}
      <Conversation.TurnBody>{question.body}</Conversation.TurnBody>
    {/if}
    <div class="flex flex-wrap items-center gap-8">
      <!-- Pressed means this member has upvoted; pressing it again takes that back. -->
      <Button
        variant={question.upvotedByMe ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={question.upvotedByMe}
        aria-label={question.upvotedByMe
          ? `Take back your upvote of the question ${name} asked at ${asked}`
          : `Upvote the question ${name} asked at ${asked}`}
        disabled={redacted || upvoting.has(question.questionId)}
        onclick={() => onToggleUpvote?.(question.questionId)}
      >
        <ArrowBigUp class="size-16" aria-hidden="true" />
        <span class="tabular-nums">{question.upvotes}</span>
      </Button>
      {#if question.answeredAt !== null}
        <Badge variant="success" caps>
          <CircleCheck class="size-12" aria-hidden="true" />
          Answered
        </Badge>
      {/if}
      {#if !redacted && hosting}
        <Button
          variant="ghost"
          size="sm"
          aria-label={question.answeredAt === null
            ? `Mark the question ${name} asked at ${asked} answered`
            : `Mark the question ${name} asked at ${asked} unanswered`}
          onclick={() => onMarkAnswered?.(question.questionId, question.answeredAt === null)}
        >
          {question.answeredAt === null ? "Mark Answered" : "Mark Unanswered"}
        </Button>
      {/if}
      {#if !redacted && (hosting || isMyQuestion?.(question) === true)}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Take back the question {name} asked at {asked}"
          onclick={() => onRedactQuestion?.(question.questionId)}
        >
          Take Back
        </Button>
      {/if}
    </div>
  </Conversation.Turn>
{/snippet}

{#snippet questionsOnly()}
  <Conversation.Transcript class="px-0" label="Questions asked in this meeting">
    {#each questions ?? [] as question (question.questionId)}
      {@render questionTurn(question)}
    {:else}
      <Conversation.TurnNote>Nobody has asked a question yet.</Conversation.TurnNote>
    {/each}
  </Conversation.Transcript>
{/snippet}

{#snippet everything()}
  <Conversation.Transcript class="px-0" label="What has been said in this meeting">
    {#each timeline as entry (entry.key)}
      {#if entry.kind === "question"}
        {@render questionTurn(entry.question)}
      {:else}
        {@render messageTurn(entry.message, 0, true)}
      {/if}
    {:else}
      <Conversation.TurnNote>Nothing has been said in this meeting yet.</Conversation.TurnNote>
    {/each}
  </Conversation.Transcript>
{/snippet}

{#snippet messageTurn(message: MeetingMessage, index: number, live: boolean)}
  {@const name = live ? nameOf(message) : samplePerson(index).name}
  {@const said = formatTimeOfDay(message.sentAt)}
  <Conversation.Turn speaker="member">
    <div class="flex items-baseline gap-8">
      <Conversation.TurnSpeaker class="min-w-0 flex-1 truncate">
        {name}
      </Conversation.TurnSpeaker>
      <span class="text-xs text-text-muted">{said}</span>
      {#if live && !wasTakenBack(message) && canTakeBack(message)}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Take back what {name} said at {said}"
          onclick={() => onTakeBack(message.id)}
        >
          Take Back
        </Button>
      {/if}
    </div>
    {#if wasTakenBack(message)}
      <Conversation.TurnNote>Taken back.</Conversation.TurnNote>
    {:else}
      {@render messageBody(message)}
    {/if}
  </Conversation.Turn>
{/snippet}

{#snippet messageBody(message: MeetingMessage)}
  {#if !onlyNamesTheFile(message)}
    <Conversation.TurnBody>{message.body}</Conversation.TurnBody>
  {/if}
  {#if message.attachedFile !== null}
    <!-- The file's own download route, in a new tab: opened under the matter's scan and permissions,
         never through anything of the chat's. -->
    <a
      class="{buttonClasses({ variant: 'secondary', size: 'sm' })} max-w-full self-start"
      href={downloadUrl(message.attachedFile.id)}
      target="_blank"
      rel="noopener"
    >
      <FileText class="size-16 shrink-0" aria-hidden="true" />
      <span class="truncate">{message.attachedFile.name}</span>
    </a>
  {/if}
{/snippet}

{#snippet transcript(shown: readonly MeetingMessage[], live: boolean)}
  <Conversation.Transcript class="px-0" label="What has been said in this meeting">
    {#each shown as message, index (message.id)}
      {@const name = live ? nameOf(message) : samplePerson(index).name}
      {@const said = formatTimeOfDay(message.sentAt)}
      <!-- Every turn is somebody in the room. There is no second voice in this transcript, which is
           what the one speaker says: a meeting has people in it and nothing else. -->
      <Conversation.Turn speaker="member">
        <div class="flex items-baseline gap-8">
          <Conversation.TurnSpeaker class="min-w-0 flex-1 truncate">
            {name}
          </Conversation.TurnSpeaker>
          <span class="text-xs text-text-muted">{said}</span>
          {#if live && !wasTakenBack(message) && canTakeBack(message)}
            <!-- The control names what it takes back, because a transcript of five messages
                 otherwise offers a reader five controls all called Take Back. -->
            <Button
              variant="ghost"
              size="sm"
              aria-label="Take back what {name} said at {said}"
              onclick={() => onTakeBack(message.id)}
            >
              Take Back
            </Button>
          {/if}
        </div>
        {#if wasTakenBack(message)}
          <!-- The row stays where it was. What it says is that something was said here and somebody
               removed it, which is what the record itself now holds. -->
          <Conversation.TurnNote>Taken back.</Conversation.TurnNote>
        {:else}
          {@render messageBody(message)}
        {/if}
      </Conversation.Turn>
    {:else}
      <Conversation.TurnNote>Nothing has been said in this meeting yet.</Conversation.TurnNote>
    {/each}
  </Conversation.Transcript>
{/snippet}

{#snippet panelBody()}
    <div class="flex flex-col gap-4">
      {#if !inline}<h2 class="text-sm font-medium">Chat</h2>{/if}
      {#if withQuestions}
        <!-- Everything said, or only the questions in the order a host works them. -->
        <div class="flex gap-4" role="group" aria-label="Show">
          <Button
            variant={showing === "all" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={showing === "all"}
            onclick={() => (showing = "all")}
          >
            All
          </Button>
          <Button
            variant={showing === "questions" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={showing === "questions"}
            onclick={() => (showing = "questions")}
          >
            <MessageCircleQuestionMark class="size-16" aria-hidden="true" />
            Questions
          </Button>
        </div>
      {/if}
      <!-- The one fact a reader needs to read the rest correctly: this is not the room, it is the
           record. Said once, where the decision to type is made. -->
      <p class="text-xs text-text-muted">
        What is said here is kept on the meeting&rsquo;s record. Taking a message back leaves a
        mark where it was.
      </p>
    </div>

    <!-- The read's own three states are the region's: the shape while it is in flight, the notice
         with Retry where it refused, and the transcript. An empty one says so INSIDE its own frame,
         which is why there is no fourth branch here. -->
    <LoadingRegion
      class="flex min-h-0 flex-1 flex-col"
      {loading}
      {failed}
      label="Reading what has been said in this meeting"
      {fixture}
      failure={readFailure}
    >
      {#if !withQuestions}
        {@render transcript(messages, true)}
      {:else if showing === "questions"}
        {@render questionsOnly()}
      {:else}
        {@render everything()}
      {/if}
    </LoadingRegion>

    {@render writeFailure?.()}
    {@render questionFailure?.()}

    <!-- The composer paints itself on the ordinary surface, and this one stands on the overlay the
         popover is drawn on: in a dark theme those are two different neutrals, so the foot of the
         panel would otherwise be a shade darker than the transcript above it. The gutters go for
         the same reason — the popover already has its own. -->
    <Conversation.Composer class="{inline ? '' : 'bg-surface-overlay'} px-0">
      <Label for="meeting-chat-message">{asking_ ? "Your question" : "Your message"}</Label>
      <Textarea
        id="meeting-chat-message"
        bind:value={draft}
        rows={2}
        resizable={false}
        onkeydown={composerKeydown}
      />
      {#if roomLeft <= ROOM_LEFT_STATED_FROM}
        <p class="text-xs text-text-muted">
          {tooLong
            ? `${String(-roomLeft)} characters too many.`
            : `${String(roomLeft)} characters left.`}
        </p>
      {/if}
      {#snippet actions()}
        {#if withQuestions}
          <span class="me-auto flex items-center gap-8">
            <Checkbox id="meeting-chat-as-question" bind:checked={asQuestion} />
            <Label for="meeting-chat-as-question">Ask as a question</Label>
          </span>
        {/if}
        {#if sharesFiles}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={buttonClasses({ variant: "ghost", size: "icon" })}
              aria-label={uploading ? "Uploading a file" : "Share a file"}
              disabled={sending || uploading || tooLong}
            >
              <Paperclip class="size-16" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onSelect={() => (sharingExisting = true)}>
                Existing File
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => filePicker?.click()}>Upload File</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
        <Button onclick={() => void say()} disabled={!canSay}>
          <SendHorizontal class="size-16" aria-hidden="true" />
          {#if asking_}
            {asking ? "Asking" : "Ask"}
          {:else}
            {sending ? "Sending" : "Send"}
          {/if}
        </Button>
      {/snippet}
    </Conversation.Composer>
    {#if sharesFiles && matterId !== null}
      <input
        bind:this={filePicker}
        type="file"
        class="sr-only"
        aria-hidden="true"
        tabindex="-1"
        onchange={(event) => void uploadPicked(event)}
      />
      <MeetingChatFileDialog bind:open={sharingExisting} {matterId} onShare={shareExisting} />
    {/if}
{/snippet}

{#if inline}
  <!-- Drawn in the room's side panel, beside the picture rather than over it. -->
  <div class="flex min-h-0 flex-1 flex-col gap-8">
    {@render panelBody()}
  </div>
{:else}
<Popover.Root bind:open>
  <Popover.Trigger class={buttonClasses({ variant: "secondary", size: "default" })}>
    <MessageSquare class="size-16" aria-hidden="true" />
    Chat
    {#if unread > 0}
      <!-- The count is how a member learns something was said while they were watching the room
           rather than the panel. It goes when the panel opens, because then they have seen it. -->
      <Badge variant="primary">{unread}</Badge>
    {/if}
  </Popover.Trigger>

  <Popover.Content
    class="flex flex-col gap-8"
    style="inline-size: var(--mc-size-record-context); max-block-size: var(--bits-floating-available-height)"
  >
    {@render panelBody()}
  </Popover.Content>
</Popover.Root>
{/if}
