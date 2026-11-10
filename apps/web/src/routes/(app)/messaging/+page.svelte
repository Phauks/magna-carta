<script lang="ts">
  /*
   * Messaging — the firm's calls and texts.
   *
   * WHY THIS IS A TOP-LEVEL SCREEN AND NOT ONLY A MATTER TAB. Two reasons, and the first is the one
   * that made the screen necessary. An inbound text from a number nobody recognises belongs to NO
   * MATTER until a person decides which — that is the queue, and it is unreachable from inside any
   * matter by construction, because the matter is exactly what it does not have. The second is
   * that "did anyone call this client back" is a question about the person and the week, not about
   * one file, and a log somebody has to open each matter to read is a log nobody reads.
   *
   * NOT EVERY CALL BECOMES A MATTER. Spam, a wrong number, the landlord, a prospect who never came
   * back: none of them can be filed, because there is no matter to file them onto. Before they
   * could be SET ASIDE with a reason they sat in the queue forever, and a queue nobody can empty is
   * a queue nobody works. Setting one aside deletes nothing — what was said still happened, and a
   * firm that decides a written-off call was real work after all puts it back.
   *
   * THE TABLE IS THE ONLY THING THAT NARROWS IT (the owner's ruling of 2026-09-11, recorded in
   * docs/conventions/design-corrections.md). The screen used to carry four scope tabs above the log
   * — everything, the queue, what is filed, what was set aside — and no other list screen narrows
   * itself with a tab strip; what the tabs asked is what the Matter column's own filter asks. The
   * distinction the tabs were defending was real: the tab asked the server, the column filter ran
   * over the loaded page, and a filter that narrows only the loaded page lies on a paged register.
   * So the column filter is the control AND it reaches the server — a selection of "Not filed" is
   * the queue, a selection of the set-aside reasons is what was set aside, and a selection of
   * matters is what is filed, each sent as the listing's own scope and re-read.
   *
   * THE QUEUE'S COUNT IS NOT A TAB, AND LOSING THE TABS MUST NOT LOSE IT. "Waiting to be filed" is
   * work the firm owes, so it stands in the counts strip with the log's other figures, whatever the
   * table is narrowed to.
   *
   * THE QUEUE IS GATED SEPARATELY FROM THE LOG, and that is not caution for its own sake. Every
   * filed row is narrowed server-side to matters this member may see, so a walled matter contributes
   * nothing here. An unfiled row has no matter for that narrowing to bite on. What sits in the queue
   * is whatever was said to the firm's number before anybody decided where it belonged, so reading
   * it takes its own capability — the way a firm decides who opens the post.
   *
   * A ROW OPENS INTO ITS OWN RECORD, AND SO DOES NEW (owner ruling, 2026-09-08: "double clicking to
   * open a log should open the same creation modal ... we now have two modals for creating a call
   * which is weird"). One window records a call, reads one and corrects one; the only difference
   * between the states is whether it opened with a record in it. This screen therefore holds one
   * piece of state for it — which record, or none — rather than two windows and two open flags.
   *
   * EMAIL IS DELIBERATELY NOT HERE. Mail already lives in the firm's own mailbox and is FILED onto a
   * matter from there, so its verb is route-what-exists; a call leaves no trace at all unless the
   * platform makes one, so the verb here is cause-a-record-to-exist. One screen for both would have
   * to be two screens wearing a shared header.
   *
   * NOTHING IS SENT FROM THIS SCREEN. The log is the durable thing and the carrier is a producer of
   * rows into it; until the messaging port lands, the only producer is a person recording what
   * happened. The screen says so where a reader would otherwise look for a compose button.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import {
    listLocations,
    listMatterTypes,
    readSession,
    type LocationSummary,
    type MatterTypeSummary,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";
  import NewMatterDialog from "$lib/matters/new-matter-dialog.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readDirectoryEntity } from "$lib/directory/directory-api.ts";
  import { directoryEntityName } from "$lib/directory/entity-presentation.ts";
  import { AnchorMatters } from "$lib/communications/anchor-matters.svelte.ts";
  import { scopeForMatterSelection } from "$lib/communications/communication-columns.ts";
  import CommunicationLog from "$lib/communications/communication-log.svelte";
  import CommunicationRecordWindow from "$lib/communications/communication-record-window.svelte";
  import {
    fileCommunicationToMatter,
    newWriteKey,
    readUnroutedCount,
    LOG_COMMUNICATIONS_PERMISSION,
    REVIEW_UNROUTED_PERMISSION,
    type Communication,
    type IntakeSource,
  } from "$lib/communications/communications-api.ts";

  // ---- who is asking, and what they may do ------------------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  const anchors = new AnchorMatters();
  let unroutedCount = $state<number | null>(null);
  let bootstrapped = false;

  const mayLog = $derived(session?.permissions.includes(LOG_COMMUNICATIONS_PERMISSION) ?? false);
  const mayReviewQueue = $derived(
    session?.permissions.includes(REVIEW_UNROUTED_PERMISSION) ?? false,
  );

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
      await anchors.load(fetch);
      await refreshQueueCount();
    })();
  });

  async function refreshQueueCount(): Promise<void> {
    if (!(session?.permissions.includes(REVIEW_UNROUTED_PERMISSION) ?? false)) return;
    const outcome = await readUnroutedCount(fetch);
    // A count that cannot be read leaves the screen readable: the strip loses its number, not its
    // rows, and the rows are what the reader came for.
    unroutedCount = outcome.kind === "ok" ? outcome.value.count : null;
  }

  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayLog) return permissionRefusal("Recording a call or a text", LOG_COMMUNICATIONS_PERMISSION);
    return undefined;
  });

  // ---- the log ---------------------------------------------------------------------------------

  let searchText = $state("");
  let appliedSearch = $state("");
  let grid = $state<DataTable.DataTableGridState<Communication> | null>(null);
  let rereadLog = $state<() => void>(() => {});

  let recordOpen = $state(false);
  /** Which record the window is on, or null while it is recording a new one. */
  let openedId = $state<string | null>(null);

  /*
   * The Matter column's filter, as the listing's scope. A selection the listing cannot take as one
   * scope — the queue and one matter together, say — is sent as nothing, and the table narrows the
   * loaded rows on its own.
   */
  const scope = $derived(scopeForMatterSelection(grid?.filterFor("matter")));

  const query = $derived({
    ...(scope === undefined ? {} : { scope }),
    ...(appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() }),
  });

  const narrowed = $derived(appliedSearch.trim() !== "" || (grid?.activeFilterCount ?? 0) > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show everything"
      : `Showing "${appliedSearch.trim()}" of the log`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid?.clearAllFilters();
  }

  /*
   * The work owed, as a figure in the counts strip. It is the whole log's count, read from the
   * server, so it never moves as the table is narrowed; the caption says so, and says how to reach
   * the rows themselves.
   */
  const figures = $derived(
    unroutedCount === null
      ? []
      : [
          {
            identifier: "waiting",
            label: "waiting to be filed",
            value: String(unroutedCount),
            caption:
              "Calls and texts on no matter that nobody has decided about yet, across the whole log. Filter the Matter column to Not filed to see them.",
          },
        ],
  );

  /** Activating a row opens the record. Every act a row offers is inside it. */
  function openRow(row: Communication): void {
    openedId = row.id;
    recordOpen = true;
  }

  /** Recording a new one is the same window with no record in it yet. */
  function openNew(): void {
    openedId = null;
    recordOpen = true;
  }

  function onFiled(): void {
    rereadLog();
    void refreshQueueCount();
  }

  // ---- starting an intake from a call ----------------------------------------------------------

  /*
   * A call from somebody who wants the firm to act is where an intake starts, and it is the one act
   * this screen offers that is not about the log itself. The window is the matters subsystem's own —
   * a screen that learned how to open a matter would be the second place in the product that knows
   * what opening one requires — seeded with the caller so nobody has to find them twice.
   *
   * WHEN THE MATTER OPENS, THE CALL IS FILED ONTO IT. That is the whole point: the record of the
   * first contact belongs on the file it started, and leaving the two unconnected would mean the
   * receptionist's account of the call is the one thing the new matter does not have.
   */
  let intakeOpen = $state(false);
  let intakePrefill = $state<{ client?: PickableEntity | null; title?: string } | null>(null);
  let intakeSourceId = $state<string | null>(null);
  let intakeProblem = $state<string | null>(null);
  let matterTypes = $state<readonly MatterTypeSummary[]>([]);
  let locations = $state<readonly LocationSummary[]>([]);
  let referenceRead = false;

  async function readIntakeReferences(): Promise<void> {
    if (referenceRead) return;
    referenceRead = true;
    const [types, places] = await Promise.all([listMatterTypes(fetch), listLocations(fetch)]);
    if (types.kind === "ok") matterTypes = types.value.data;
    if (places.kind === "ok") locations = places.value.data;
  }

  async function startIntake(communication: IntakeSource): Promise<void> {
    intakeProblem = null;
    intakeSourceId = communication.id;
    await readIntakeReferences();
    // The caller as the window's client, where the record names one. A record that names only a
    // number offers no client to seed, and the window asks for one as it always does.
    let client: PickableEntity | null = null;
    if (communication.counterpartyEntityId !== null) {
      const outcome = await readDirectoryEntity(fetch, communication.counterpartyEntityId);
      if (outcome.kind === "ok") {
        client = {
          identifier: communication.counterpartyEntityId,
          name: directoryEntityName(outcome.value),
          kind: outcome.value.kind === "organization" ? "organization" : "person",
        };
      }
    }
    intakePrefill = { client };
    // The record window decides whether it closes: a row already on the log closes it, and a call
    // just saved closes it only when no other call is still being written down beside it, so an
    // intake never throws away somebody else's half-recorded call.
    intakeOpen = true;
  }

  async function intakeOpened(created: { matterId: string }): Promise<void> {
    const sourceId = intakeSourceId;
    intakeSourceId = null;
    onFiled();
    if (sourceId === null) return;
    const filed = await fileCommunicationToMatter(fetch, sourceId, created.matterId, newWriteKey());
    // The intake EXISTS either way. Saying the call was not filed onto it beats a silent gap, and
    // filing it by hand from the queue is one press.
    intakeProblem =
      filed.kind === "ok"
        ? null
        : "The intake was started, but the call could not be filed onto it. It is still in the queue.";
    onFiled();
  }
</script>

<svelte:head><title>Messaging · Magna Carta</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Messaging">
    {#snippet actions()}
      <!-- The search, then the create control: the search grows toward the inline start, so the
           control at the row's end never moves when it opens. The same pair, in the same order, as
           every other list screen. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the log"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <!-- "Message", not "Call": the screen is the messaging log, and a call is one kind of message
           it holds, not the thing the control creates (owner ruling, 2026-09-14). -->
      <CreateControl
        noun="Message"
        title="Record a call or a text that happened."
        refusal={createRefusal}
        onpress={openNew}
      />

      <DataTable.ClearFilters
        grid={grid ?? undefined}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />
    {/snippet}
  </ScreenHeader>

  <!-- Said once, at the top, rather than as a disabled compose button somebody has to hover to
       understand. What the screen cannot do yet is a fact about the platform, not about them. -->
  <Alert.Root variant="info">
    <Alert.Title>The Firm Has No Phone Line Yet</Alert.Title>
    <Alert.Description>
      Nothing is sent or received from here. This is the firm's own record of calls and texts that
      happened, written down by whoever made or took them. When the firm's number is connected, the
      carrier will write these same rows by itself.
    </Alert.Description>
  </Alert.Root>

  {#if intakeProblem !== null}
    <Alert.Root variant="warning">
      <Alert.Title>The Intake Started</Alert.Title>
      <Alert.Description>{intakeProblem}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if anchors.failure !== null}
    <Alert.Root variant="warning">
      <Alert.Title>The Firm's Matters Could Not Be Read</Alert.Title>
      <Alert.Description>{anchors.failure}</Alert.Description>
    </Alert.Root>
  {/if}

  <CommunicationLog
    {query}
    {figures}
    bind:grid
    bind:reread={rereadLog}
    onOpen={openRow}
    caption="The firm's calls and texts"
    emptyTitle="No Calls Or Texts Yet"
  >
    {#snippet emptyBody()}
      A record of a call or a text is what the firm said, to whom, and when — the part of a case's
      history that otherwise lives only in somebody's memory of the phone call. Recording the first
      one, with New Message at the top of the screen, starts the log.
    {/snippet}
    {#snippet emptyActions()}
      {#if createRefusal === undefined}
        <Button onclick={openNew}>Record A Message</Button>
      {/if}
    {/snippet}
  </CommunicationLog>
</div>

<CommunicationRecordWindow
  bind:open={recordOpen}
  communicationId={openedId}
  matters={anchors.matters ?? []}
  mattersCapped={anchors.capped}
  canWrite={mayLog}
  canReviewQueue={mayReviewQueue}
  onChanged={onFiled}
  onStartIntake={(communication) => void startIntake(communication)}
/>

{#if session !== null}
  <NewMatterDialog
    bind:open={intakeOpen}
    purpose="intake"
    prefill={intakePrefill}
    {session}
    {matterTypes}
    {locations}
    matters={[]}
    onCreated={(created) => void intakeOpened(created)}
  />
{/if}
