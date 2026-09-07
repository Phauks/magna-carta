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
   * THE QUEUE IS GATED SEPARATELY FROM THE LOG, and that is not caution for its own sake. Every
   * filed row is narrowed server-side to matters this member may see, so a walled matter contributes
   * nothing here. An unfiled row has no matter for that narrowing to bite on. What sits in the queue
   * is whatever was said to the firm's number before anybody decided where it belonged, so reading
   * it takes its own capability — the way a firm decides who opens the post.
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
  import { goto } from "$app/navigation";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Button from "@magna-carta/design-system/button";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { AnchorMatters } from "$lib/communications/anchor-matters.svelte.ts";
  import CommunicationLog from "$lib/communications/communication-log.svelte";
  import FileToMatterDialog from "$lib/communications/file-to-matter-dialog.svelte";
  import LogCommunicationDialog from "$lib/communications/log-communication-dialog.svelte";
  import {
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
    if (!mayLog) return permissionRefusal("Logging a call or a text", LOG_COMMUNICATIONS_PERMISSION);
    return undefined;
  });

  // ---- the log ---------------------------------------------------------------------------------

  let scope = $state<CommunicationScope>("all");
  let searchText = $state("");
  let appliedSearch = $state("");
  let grid = $state<DataTable.DataTableGridState<Communication> | null>(null);
  let rereadLog = $state<() => void>(() => {});

  let logDialogOpen = $state(false);
  let fileDialogOpen = $state(false);
  let filingId = $state<string | null>(null);

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
    if (appliedSearch.trim() !== "") parts.push(`"${appliedSearch.trim()}"`);
    return parts.length === 0 ? "Show everything" : `Showing ${parts.join(", ")} of the log`;
  });

  function clearNarrowing(): void {
    scope = "all";
    searchText = "";
    appliedSearch = "";
    grid?.clearAllFilters();
  }

  /*
   * What activating a row does, and it depends on what the row IS.
   *
   * A record window over one call is the natural next thing here and it is deliberately not in this
   * first cut: every field a window would show is already on the row, so it would be a second way to
   * read what is on screen. So a row does the thing a reader is actually reaching for.
   *
   * An UNFILED row opens the filing dialog, which is the one act only this screen offers — and only
   * for a member who may work the queue, which is the same member who can see the row at all.
   *
   * A FILED row opens its matter's own Messaging section, where the rest of that case's
   * conversation is. Opening the filing dialog on it would present an act the server refuses, and
   * doing nothing at all would leave a row that looks clickable and is not.
   */
  function openRow(row: Communication): void {
    if (row.matterId !== null) {
      void goto(`/matters/${row.matterId}/messaging`);
      return;
    }
    if (!mayReviewQueue) return;
    filingId = row.id;
    fileDialogOpen = true;
  }

  function onFiled(): void {
    rereadLog();
    void refreshQueueCount();
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
    emptyTitle={scope === "unrouted" ? "Nothing Is Waiting" : "No Calls Or Texts Yet"}
  >
    {#snippet emptyBody()}
      {#if scope === "unrouted"}
        Every call and text the firm has recorded is on a matter. A message that arrives from a
        number nobody recognises lands here until somebody says which case it belongs to.
      {:else}
        A record of a call or a text is what the firm said, to whom, and when — the part of a case's
        history that otherwise lives only in somebody's memory of the phone call. Recording the
        first one, with New Call at the top of the screen, starts the log.
      {/if}
    {/snippet}
    {#snippet emptyActions()}
      {#if scope !== "unrouted" && createRefusal === undefined}
        <Button onclick={() => (logDialogOpen = true)}>Log A Call</Button>
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

<FileToMatterDialog
  bind:open={fileDialogOpen}
  communicationId={filingId}
  matters={anchors.matters ?? []}
  mattersCapped={anchors.capped}
  {onFiled}
/>
