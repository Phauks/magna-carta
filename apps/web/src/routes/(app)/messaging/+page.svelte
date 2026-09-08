<script lang="ts">
  /*
   * Messaging — the firm's calls and texts.
   *
   * WHY THIS IS A TOP-LEVEL SCREEN AND NOT ONLY A MATTER TAB. Two reasons, and the first is the one
   * that made the screen necessary. An inbound text from a number nobody recognises belongs to NO
   * MATTER until a person decides which — that is the queue below, and it is unreachable from inside
   * any matter by construction, because the matter is exactly what it does not have. The second is
   * that "did anyone call this client back" is a question about the person and the week, not about
   * one file, and a log somebody has to open each matter to read is a log nobody reads.
   *
   * NOT EVERY CALL BECOMES A MATTER, AND THAT IS THE THIRD TAB. Spam, a wrong number, the landlord,
   * a prospect who never came back: none of them can be filed, because there is no matter to file
   * them onto. Before they could be SET ASIDE with a reason they sat in the queue forever, and a
   * queue nobody can empty is a queue nobody works. Setting one aside deletes nothing — what was
   * said still happened, and a firm that decides a written-off call was real work after all puts it
   * back.
   *
   * THE QUEUE IS GATED SEPARATELY FROM THE LOG, and that is not caution for its own sake. Every
   * filed row is narrowed server-side to matters this member may see, so a walled matter contributes
   * nothing here. An unfiled row has no matter for that narrowing to bite on. What sits in the queue
   * is whatever was said to the firm's number before anybody decided where it belonged, so reading
   * it takes its own capability — the way a firm decides who opens the post.
   *
   * A ROW OPENS INTO ITS OWN RECORD. It used to navigate to the row's matter instead, on the
   * reasoning that every field was already on the row and a window would be a second way to read
   * what was on screen. That is true of READING and false of everything else: a hand-logged call is
   * somebody's recollection typed at speed, and a record nobody can open is a record nobody can
   * correct. Getting to the matter is still one press, from inside the record.
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
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Button from "@magna-carta/design-system/button";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
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
  import CommunicationLog from "$lib/communications/communication-log.svelte";
  import CommunicationRecordWindow from "$lib/communications/communication-record-window.svelte";
  import LogCommunicationDialog from "$lib/communications/log-communication-dialog.svelte";
  import {
    fileCommunicationToMatter,
    newWriteKey,
    readUnroutedCount,
    LOG_COMMUNICATIONS_PERMISSION,
    REVIEW_UNROUTED_PERMISSION,
    type Communication,
    type CommunicationScope,
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
    // A count that cannot be read leaves the screen readable: the tab loses its number, not its
    // rows, and the rows are what the reader came for.
    unroutedCount = outcome.kind === "ok" ? outcome.value.count : null;
  }

  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayLog) return permissionRefusal("Recording a call or a text", LOG_COMMUNICATIONS_PERMISSION);
    return undefined;
  });

  // ---- the log ---------------------------------------------------------------------------------

  let scope = $state<CommunicationScope>("all");
  let searchText = $state("");
  let appliedSearch = $state("");
  let grid = $state<DataTable.DataTableGridState<Communication> | null>(null);
  let rereadLog = $state<() => void>(() => {});

  let logDialogOpen = $state(false);
  let recordOpen = $state(false);
  let openedId = $state<string | null>(null);

  const query = $derived({
    ...(scope === "all" ? {} : { scope }),
    ...(appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() }),
  });

  const narrowed = $derived(
    scope !== "all" || appliedSearch.trim() !== "" || (grid?.activeFilterCount ?? 0) > 0,
  );
  const narrowingSummary = $derived.by(() => {
    const parts: string[] = [];
    if (scope === "routed") parts.push("what is filed");
    if (scope === "unrouted") parts.push("the queue");
    if (scope === "setAside") parts.push("what was set aside");
    if (appliedSearch.trim() !== "") parts.push(`"${appliedSearch.trim()}"`);
    return parts.length === 0 ? "Show everything" : `Showing ${parts.join(", ")} of the log`;
  });

  function clearNarrowing(): void {
    scope = "all";
    searchText = "";
    appliedSearch = "";
    grid?.clearAllFilters();
  }

  /** Activating a row opens the record. Every act a row offers is inside it. */
  function openRow(row: Communication): void {
    openedId = row.id;
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

  async function startIntake(communication: Communication): Promise<void> {
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
    recordOpen = false;
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
        placeholder={placeholderOf("Search the log")}
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <CreateControl
        noun="Call"
        title="Record a call or a text that happened."
        refusal={createRefusal}
        onpress={() => (logDialogOpen = true)}
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

  {#if mayReviewQueue}
    <!-- The queue is a scope of one log, not a second screen. Two mechanisms narrowing one list is
         how somebody ends up staring at an almost-empty table with a filter set on a control they
         are not looking at, so the tabs and the column filters answer different questions: the tab
         asks the server, the column filters run over what is loaded. -->
    <Tabs.Root value={scope} onValueChange={(next) => (scope = next as CommunicationScope)}>
      <Tabs.List>
        <Tabs.Trigger value="all">Everything</Tabs.Trigger>
        <Tabs.Trigger value="unrouted">
          Waiting to be filed{unroutedCount === null ? "" : ` (${String(unroutedCount)})`}
        </Tabs.Trigger>
        <Tabs.Trigger value="routed">On a matter</Tabs.Trigger>
        <Tabs.Trigger value="setAside">Not a matter</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
  {/if}

  {#if anchors.failure !== null}
    <Alert.Root variant="warning">
      <Alert.Title>The Firm's Matters Could Not Be Read</Alert.Title>
      <Alert.Description>{anchors.failure}</Alert.Description>
    </Alert.Root>
  {/if}

  <CommunicationLog
    {query}
    bind:grid
    bind:reread={rereadLog}
    onOpen={openRow}
    caption="The firm's calls and texts"
    emptyTitle={scope === "unrouted"
      ? "Nothing Is Waiting"
      : scope === "setAside"
        ? "Nothing Has Been Set Aside"
        : "No Calls Or Texts Yet"}
  >
    {#snippet emptyBody()}
      {#if scope === "unrouted"}
        Every call and text the firm has recorded is either on a matter or set aside as something
        that belongs to none. A message that arrives from a number nobody recognises lands here
        until somebody says which case it belongs to.
      {:else if scope === "setAside"}
        Not every call a firm takes is about a case — spam, a wrong number, the landlord, an enquiry
        that never came to anything. Setting one aside from its own record takes it out of the queue
        without pretending it was a matter, and nothing is destroyed by it.
      {:else}
        A record of a call or a text is what the firm said, to whom, and when — the part of a case's
        history that otherwise lives only in somebody's memory of the phone call. Recording the
        first one, with New Call at the top of the screen, starts the log.
      {/if}
    {/snippet}
    {#snippet emptyActions()}
      {#if scope !== "unrouted" && scope !== "setAside" && createRefusal === undefined}
        <Button onclick={() => (logDialogOpen = true)}>Record A Call</Button>
      {/if}
    {/snippet}
  </CommunicationLog>
</div>

<LogCommunicationDialog
  bind:open={logDialogOpen}
  matters={anchors.matters ?? []}
  mattersCapped={anchors.capped}
  onLogged={onFiled}
/>

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
