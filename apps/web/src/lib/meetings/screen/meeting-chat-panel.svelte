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
   */
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as Conversation from "@magna-carta/design-system/conversation";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Popover from "@magna-carta/design-system/popover";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
  import { SAMPLE_SENTENCE, samplePerson, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import { wasTakenBack } from "$lib/meetings/client/chat.svelte.ts";
  import { MAX_MEETING_MESSAGE_LENGTH } from "$lib/meetings/meetings-api.ts";
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
  }: {
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
  } = $props();

  const stated = $derived(draft.trim());
  /** How much room is left in this message. Negative once there is none. */
  const roomLeft = $derived(MAX_MEETING_MESSAGE_LENGTH - stated.length);
  const tooLong = $derived(roomLeft < 0);
  const canSay = $derived(stated !== "" && !tooLong && !sending);

  async function say(): Promise<void> {
    if (!canSay) return;
    // The field is cleared only once the record has it, so a refused message is still there to try
    // again with rather than something the reader has to type a second time.
    if (await onSend(stated)) draft = "";
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
  }));
</script>

{#snippet fixture()}
  {@render transcript(FIXTURE, false)}
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
          <Conversation.TurnBody>{message.body}</Conversation.TurnBody>
        {/if}
      </Conversation.Turn>
    {:else}
      <Conversation.TurnNote>Nothing has been said in this meeting yet.</Conversation.TurnNote>
    {/each}
  </Conversation.Transcript>
{/snippet}

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
    <div class="flex flex-col gap-4">
      <h2 class="text-sm font-medium">Chat</h2>
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
      {@render transcript(messages, true)}
    </LoadingRegion>

    {@render writeFailure?.()}

    <!-- The composer paints itself on the ordinary surface, and this one stands on the overlay the
         popover is drawn on: in a dark theme those are two different neutrals, so the foot of the
         panel would otherwise be a shade darker than the transcript above it. The gutters go for
         the same reason — the popover already has its own. -->
    <Conversation.Composer class="bg-surface-overlay px-0">
      <Label for="meeting-chat-message">Your message</Label>
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
        <Button onclick={() => void say()} disabled={!canSay}>
          <SendHorizontal class="size-16" aria-hidden="true" />
          {sending ? "Sending" : "Send"}
        </Button>
      {/snippet}
    </Conversation.Composer>
  </Popover.Content>
</Popover.Root>
