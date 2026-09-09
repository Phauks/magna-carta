<script lang="ts">
  /*
   * THE Magnus surface. One component, two screens: the member's own Magnus workspace and a
   * matter's Magnus section. They differ by which conversations they list, whether the rail stands
   * as a column or reduces to a switcher, and which matter a new conversation is kept on. Nothing
   * else, because a conversation is one record and a reader moving between the two screens should
   * not have to learn a second layout.
   *
   * THE MATTER LINK SCOPES THE RECORD, NOT THE PROMPT. A conversation kept on a matter's file is a
   * transcript that matter keeps; it puts none of that matter's content into anything the assistant
   * is sent. The section states that in one line above the composer, because standing inside a
   * matter is the whole reason a reader would assume the opposite. That line stays until context
   * grants ship, and no wording here may soften it.
   *
   * THE AVAILABILITY READ COMES FIRST, always, because three of its four answers mean there is no
   * composer to draw: the firm has not consented to model processing, the firm has not turned the
   * assistant on, or this member has not accepted the disclosure in force. Each is its own screen
   * with its own honest words, and the two firm decisions name who can change them rather than
   * offering a control the reader cannot press.
   *
   * A CONVERSATION IS STARTED BY ASKING SOMETHING. Pressing New clears the transcript and puts the
   * cursor in the composer; the record is written when the first message is sent. That is what
   * keeps the rail free of conversations nobody asked anything in, and it is why the matter section
   * needs no create control of its own: the gesture is the composer, which is where the matter's
   * header create control declines to send anybody.
   *
   * NOTHING ABOUT A CONVERSATION IS LOGGED HERE. Not a console line, not a diagnostics record: a
   * failure reports what the server said about the request, never what anybody typed.
   */
  import * as Conversation from "@magna-carta/design-system/conversation";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Textarea from "@magna-carta/design-system/textarea";
  import { instantAttribute } from "@magna-carta/design-system/formatters";
  import { SAMPLE_SENTENCE, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ConversationDeleteDialog from "./conversation-delete-dialog.svelte";
  import MagnusDisclosure from "./magnus-disclosure.svelte";
  import MagnusUnavailable from "./magnus-unavailable.svelte";
  import { ConversationSession } from "./conversation-session.svelte.ts";
  import { MatterCitations } from "./matter-citations.svelte.ts";
  import {
    ALLOWANCE_WORTH_SAYING_AT,
    acknowledgeDisclosure,
    conversationDisplayName,
    conversationStartedLine,
    listConversations,
    newWriteKey,
    readAvailability,
    renameConversation,
    startConversation,
    turnFailureSentence,
    type MagnusAvailability,
    type MagnusConversation,
    type MagnusTurn,
  } from "./magnus-api.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";

  interface Props {
    /** What identifies the rows on screen, so a change of subject is told from a reload. */
    subject: string;
    /**
     * Which matter's file a new conversation is kept on, and the filter the list reads. Null on the
     * member's own workspace, where a conversation belongs to no matter.
     */
    matterId: string | null;
    /**
     * How the conversations are offered. A workspace stands them as a column beside the transcript;
     * a matter usually has few, so its section reduces them to a switcher rather than spending a
     * third of the width on a list of two.
     */
    rail: "column" | "switcher";
    /** Rows cite the matter they are kept on, on a list that spans several. */
    showMatter?: boolean;
    /** A sample matter has no firm behind it and therefore nothing to read. */
    isSample?: boolean;
    /** What to say when nobody has asked anything here yet. */
    emptyTitle: string;
    emptyDescription: string;
    /**
     * Why the screen's create control cannot start a conversation right now, or undefined while it
     * can. Bound OUT of here because the answer is the availability read's, and the control that
     * carries it lives in the screen's header where that read is not: a control the reader cannot
     * use is disabled with the reason, never live and inert.
     */
    createRefusal?: string | undefined;
  }

  let {
    subject,
    matterId,
    rail,
    showMatter = false,
    isSample = false,
    emptyTitle,
    emptyDescription,
    createRefusal = $bindable(undefined),
  }: Props = $props();

  /** The switcher's value for a conversation that has not been started yet. */
  const UNSTARTED = "unstarted";

  const conversations = new PagedList<MagnusConversation>(
    "Your conversations with Magnus could not be read.",
  );
  const session = new ConversationSession(fetch);
  const citations = new MatterCitations(fetch);

  let availability = $state<MagnusAvailability | null>(null);
  let availabilityFailure = $state<StatedFailure | null>(null);
  let acceptFailure = $state<StatedFailure | null>(null);
  let startFailure = $state<StatedFailure | null>(null);
  let renameFailure = $state<StatedFailure | null>(null);
  let accepting = $state(false);
  let starting = $state(false);
  let renaming = $state(false);
  let draftTitle = $state("");
  let draft = $state("");
  let selectedId = $state<string | null>(null);
  /*
   * True only while the reader has DELIBERATELY asked for a fresh conversation. It is what tells
   * that state apart from "the screen has not opened anything yet", which otherwise look identical
   * — both are `selectedId === null` — and it is why arriving opens the newest conversation while
   * pressing New does not immediately undo itself.
   */
  let composingNew = $state(false);
  let deletingConversation = $state<MagnusConversation | null>(null);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let loadedSubject: string | null = null;

  const rows = $derived(conversations.items);
  const readFailure = $derived(conversations.failure);
  const turns = $derived(session.turns);
  const isOpen = $derived(availability?.state === "open");
  const showsDisclosure = $derived(availability?.state === "acknowledgement-required");
  const firmGate = $derived.by((): "firm-ineligible" | "feature-disabled" | null => {
    const state = availability?.state;
    return state === "firm-ineligible" || state === "feature-disabled" ? state : null;
  });
  const remainingDailyTurns = $derived(availability?.remainingDailyTurns);
  const allowanceSpent = $derived(remainingDailyTurns === 0);
  const allowanceWorthSaying = $derived(
    remainingDailyTurns !== undefined && remainingDailyTurns <= ALLOWANCE_WORTH_SAYING_AT,
  );
  const selected = $derived(rows?.find((row) => row.id === selectedId) ?? null);
  const sendRefused = $derived(allowanceSpent || starting || session.sending);

  /*
   * Why a conversation cannot be started right now. Every answer but `open` means there is no
   * composer on the page to put a cursor in, so a live control would clear some state, focus
   * nothing, and leave the reader with no idea why the press did nothing.
   */
  const startRefusal = $derived.by((): string | undefined => {
    if (isSample) {
      return "This is one of the sample matters, so there is no firm behind it to ask anything about.";
    }
    if (availabilityFailure !== null) {
      return "Whether Magnus can be used here could not be read, so nothing can be started.";
    }
    if (availability === null) return "Whether Magnus can be used here has not been read yet.";
    if (availability.state === "firm-ineligible") {
      return "The firm has not consented to sending its content to an outside model provider, so Magnus cannot be asked anything. An administrator records that decision in the firm's settings.";
    }
    if (availability.state === "feature-disabled") {
      return "The firm has not turned Magnus on. An administrator turns it on in the firm's settings.";
    }
    if (availability.state === "acknowledgement-required") {
      return "Accept the disclosure on this screen before starting a conversation.";
    }
    return undefined;
  });

  $effect(() => {
    createRefusal = startRefusal;
  });

  /*
   * The whole surface is unusable until the gate answers, and once it is open the conversations are
   * what the surface is made of, so the two reads settle as one region rather than as two skeletons
   * one after the other. A failed FIRST read settles to the notice with Retry, so the shape never
   * stands over nothing.
   */
  const reading = $derived(availability === null || (isOpen && rows === null));
  const readingFailed = $derived(
    availabilityFailure !== null || (readFailure !== null && (rows?.length ?? 0) === 0),
  );

  $effect(() => {
    if (loadedSubject === subject) return;
    loadedSubject = subject;
    availability = null;
    availabilityFailure = null;
    acceptFailure = null;
    startFailure = null;
    renameFailure = null;
    draft = "";
    draftTitle = "";
    renaming = false;
    selectedId = null;
    composingNew = false;
    session.close();
    citations.reset();
    conversations.reset(subject);
    if (isSample) return;
    void refreshAvailability();
  });

  $effect(() => () => {
    session.dispose();
  });

  async function refreshAvailability(): Promise<void> {
    const outcome = await readAvailability(fetch);
    if (outcome.kind !== "ok") {
      availabilityFailure = stated(
        outcome.failure,
        "Whether Magnus can be used here could not be read.",
        "Nothing answered, so whether Magnus can be used here is not known.",
      );
      return;
    }
    availabilityFailure = null;
    availability = outcome.value;
    if (outcome.value.state === "open" && rows === null) void loadConversations();
  }

  function readPage(cursor?: string) {
    return listConversations(fetch, cursor, matterId === null ? {} : { matterId });
  }

  async function loadConversations(): Promise<void> {
    await conversations.load(readPage);
    if (showMatter) void citations.resolve((conversations.items ?? []).map((row) => row.matterId));
    openNewestIfNothingIsOpen();
  }

  /*
   * ARRIVING OPENS THE NEWEST CONVERSATION. The screen's question is "what did I ask, and what do I
   * want to ask now", and leaving the first half one click away for no reason is what put an empty
   * state on a screen whose rail was showing conversations. The listing is newest first, so the
   * newest is the first row.
   *
   * It never overrides the reader: pressing New says they want a fresh one, and this leaves that
   * alone. After a delete it does run, which is right — the screen goes on showing a conversation
   * rather than the words for a member who has never asked anything.
   */
  function openNewestIfNothingIsOpen(): void {
    if (composingNew || selectedId !== null) return;
    const newest = conversations.items?.[0];
    if (newest === undefined) return;
    select(newest.id);
  }

  async function loadMoreConversations(): Promise<void> {
    await conversations.loadMore(readPage);
    if (showMatter) void citations.resolve((conversations.items ?? []).map((row) => row.matterId));
  }

  function retryRead(): void {
    availability = null;
    availabilityFailure = null;
    conversations.reset(subject);
    void refreshAvailability();
  }

  async function accept(): Promise<void> {
    accepting = true;
    acceptFailure = null;
    const outcome = await acknowledgeDisclosure(fetch, newWriteKey());
    accepting = false;
    if (outcome.kind !== "ok") {
      acceptFailure = stated(
        outcome.failure,
        "The disclosure was not accepted.",
        "Nothing answered. The disclosure was not accepted, and nothing was recorded.",
      );
      return;
    }
    availability = null;
    await refreshAvailability();
  }

  /**
   * Clear the transcript and put the cursor in the composer. The record itself is written when the
   * first message is sent, so pressing this twice leaves nothing behind.
   */
  export function startNew(): void {
    if (startRefusal !== undefined) return;
    selectedId = null;
    composingNew = true;
    session.close();
    draft = "";
    renaming = false;
    startFailure = null;
    composerElement?.focus();
  }

  function select(conversationId: string): void {
    selectedId = conversationId;
    composingNew = false;
    renaming = false;
    renameFailure = null;
    startFailure = null;
    if (!session.showing(conversationId)) session.open(conversationId);
  }

  function switchTo(value: string): void {
    if (value === UNSTARTED) startNew();
    else select(value);
  }

  async function send(): Promise<void> {
    const message = draft.trim();
    if (message === "" || sendRefused) return;
    if (session.conversationId === null) {
      starting = true;
      startFailure = null;
      const outcome = await startConversation(fetch, { matterId }, newWriteKey());
      starting = false;
      if (outcome.kind !== "ok") {
        startFailure = stated(
          outcome.failure,
          "The conversation was not started, so nothing was asked.",
          "Nothing answered. The conversation was not started and nothing was asked.",
        );
        return;
      }
      session.adopt(outcome.value.id);
      selectedId = outcome.value.id;
      composingNew = false;
    }
    const sent = await session.send(message);
    if (!sent) return;
    draft = "";
    void loadConversations();
    void refreshAvailability();
  }

  function composerKeydown(event: KeyboardEvent): void {
    // Enter writes a newline, because a question worth asking often runs past one line. The visible
    // way to send is the button beside the field; this is the shortcut for a reader who prefers it.
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void send();
  }

  function beginRename(): void {
    if (selected === null) return;
    draftTitle = selected.title ?? "";
    renaming = true;
    renameFailure = null;
  }

  async function commitRename(): Promise<void> {
    const conversation = selected;
    if (conversation === null) return;
    const title = draftTitle.trim();
    const outcome = await renameConversation(
      fetch,
      conversation.id,
      title === "" ? null : title,
      newWriteKey(),
    );
    if (outcome.kind !== "ok") {
      renameFailure = stated(
        outcome.failure,
        "The conversation was not renamed.",
        "Nothing answered. The conversation was not renamed and still reads as it did.",
      );
      return;
    }
    renaming = false;
    renameFailure = null;
    void loadConversations();
  }

  function conversationDeleted(): void {
    deletingConversation = null;
    selectedId = null;
    composingNew = false;
    session.close();
    void loadConversations();
  }

  /** The speaker's name as a reader meets it. */
  function speakerName(turn: MagnusTurn): string {
    return turn.speaker === "member" ? "You" : "Magnus";
  }

  function turnState(turn: MagnusTurn): "settled" | "pending" | "failed" {
    if (turn.status === "pending") return "pending";
    return turn.status === "complete" ? "settled" : "failed";
  }
</script>

{#snippet messageGlyph()}
  <MessageSquare aria-hidden="true" />
{/snippet}

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

{#snippet transcriptFixture()}
  {@render transcriptShape([
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
  ])}
{/snippet}

{#snippet composer()}
  <Conversation.Composer>
    {#if matterId !== null}
      <!-- The one sentence the surrounding matter makes necessary: standing inside a file is the
           whole reason a reader would assume the assistant can read it. It goes when context grants
           ship, and not before. -->
      <p class="text-sm text-text-muted">
        Magnus reads only what you type in this conversation. Keeping the conversation on this
        matter&rsquo;s file does not let Magnus read the matter: not its documents, not its calendar,
        not its parties.
      </p>
    {/if}
    <Label for="magnus-composer">Your message</Label>
    <Textarea
      id="magnus-composer"
      bind:ref={composerElement}
      bind:value={draft}
      rows={3}
      disabled={sendRefused}
      onkeydown={composerKeydown}
    />
    {#snippet actions()}
      <Button
        onclick={send}
        disabled={draft.trim() === "" || sendRefused}
        title={allowanceSpent
          ? "The firm's daily allowance for Magnus is spent."
          : "Send this message to Magnus."}
      >
        <SendHorizontal aria-hidden="true" />
        {session.sending || starting ? "Sending" : "Send"}
      </Button>
    {/snippet}
    {#if allowanceSpent}
      <p class="text-sm text-text-muted">
        The firm&rsquo;s daily allowance for Magnus is spent. It resets tomorrow, and an
        administrator can raise it in the firm&rsquo;s settings.
      </p>
    {:else if allowanceWorthSaying && remainingDailyTurns !== undefined}
      <p class="text-sm text-text-muted">
        {remainingDailyTurns === 1
          ? "One message left in the firm's daily allowance today."
          : `${String(remainingDailyTurns)} messages left in the firm's daily allowance today.`}
      </p>
    {/if}
  </Conversation.Composer>
{/snippet}

{#snippet transcriptRegion()}
  <LoadingRegion
    loading={turns === null}
    failed={session.failure !== null && (turns?.length ?? 0) === 0}
    empty={session.failure === null && turns !== null && turns.length === 0}
    label="Reading this conversation"
    onRetry={() => session.reload()}
    fixture={transcriptFixture}
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
        <Button
          variant="ghost"
          disabled={session.loadingEarlier}
          onclick={() => session.loadEarlier()}
        >
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
{/snippet}

{#snippet conversationHeadRow()}
  <div class="flex flex-wrap items-center justify-between gap-8 px-24 pt-8">
    {#if renaming}
      <div class="flex flex-wrap items-end gap-8">
        <div class="flex flex-col gap-4">
          <Label for="magnus-conversation-title">Name</Label>
          <Input id="magnus-conversation-title" bind:value={draftTitle} class="w-2xs" />
        </div>
        <Button variant="secondary" onclick={commitRename}>Save Name</Button>
        <Button variant="ghost" onclick={() => (renaming = false)}>Cancel</Button>
      </div>
    {:else}
      <p class="text-sm text-text">
        {selected === null ? "This conversation" : conversationDisplayName(selected)}
      </p>
      <div class="flex items-center gap-4">
        <Button
          variant="ghost"
          onclick={beginRename}
          disabled={selected === null}
          title="Name this conversation"
        >
          <PencilLine aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          onclick={() => (deletingConversation = selected)}
          disabled={selected === null}
          title="Delete this conversation"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    {/if}
  </div>
  {#if renameFailure !== null}
    <div class="px-24">
      <FailureNotice
        failure={renameFailure.failure}
        title="Nothing Changed"
        fallback={renameFailure.fallback}
        whenSilent={renameFailure.whenSilent}
      />
    </div>
  {/if}
{/snippet}

{#snippet detailFixture()}
  <Conversation.Root class="min-h-0 flex-1">
    {@render transcriptFixture()}
    {@render composer()}
  </Conversation.Root>
{/snippet}

{#snippet conversationDetail()}
  <Conversation.Root class="min-h-0 flex-1">
    {#if selectedId !== null}
      {@render conversationHeadRow()}
      {@render transcriptRegion()}
    {:else}
      <!-- TWO ABSENCES, TWO SETS OF WORDS. Nothing on the record is the member never having asked
           anything, which is what the screen's own empty copy is for. A fresh composer while
           conversations stand beside it is a different state, and saying "nothing asked yet" there
           would be the detail pane contradicting the rail four inches away. -->
      <div class="flex min-h-0 flex-1 items-center justify-center px-24">
        {#if (rows?.length ?? 0) > 0}
          <EmptyState title="A New Conversation">
            Nothing has been asked in this one yet. Type a question below to start it.
          </EmptyState>
        {:else}
          <EmptyState title={emptyTitle}>{emptyDescription}</EmptyState>
        {/if}
      </div>
    {/if}

    {#if startFailure !== null}
      <div class="px-24">
        <FailureNotice
          failure={startFailure.failure}
          title="Nothing Was Asked"
          fallback={startFailure.fallback}
          whenSilent={startFailure.whenSilent}
        />
      </div>
    {/if}
    {#if session.submitFailure !== null}
      <div class="px-24">
        <FailureNotice
          failure={session.submitFailure}
          title="The Message Was Not Sent"
          fallback="The message was not sent, so Magnus was not asked."
          whenSilent="Nothing answered. The message was not sent and Magnus was not asked."
        />
      </div>
    {/if}

    {@render composer()}
  </Conversation.Root>
{/snippet}

{#snippet conversationRows(shown: readonly MagnusConversation[])}
  <ul class="flex flex-col gap-4" aria-label="Your conversations with Magnus">
    {#each shown as conversation (conversation.id)}
      <!-- The line beneath the name carries only what the name does not. An unnamed conversation
           READS as the instant it started, and unnamed is the ordinary case because nothing
           generates a title, so a line restating that instant would be the common row saying one
           fact twice. Where it has nothing to add, the row carries no line at all: absence is the
           signal, and an empty line would be a gap a reader has to wonder about. -->
      {@const startedAt = conversationStartedLine(conversation)}
      {@const matterTitle =
        showMatter && conversation.matterId !== null
          ? citations.titleFor(conversation.matterId)
          : null}
      {#snippet rowDetail()}
        {#if startedAt !== null}
          <time datetime={instantAttribute(conversation.createdAt)}>Started {startedAt}</time>
        {/if}
        {#if startedAt !== null && matterTitle !== null}
          <span>&middot;</span>
        {/if}
        {#if matterTitle !== null}
          <span>{matterTitle}</span>
        {/if}
      {/snippet}
      <li>
        <ChoiceRow
          selected={conversation.id === selectedId}
          onclick={() => select(conversation.id)}
          icon={messageGlyph}
          detail={startedAt === null && matterTitle === null ? undefined : rowDetail}
        >
          {conversationDisplayName(conversation)}
        </ChoiceRow>
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet railColumn()}
  {@render conversationRows(rows ?? [])}
  {#if (rows?.length ?? 0) === 0}
    <p class="text-sm text-text-muted">Nothing asked yet.</p>
  {/if}
  {#if conversations.nextCursor !== null}
    <Button variant="ghost" disabled={conversations.loadingMore} onclick={loadMoreConversations}>
      Show more conversations
    </Button>
  {/if}
{/snippet}

{#snippet railFixture()}
  {@render conversationRows([
    {
      id: "fixture-conversation-0",
      title: SAMPLE_SENTENCE,
      createdBy: "fixture",
      matterId: null,
      state: "active",
      createdAt: sampleInstant(0),
      updatedAt: sampleInstant(0),
    },
    {
      id: "fixture-conversation-1",
      title: null,
      createdBy: "fixture",
      matterId: null,
      state: "active",
      createdAt: sampleInstant(1),
      updatedAt: sampleInstant(1),
    },
  ])}
{/snippet}

{#snippet switcher()}
  <div class="flex flex-wrap items-center gap-8">
    <Label for="magnus-switcher">Conversation</Label>
    <Select.Root
      type="single"
      bind:value={() => selectedId ?? UNSTARTED, (value: string) => switchTo(value)}
    >
      <Select.Trigger id="magnus-switcher" class="w-2xs">
        {selected === null ? "A new conversation" : conversationDisplayName(selected)}
      </Select.Trigger>
      <Select.Content>
        <Select.Item value={UNSTARTED} label="A new conversation" />
        {#each rows ?? [] as conversation (conversation.id)}
          <Select.Item value={conversation.id} label={conversationDisplayName(conversation)} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
{/snippet}

{#snippet surfaceFixture()}
  {#if rail === "column"}
    <div class="flex min-h-0 flex-1 gap-24">
      <div class="flex w-2xs shrink-0 flex-col gap-8">{@render railFixture()}</div>
      <div class="flex min-h-0 flex-1 flex-col gap-16">{@render detailFixture()}</div>
    </div>
  {:else}
    {@render detailFixture()}
  {/if}
{/snippet}

{#if isSample}
  <EmptyState title="No Magnus Conversations On A Sample Matter">
    This is one of the sample matters the interface is reviewed against. It has no firm behind it,
    so there is nothing to ask Magnus about and no transcript to read.
  </EmptyState>
{:else}
  <LoadingRegion
    loading={reading}
    failed={readingFailed}
    label="Reading your conversations with Magnus"
    onRetry={retryRead}
    fixture={surfaceFixture}
    class="flex min-h-0 flex-1 flex-col gap-16"
  >
    {#snippet failure()}
      {#if availabilityFailure !== null}
        <FailureNotice
          failure={availabilityFailure.failure}
          title="Magnus Is Unavailable"
          fallback={availabilityFailure.fallback}
          whenSilent={availabilityFailure.whenSilent}
          onRetry={retryRead}
        />
      {:else if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="Your Conversations Could Not Be Read"
          fallback="Your conversations with Magnus could not be read."
          onRetry={retryRead}
        />
      {/if}
    {/snippet}

    {#if showsDisclosure}
      {#if acceptFailure !== null}
        <FailureNotice
          failure={acceptFailure.failure}
          title="Nothing Changed"
          fallback={acceptFailure.fallback}
          whenSilent={acceptFailure.whenSilent}
        />
      {/if}
      <MagnusDisclosure
        disclosureVersion={availability?.disclosureVersion}
        {accepting}
        onAccept={accept}
      />
    {:else if firmGate !== null}
      <MagnusUnavailable state={firmGate} />
    {:else if rail === "column"}
      <div class="flex min-h-0 flex-1 gap-24">
        <div class="mc-scrollbar flex w-2xs shrink-0 flex-col gap-8 overflow-y-auto">
          {@render railColumn()}
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-16">
          {@render conversationDetail()}
        </div>
      </div>
    {:else}
      {#if (rows?.length ?? 0) > 0}
        {@render switcher()}
      {/if}
      {@render conversationDetail()}
    {/if}
  </LoadingRegion>
{/if}

<ConversationDeleteDialog
  bind:open={
    () => deletingConversation !== null,
    (open: boolean) => {
      if (!open) deletingConversation = null;
    }
  }
  conversation={deletingConversation}
  onDeleted={conversationDeleted}
/>
