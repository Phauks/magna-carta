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
  import { tick, type Snippet } from "svelte";
  import * as Conversation from "@magna-carta/design-system/conversation";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import NavigationLayout from "@magna-carta/design-system/navigation-layout";
  import { SAMPLE_SENTENCE, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import Briefcase from "@lucide/svelte/icons/briefcase";
  import AttachFileDialog from "./attach-file-dialog.svelte";
  import ConversationDeleteDialog from "./conversation-delete-dialog.svelte";
  import ConversationFindBar from "./conversation-find-bar.svelte";
  import { findQuery, matchingTurnIds, shownTurns, steppedMatch } from "./conversation-find.ts";
  import ConversationMenu from "./conversation-menu.svelte";
  import ConversationName from "./conversation-name.svelte";
  import { conversationAuthor } from "./conversation-author.svelte.ts";
  import { conversationFromAddress, CONVERSATION_PARAMETER } from "./conversation-link.ts";
  import { readWholeTranscript, transcriptFileName, transcriptMarkdown } from "./transcript-export.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import { toast } from "@magna-carta/design-system/toast";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import MagnusComposer from "./magnus-composer.svelte";
  import MagnusDisclosure from "./magnus-disclosure.svelte";
  import MagnusRail from "./magnus-rail.svelte";
  import MagnusTranscript from "./magnus-transcript.svelte";
  import MagnusUnavailable from "./magnus-unavailable.svelte";
  import MoveConversationDialog from "./move-conversation-dialog.svelte";
  import TurnRemoveDialog from "./turn-remove-dialog.svelte";
  import { ConversationSession } from "./conversation-session.svelte.ts";
  import { ConversationShelf } from "./conversation-shelf.svelte.ts";
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
    type MagnusModelChoice,
    type MagnusTurn,
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
  /*
   * The member's folders and pins (R2.12). Only the column rail shows them: a matter's own section
   * lists its few conversations in one switcher, and a search reads the whole record as one list,
   * because a member searching is looking for a conversation wherever they keep it.
   */
  const shelf = new ConversationShelf(fetch, (filter) => (cursor) =>
    listConversations(fetch, cursor, {
      ...(matterId === null ? {} : { matterId }),
      sort,
      ...filter,
    }),
  );
  const citations = new MatterCitations(fetch);

  let availability = $state<MagnusAvailability | null>(null);
  let availabilityFailure = $state<StatedFailure | null>(null);
  let acceptFailure = $state<StatedFailure | null>(null);
  let startFailure = $state<StatedFailure | null>(null);
  let detachFailure = $state<StatedFailure | null>(null);
  let accepting = $state(false);
  let starting = $state(false);
  let draft = $state("");
  /** The model and effort the member chose for their next question; null is the firm's model. */
  let modelChoice = $state<MagnusModelChoice | null>(null);
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
  /** The member's own message being rewritten in the composer, or null when asking afresh. */
  let editingTurn = $state<MagnusTurn | null>(null);
  /** The member's own message the remove dialog is asking about. */
  let removingTurn = $state<MagnusTurn | null>(null);
  let attachingTo = $state<MagnusConversation | null>(null);
  let detachingFileId = $state<string | null>(null);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let loadedSubject: string | null = null;

  const rows = $derived(conversations.items);
  const shelved = $derived(rail === "column" && !searching);
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
  /*
   * The open conversation's record. Usually a row in the rail; a conversation opened from a link can
   * be one the rail has not paged to yet, and then the record the transcript read stands in.
   */
  const selected = $derived(
    rows?.find((row) => row.id === selectedId) ??
      (selectedId === null ? undefined : shelf.find(selectedId)) ??
      (session.conversation !== null && session.conversation.id === selectedId
        ? session.conversation
        : null),
  );
  let conversationName = $state<ReturnType<typeof ConversationName> | null>(null);
  let downloading = $state(false);
  /* Who asked, named the way the transcript names them, for the downloaded file's heading. */
  const author = conversationAuthor(() => selected?.createdBy ?? null);
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
      // With folders shown, this list is General: the conversations in no folder.
      ...(shelved ? { folder: "general" } : {}),
      sort,
    });
  }

  /* Pinned and the open folders are read again beside General, in the same order. */
  function reloadShelf(): void {
    if (shelved) void shelf.reload(`${subject}:${sort}`);
  }

  async function loadConversations(): Promise<void> {
    reloadShelf();
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
    reloadShelf();
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
    // A link to one conversation opens that one, whether or not the rail has paged to it; a link
    // to a conversation the reader cannot see settles as the transcript's own failure notice.
    const named = conversationFromAddress(page.url);
    if (named !== null) {
      select(named);
      return;
    }
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
    mirrorAddress(null);
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
    mirrorAddress(conversationId);
  }

  /*
   * The address names the open conversation, so reloading reopens it and the browser's own Copy
   * Link copies it. `replaceState`, never a navigation: choosing a conversation is not a new page,
   * and a history entry per click would make Back walk through every conversation looked at.
   */
  function mirrorAddress(conversationId: string | null): void {
    if (conversationFromAddress(page.url) === conversationId) return;
    const next = new URL(page.url.href);
    if (conversationId === null) next.searchParams.delete(CONVERSATION_PARAMETER);
    else next.searchParams.set(CONVERSATION_PARAMETER, conversationId);
    replaceState(next, page.state);
  }

  /** The matter line under the title, as words, for the downloaded file's heading. */
  function matterLineFor(keptOn: string | null): string | null {
    if (keptOn === null) return null;
    const number = citations.numberFor(keptOn);
    const title = citations.titleFor(keptOn);
    if (number !== null && title !== null) return `${number} · ${title}`;
    return number ?? title ?? "A matter";
  }

  async function downloadTranscript(): Promise<void> {
    const conversation = selected;
    if (conversation === null || downloading) return;
    downloading = true;
    const outcome = await readWholeTranscript(fetch, conversation.id);
    if (outcome.kind !== "ok") {
      downloading = false;
      toast.error("The transcript could not be read, so nothing was downloaded. Try again.");
      return;
    }
    const document = transcriptMarkdown(conversation, outcome.value, {
      memberName: author.name,
      matterLine: matterLineFor(conversation.matterId),
      downloadedAt: new Date(),
    });
    const where = await saveToTarget(document, transcriptFileName(conversation), "text/markdown");
    downloading = false;
    toast.success(
      where === "folder" ? "Transcript saved to your downloads folder." : "Transcript downloaded.",
    );
  }

  function switchTo(value: string): void {
    if (value === UNSTARTED) startNew();
    else select(value);
  }

  /*
   * Editing puts the message back in the composer and says so there. The draft the member had is
   * set aside for the edit, because the composer holds one message at a time; cancelling clears it.
   */
  function startEditing(turn: MagnusTurn): void {
    if (turn.content === null) return;
    editingTurn = turn;
    draft = turn.content;
    composerElement?.focus();
  }

  function cancelEditing(): void {
    editingTurn = null;
    draft = "";
  }

  /*
   * Finding words in the open conversation. The bar steps between the messages that hold them, and
   * opening it reads every earlier page first, so a find is never silently a find over the part
   * that happens to be on screen.
   */
  let findOpen = $state(false);
  let findText = $state("");
  let findIndex = $state(0);
  let findReading = $state(false);
  let findBar = $state<ReturnType<typeof ConversationFindBar> | null>(null);
  const findWords = $derived(findOpen ? findQuery(findText) : "");
  const findMatches = $derived(matchingTurnIds(shownTurns(session.turns ?? []), findWords));
  const findCurrent = $derived(Math.min(findIndex, Math.max(findMatches.length - 1, 0)));
  const currentMatchId = $derived(findMatches[findCurrent] ?? null);
  /** The longest run of earlier pages a find reads before it settles for what it has. */
  const FIND_EARLIER_PAGES = 40;

  async function openFind(): Promise<void> {
    findOpen = true;
    await tick();
    findBar?.focus();
    if (findReading) return;
    findReading = true;
    for (let page = 0; page < FIND_EARLIER_PAGES && session.earlierCursor !== null; page++) {
      await session.loadEarlier();
      if (session.failure !== null) break;
    }
    findReading = false;
  }

  function closeFind(): void {
    findOpen = false;
    findText = "";
    findIndex = 0;
  }

  function setFindText(next: string): void {
    findText = next;
    findIndex = 0;
  }

  /* Another conversation is another record: a find never carries over to it. */
  let findConversation: string | null = null;
  $effect(() => {
    const open = selectedId;
    if (open === findConversation) return;
    findConversation = open;
    closeFind();
  });

  /* Opening another conversation, or a read that no longer holds the message, ends the edit. */
  $effect(() => {
    const editing = editingTurn;
    if (editing !== null && !(session.turns ?? []).some((turn) => turn.id === editing.id)) {
      editingTurn = null;
    }
  });

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
    const sent =
      editingTurn === null
        ? await session.send(message, modelChoice)
        : await session.edit(editingTurn.id, message, modelChoice);
    if (!sent) return;
    draft = "";
    editingTurn = null;
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

  /*
   * Pinning and moving between folders are the reader's own arrangement. The sections are read
   * again rather than patched, because a moved conversation leaves one section's order and joins
   * another's, and only the server knows where it lands in each.
   */
  async function shelveSelected(next: { folderId: string | null; pinned: boolean }): Promise<void> {
    const conversation = selected;
    if (conversation === null) return;
    const outcome = await shelf.shelve(conversation.id, next);
    if (outcome.kind !== "ok") {
      toast.error(
        outcome.kind === "problem"
          ? "The conversation was not moved or pinned, and is where it was."
          : "Nothing answered, so the conversation is where it was.",
      );
      return;
    }
    session.reload();
    void loadConversations();
  }

  function conversationDeleted(): void {
    deletingConversation = null;
    selectedId = null;
    // The address no longer names a conversation that exists, or arriving would reopen it.
    mirrorAddress(null);
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
      folderId: null,
      pinnedAt: null,
    },
    {
      id: "fixture-conversation-1",
      title: null,
      createdBy: "fixture",
      matterId: null,
      state: "active",
      createdAt: sampleInstant(1),
      updatedAt: sampleInstant(1),
      folderId: null,
      pinnedAt: null,
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
    models={availability?.models ?? []}
    bind:choice={modelChoice}
    editing={editingTurn !== null}
    onCancelEdit={cancelEditing}
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
  <!-- The conversation's name, edited where it is read, and its one menu of acts beside it
       (conversation-menu.svelte): the owner's ruling put every act on the conversation behind one
       `…` rather than a row of icons. -->
  <div class="flex flex-wrap items-start justify-between gap-8 px-24 pt-8">
    <!-- The name over the matter it is kept on, set small: the matter is where the conversation
         lives, and a reader on the workspace (which spans every matter) needs it without it
         competing with the name. Inside a matter's own section the masthead already says it. -->
    <div class="flex min-w-0 flex-col gap-4">
      <ConversationName
        bind:this={conversationName}
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
    <ConversationMenu
      conversationId={selected?.id ?? null}
      disabled={session.sending}
      {downloading}
      shelf={shelved && shelf.folders !== null && selected !== null
        ? {
            folders: shelf.folders,
            folderId: selected.folderId,
            pinned: selected.pinnedAt !== null,
          }
        : null}
      onShelve={(next) => void shelveSelected(next)}
      onRename={() => conversationName?.rename()}
      onFind={() => void openFind()}
      onMove={() => (movingConversation = selected)}
      onDownload={() => void downloadTranscript()}
      onDelete={() => (deletingConversation = selected)}
    />
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
      {#if findOpen}
        <ConversationFindBar
          bind:this={findBar}
          bind:value={() => findText, setFindText}
          matchCount={findMatches.length}
          current={findCurrent}
          reading={findReading}
          onStep={(step) => (findIndex = steppedMatch(findCurrent, findMatches.length, step))}
          onClose={closeFind}
        />
      {/if}
      <MagnusTranscript
        {session}
        onEdit={startEditing}
        onRemove={(turn) => (removingTurn = turn)}
        find={findWords}
        {currentMatchId}
      />
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

{#snippet railRows(shown: readonly MagnusConversation[], withShelf: boolean)}
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
      : withShelf
        ? "No conversations in General."
        : "Nothing asked yet."}
    shelf={withShelf ? shelf : undefined}
    onSelect={select}
    onSortChange={reorder}
    onLoadMore={loadMoreConversations}
    onFolderRemoved={() => void loadConversations()}
  />
{/snippet}

{#snippet railFixture()}
  {@render railRows(FIXTURE_ROWS, false)}
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
          {@render railRows(rows ?? [], shelved)}
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

<TurnRemoveDialog
  bind:open={
    () => removingTurn !== null,
    (open: boolean) => {
      if (!open) removingTurn = null;
    }
  }
  {session}
  turn={removingTurn}
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
