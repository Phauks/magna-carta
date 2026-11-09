<script lang="ts">
  /*
   * THE Magnus surface. One component, two screens: the member's own Magnus workspace and a
   * matter's Magnus section. They differ by which conversations they list, whether the rail stands
   * as a column or reduces to a switcher, and which matter a new conversation is kept on. Nothing
   * else, because a conversation is one record and a reader moving between the two screens should
   * not have to learn a second layout.
   *
   * IT IS A COMPOSITION OF THREE PARTS. The rail (magnus-rail.svelte) lists and orders the
   * conversations; the transcript (magnus-transcript.svelte) reads one; the composer
   * (magnus-composer.svelte) adds to it. This file holds the state the three share — which
   * conversation is open, whether the assistant can be used here at all, the reads that fill the
   * rail — and the acts on a conversation: naming it in place, keeping it on a matter, attaching a
   * matter's files, deleting it. The workspace's two sides are the design system's
   * `NavigationLayout` — the rail in its navigation column, the header and the open conversation in
   * its content column — so this file draws no column frame, width or scroll region of its own.
   *
   * THE MATTER LINK SCOPES THE RECORD, NOT THE PROMPT. A conversation kept on a matter's file is a
   * transcript that matter keeps; being kept there puts none of that matter's content into anything
   * the assistant is sent. What DOES reach the assistant beyond the typed question is the readable
   * text of the files a member attaches to the conversation, by reference, and the composer's line
   * says exactly that, composed from what is attached rather than written once.
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
  import type { Snippet } from "svelte";
  import * as Conversation from "@magna-carta/design-system/conversation";
  import Button from "@magna-carta/design-system/button";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import NavigationLayout from "@magna-carta/design-system/navigation-layout";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { SAMPLE_SENTENCE, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Briefcase from "@lucide/svelte/icons/briefcase";
  import AttachFileDialog from "./attach-file-dialog.svelte";
  import ConversationDeleteDialog from "./conversation-delete-dialog.svelte";
  import ConversationName from "./conversation-name.svelte";
  import MagnusComposer from "./magnus-composer.svelte";
  import MagnusDisclosure from "./magnus-disclosure.svelte";
  import MagnusRail from "./magnus-rail.svelte";
  import MagnusTranscript from "./magnus-transcript.svelte";
  import MagnusUnavailable from "./magnus-unavailable.svelte";
  import MoveConversationDialog from "./move-conversation-dialog.svelte";
  import { ConversationSession } from "./conversation-session.svelte.ts";
  import { MatterCitations } from "./matter-citations.svelte.ts";
  import {
    ALLOWANCE_WORTH_SAYING_AT,
    acknowledgeDisclosure,
    conversationDisplayName,
    detachFile,
    listConversations,
    newWriteKey,
    readAvailability,
    startConversation,
    type ConversationSort,
    type MagnusAvailability,
    type MagnusConversation,
  } from "./magnus-api.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
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
    /**
     * The screen's own header, drawn at the top of the content column. Only the workspace has one:
     * the design system's navigation layout takes the full height under the top bar, so a header
     * belongs inside it rather than above it. The matter section draws none (its masthead is the
     * matter's).
     *
     * It is handed this surface's SEARCH to seat in its action row. WHAT the search reaches is
     * decided here, beside the read it narrows; WHERE the control sits is the header's business.
     */
    header?: Snippet<[Snippet]>;
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
    header,
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
  let detachFailure = $state<StatedFailure | null>(null);
  let accepting = $state(false);
  let starting = $state(false);
  let draft = $state("");
  let sort = $state<ConversationSort>("date");
  /*
   * What the rail is being asked. `searchText` is the field's; `appliedSearch` is what the server was
   * last asked for, and ScreenSearch owns the pause between them.
   *
   * It is a filter on the READ, never over the rows in hand: the rail is paged, so narrowing what
   * happened to arrive would tell a member their question was never asked when it is simply two
   * pages down. It reaches what they SAID, which is the only way a conversation nobody titled is
   * found again.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  const searching = $derived(appliedSearch.trim() !== "");
  let selectedId = $state<string | null>(null);
  /*
   * True only while the reader has DELIBERATELY asked for a fresh conversation. It is what tells
   * that state apart from "the screen has not opened anything yet", which otherwise look identical
   * — both are `selectedId === null` — and it is why arriving opens the newest conversation while
   * pressing New does not immediately undo itself.
   */
  let composingNew = $state(false);
  let deletingConversation = $state<MagnusConversation | null>(null);
  let movingConversation = $state<MagnusConversation | null>(null);
  let attachingTo = $state<MagnusConversation | null>(null);
  let detachingFileId = $state<string | null>(null);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let loadedSubject: string | null = null;

  const rows = $derived(conversations.items);
  const readFailure = $derived(conversations.failure);
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
  /** The matter the OPEN conversation is kept on, which is what attaching reaches and moving leaves. */
  const openMatterId = $derived(selected?.matterId ?? matterId);

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

  /*
   * Why a file cannot be attached right now. Files are matter-rooted, so a conversation on no
   * matter has none to reach, and a conversation not yet written has nothing to attach to.
   */
  const attachRefusal = $derived.by((): string | undefined => {
    if (selected === null) {
      return "Ask the first question to start the conversation, then attach a file to it.";
    }
    if (openMatterId === null) {
      return "This conversation is kept on no matter, so there are no files to reach. Keep it on a matter first.";
    }
    return undefined;
  });

  $effect(() => {
    createRefusal = startRefusal;
  });

  /* The open conversation's matter is named under its title, so its citation is read even where the
     rail itself cites none. The read is remembered, so reopening the same matter costs nothing. */
  $effect(() => {
    const keptOn = selected?.matterId ?? null;
    if (matterId === null && keptOn !== null) void citations.resolve([keptOn]);
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
    detachFailure = null;
    draft = "";
    selectedId = null;
    composingNew = false;
    searchText = "";
    appliedSearch = "";
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
    return listConversations(fetch, cursor, {
      ...(matterId === null ? {} : { matterId }),
      ...(appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() }),
      sort,
    });
  }

  async function loadConversations(): Promise<void> {
    await conversations.load(readPage);
    if (showMatter) void citations.resolve((conversations.items ?? []).map((row) => row.matterId));
    openNewestIfNothingIsOpen();
  }

  /*
   * A change of order is a fresh read of the whole record in that order, never a re-ordering of the
   * page in hand. The open conversation stays open: the reader changed how the rail is read, not
   * what they were reading.
   */
  /*
   * A new question is a new list, so the rows are replaced rather than appended to — the subject
   * carries the query for exactly that reason. It deliberately does NOT re-open the newest result: a
   * reader searching is looking for one conversation, and yanking the transcript pane onto a
   * different one on every pause would make the search unusable.
   */
  async function applySearch(next: string): Promise<void> {
    appliedSearch = next;
    conversations.reset(`${subject}:${next.trim()}`);
    await conversations.load(readPage);
    if (showMatter) void citations.resolve((conversations.items ?? []).map((row) => row.matterId));
  }

  function reorder(next: ConversationSort): void {
    sort = next;
    conversations.reset(subject);
    void loadConversations();
  }

  /*
   * ARRIVING OPENS THE NEWEST CONVERSATION. The screen's question is "what did I ask, and what do I
   * want to ask now", and leaving the first half one click away for no reason is what put an empty
   * state on a screen whose rail was showing conversations. The listing is newest first by default,
   * so the newest is the first row; under another order it is still the first row the reader sees.
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
    startFailure = null;
    detachFailure = null;
    composerElement?.focus();
  }

  function select(conversationId: string): void {
    selectedId = conversationId;
    composingNew = false;
    startFailure = null;
    detachFailure = null;
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

  /** The rail is read again after a rename, so the row and the head agree on the name. */
  function conversationRenamed(): void {
    void loadConversations();
  }

  function conversationMoved(): void {
    movingConversation = null;
    // The conversation may have left this section's filter or gained a matter to cite: the rail is
    // read again, and the transcript too, because the attachments went with the move.
    session.reload();
    void loadConversations();
  }

  async function removeAttachment(fileId: string): Promise<void> {
    const conversation = selected;
    if (conversation === null || detachingFileId !== null) return;
    detachingFileId = fileId;
    detachFailure = null;
    const outcome = await detachFile(fetch, conversation.id, fileId, newWriteKey());
    detachingFileId = null;
    if (outcome.kind !== "ok") {
      detachFailure = stated(
        outcome.failure,
        "The file was not taken off the conversation.",
        "Nothing answered. The file is still attached.",
      );
      return;
    }
    session.adoptAttachments(outcome.value);
  }

  function conversationDeleted(): void {
    deletingConversation = null;
    selectedId = null;
    composingNew = false;
    session.close();
    void loadConversations();
  }

  const FIXTURE_ROWS: readonly MagnusConversation[] = [
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
  ];
</script>

{#snippet composer()}
  <MagnusComposer
    bind:draft
    bind:composerElement
    onMatter={openMatterId !== null}
    attachments={session.attachments}
    model={availability?.model}
    sending={session.sending || starting}
    {sendRefused}
    {allowanceSpent}
    {remainingDailyTurns}
    {allowanceWorthSaying}
    {attachRefusal}
    {detachingFileId}
    onSend={send}
    onAttach={() => (attachingTo = selected)}
    onDetach={(fileId) => void removeAttachment(fileId)}
  />
{/snippet}

{#snippet conversationHeadRow()}
  <!-- The conversation's name, edited where it is read, and the acts on the record beside it. The
       acts are named controls with the design system's hover, never native titles, and each one is
       refused with its reason while nothing is open rather than absent. -->
  <div class="flex flex-wrap items-start justify-between gap-8 px-24 pt-8">
    <!-- The name over the matter it is kept on, set small: the matter is where the conversation
         lives, and a reader on the workspace (which spans every matter) needs it without it
         competing with the name. Inside a matter's own section the masthead already says it. -->
    <div class="flex min-w-0 flex-col gap-4">
      <ConversationName
        conversation={selected}
        disabled={session.sending}
        onRenamed={conversationRenamed}
      />
      {#if matterId === null && selected !== null}
        {@const keptOn = selected.matterId}
        <p class="flex min-w-0 items-center gap-4 text-xs text-text-muted">
          <Briefcase class="size-12 shrink-0" aria-hidden="true" />
          {#if keptOn === null}
            <span>Not kept on a matter</span>
          {:else}
            {@const number = citations.numberFor(keptOn)}
            {@const title = citations.titleFor(keptOn)}
            <span class="truncate">
              {#if number !== null}<span class="font-medium">{number}</span>{/if}
              {#if number !== null && title !== null}<span aria-hidden="true"> · </span>{/if}
              {title ?? (number === null ? "A matter" : "")}
            </span>
          {/if}
        </p>
      {/if}
    </div>
    <div class="flex items-center gap-4">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              disabled={selected === null}
              onclick={() => (movingConversation = selected)}
              aria-label="Keep this conversation on a matter"
            >
              <FolderInput class="size-16" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Keep on a matter</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              disabled={selected === null}
              onclick={() => (deletingConversation = selected)}
              aria-label="Delete this conversation"
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Delete</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </div>
{/snippet}

{#snippet detailFixture()}
  <Conversation.Root class="min-h-0 flex-1">
    <MagnusTranscript {session} />
    {@render composer()}
  </Conversation.Root>
{/snippet}

{#snippet conversationDetail()}
  <Conversation.Root class="min-h-0 flex-1">
    {#if selectedId !== null}
      {@render conversationHeadRow()}
      <MagnusTranscript {session} />
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
    {#if detachFailure !== null}
      <div class="px-24">
        <FailureNotice
          failure={detachFailure.failure}
          title="Nothing Changed"
          fallback={detachFailure.fallback}
          whenSilent={detachFailure.whenSilent}
        />
      </div>
    {/if}

    {@render composer()}
  </Conversation.Root>
{/snippet}

<!-- The surface's search, for the header to seat. It grows toward the inline start as it opens, so a
     create control after it in the header's row never moves. -->
{#snippet searchControls()}
  <ScreenSearch
    bind:value={searchText}
    label="Search your conversations"
    searchOn="pause"
    fieldClass="w-2xs sm:w-xs"
    disabled={isSample || !isOpen}
    onsearch={(next) => void applySearch(next)}
  />
{/snippet}

{#snippet railRows(shown: readonly MagnusConversation[])}
  <MagnusRail
    rows={shown}
    {selectedId}
    bind:sort
    onMatter={matterId !== null}
    matterTitleFor={showMatter ? (id) => citations.titleFor(id) : undefined}
    nextCursor={conversations.nextCursor}
    loadingMore={conversations.loadingMore}
    emptyLine={searching
      ? `Nothing you asked matches "${appliedSearch.trim()}".`
      : "Nothing asked yet."}
    onSelect={select}
    onSortChange={reorder}
    onLoadMore={loadMoreConversations}
  />
{/snippet}

{#snippet railFixture()}
  {@render railRows(FIXTURE_ROWS)}
{/snippet}

<!-- THE GATED STATES AND THE RECORD, behind one region. Every answer of the availability read but
     `open` means there is no composer to draw, and each gets its own honest words; a failed first
     read settles to the notice with Retry, so the shape never stands over nothing. -->
{#snippet gatedOrDetail()}
  <LoadingRegion
    loading={reading}
    failed={readingFailed}
    label="Reading your conversations with Magnus"
    onRetry={retryRead}
    fixture={detailFixture}
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
    {:else}
      {#if rail === "switcher"}
        {@render switcher(rows ?? [])}
      {/if}
      {@render conversationDetail()}
    {/if}
  </LoadingRegion>
{/snippet}

{#snippet switcher(shown: readonly MagnusConversation[])}
  <!-- Inside a matter the conversations are few, so they are offered as the product's one closed
       choice — a combobox, never a select — with the order control beside it. The control is there
       with nothing to switch between: the rail with one row still shows how it is read. -->
  <div class="flex flex-wrap items-center gap-8">
    <Label for="magnus-switcher">Conversation</Label>
    <div class="w-2xs">
      <ChoicePicker
        inputId="magnus-switcher"
        label="Conversation"
        options={[
          { value: UNSTARTED, label: "A new conversation" },
          ...shown.map((conversation) => ({
            value: conversation.id,
            label: conversationDisplayName(conversation),
          })),
        ]}
        value={selectedId ?? UNSTARTED}
        onchange={switchTo}
      />
    </div>
    <MagnusRail
      rows={[]}
      selectedId={null}
      bind:sort
      onMatter
      emptyLine=""
      onSelect={select}
      onSortChange={reorder}
    />
  </div>
{/snippet}

{#if isSample}
  <EmptyState title="No Magnus Conversations On A Sample Matter">
    This is one of the sample matters the interface is reviewed against. It has no firm behind it,
    so there is nothing to ask Magnus about and no transcript to read.
  </EmptyState>
{:else if rail === "column"}
  <!-- THE WORKSPACE IS THE DESIGN SYSTEM'S TWO-SIDED SCREEN: the rail in the navigation column, the
       screen's header and the open conversation in the content column. The layout owns the width,
       the two scroll regions and the canvas geometry; the transcript owns its own scroller with the
       composer pinned beneath it, which is why the content column does not scroll as a whole. The
       rail stands only while the assistant is open here: behind a closed gate there is no record to
       order, and the content column carries the gate's own words. -->
  <NavigationLayout navigationLabel="Conversations" navigationWidth="narrow" contentScrolls={false}>
    {#snippet navigation()}
      {#if isOpen || reading}
        <LoadingRegion
          loading={reading}
          label="Reading your conversations"
          fixture={railFixture}
          class="flex flex-col gap-8"
        >
          {@render railRows(rows ?? [])}
        </LoadingRegion>
      {/if}
    {/snippet}
    <div class="flex min-h-0 flex-1 flex-col gap-16 p-24">
      {#if header}
        {@render header(searchControls)}
      {/if}
      {@render gatedOrDetail()}
    </div>
  </NavigationLayout>
{:else}
  {@render gatedOrDetail()}
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

<MoveConversationDialog
  bind:open={
    () => movingConversation !== null,
    (open: boolean) => {
      if (!open) movingConversation = null;
    }
  }
  conversation={movingConversation}
  attachmentCount={session.attachments.length}
  onMoved={conversationMoved}
/>

<AttachFileDialog
  bind:open={
    () => attachingTo !== null,
    (open: boolean) => {
      if (!open) attachingTo = null;
    }
  }
  conversation={attachingTo}
  onAttached={(attachments) => {
    attachingTo = null;
    session.adoptAttachments(attachments);
  }}
/>
