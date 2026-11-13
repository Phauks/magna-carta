<script lang="ts">
  /*
   * INTAKE — the firm's desk: every intake in flight, and the way to start, resume and finish one.
   *
   * WHAT THE DESK IS. A receptionist takes a call from somebody who wants the firm to act. They
   * start an intake here: the caller is chosen from the directory or recorded into it from the same
   * field, the matter is named, and a matter is recorded in the INTAKE status — no number of any
   * kind yet. What the firm requires before it consults is the intake procedure bound to that kind
   * of matter, and the matter's Intake section is where each step is answered, by the subsystem
   * that owns the fact or by a member's record. Several intakes run at once and each is resumed
   * from this list. When every required step is answered, Complete Intake makes the matter a
   * CONSULTATION and draws its consultation number; Schedule then puts the consultation on the
   * calendar; and the consultation opens from its own status window. The desk is therefore a
   * READING of the firm's matters on the two rungs before opening, never a register of its own.
   *
   * IT IS ONE TABLE, AND THE TABLE IS WHAT NARROWS IT. The search is the read's own server-side
   * search over title, number and client; everything else is a column with its own filter. No tab
   * strip, no status control, no second place to narrow (docs/conventions/design-corrections.md,
   * the matters docket round).
   *
   * THE ROW STATES COUNTS, NEVER A VERDICT. "3 of 5 answered, 1 required outstanding" is a fact
   * about the firm's own procedure. The conflicts step's standing is a sentence on the matter's
   * Intake section, in the conflicts record's own words, and this screen does not summarise it.
   */
  import { goto } from "$app/navigation";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import NewMatterDialog from "$lib/matters/new-matter-dialog.svelte";
  import RecordEventDialog from "$lib/calendar/record-event-dialog.svelte";
  import { entityParticipant, memberParticipant } from "$lib/calendar/event-draft.ts";
  import { listEventTypes, readerTimeZone, type EventType } from "$lib/calendar/calendar-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    graduateMatter,
    listEveryMatter,
    listLocations,
    listMatterTypes,
    readSession,
    type LocationSummary,
    type MatterSummary,
    type MatterTypeSummary,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";
  import {
    completeRefusal,
    consultationText,
    consultationTitle,
    intakeDeskColumns,
    intakeResumeHref,
    intakeStandingText,
    listIntakeDesk,
    scheduleRefusal,
    INTAKE_DESK_INITIAL_SORT,
    deskNumberOf,
    UNNUMBERED_INTAKE,
    type IntakeDeskRow,
  } from "$lib/intake/intake-desk.ts";

  const CREATE_MATTER_PERMISSION = "matters:create";

  // ---- who is asking, and the firm's vocabularies ----------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let matterTypes = $state<readonly MatterTypeSummary[]>([]);
  let locations = $state<readonly LocationSummary[]>([]);
  let eventTypes = $state<readonly EventType[]>([]);
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void firmRoster.load(fetch);
    void (async () => {
      const [sessionRead, typesRead, locationsRead, eventTypesRead] = await Promise.all([
        readSession(fetch),
        listMatterTypes(fetch),
        listLocations(fetch),
        listEventTypes(fetch),
      ]);
      if (sessionRead.kind === "ok") session = sessionRead.value;
      if (typesRead.kind === "ok") matterTypes = typesRead.value.data;
      if (locationsRead.kind === "ok") locations = locationsRead.value.data;
      if (eventTypesRead.kind === "ok") eventTypes = eventTypesRead.value.data;
    })();
    reread();
  });

  /** Null until the session lands, so a row's controls say so rather than claiming a refusal. */
  const permissions = $derived(session?.permissions ?? null);
  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    return session.permissions.includes(CREATE_MATTER_PERMISSION)
      ? undefined
      : permissionRefusal("Starting an intake", CREATE_MATTER_PERMISSION);
  });

  const vocabulary = $derived({
    matterTypeNames: matterTypes.filter((type) => type.active).map((type) => type.name),
    memberNames: (firmRoster.members ?? []).map((member) => member.displayName),
  });

  // ---- the desk --------------------------------------------------------------------------------

  const list = new PagedList<IntakeDeskRow>("The intake desk could not be read.");
  let searchText = $state("");
  let appliedSearch = $state("");

  function read(cursor?: string) {
    return listIntakeDesk(fetch, { search: appliedSearch, cursor });
  }

  function reread(): void {
    list.reset(`desk:${appliedSearch.trim()}`);
    void list.load(read);
  }

  // A changed search is a different question and a fresh read; the first read is the effect's.
  let lastSearch = "";
  $effect(() => {
    const next = appliedSearch.trim();
    if (next === lastSearch) return;
    lastSearch = next;
    reread();
  });

  const rows = $derived(list.items);

  const grid = DataTable.createDataTableGrid<IntakeDeskRow>({
    columns: () => intakeDeskColumns(vocabulary),
    rows: () => rows ?? [],
    rowKey: (row) => row.matterId,
    initialSort: INTAKE_DESK_INITIAL_SORT,
    itemNoun: { singular: "intake", plural: "intakes" },
    // Activating a row resumes the intake where it is answered: the matter's own Intake section.
    onActivate: (row) => void goto(intakeResumeHref(row)),
  });

  const narrowed = $derived(appliedSearch.trim() !== "" || grid.activeFilterCount > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show every intake"
      : `Showing "${appliedSearch.trim()}" of the desk`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid.clearAllFilters();
  }

  // ---- starting one ----------------------------------------------------------------------------

  let dialogOpen = $state(false);
  let lastStarted = $state<{ matterId: string; consultationNumber: string | null } | null>(null);
  /**
   * The docket, read when the window first opens: it is where the window learns whether the
   * caller already has a file with the firm ("This Client's Matters"), which is the fact a
   * receptionist most wants at that moment. Read once; a stale docket is a worse answer than a
   * re-read, so a later open reads it again only when the first read failed.
   */
  let docket = $state<readonly MatterSummary[] | null>(null);

  async function startIntake(): Promise<void> {
    if (docket === null) {
      const outcome = await listEveryMatter(fetch);
      if (outcome.kind === "ok") docket = outcome.value.data;
    }
    dialogOpen = true;
  }

  function onStarted(created: { matterId: string; consultationNumber: string | null }): void {
    lastStarted = created;
    reread();
  }

  // ---- completing an intake -----------------------------------------------------------------

  /** The row whose graduation is in flight, so a double press cannot draw two numbers. */
  let completing = $state<string | null>(null);
  let completed = $state<{ matterId: string; consultationNumber: string } | null>(null);
  let completeFailure = $state<StatedFailure | null>(null);

  async function complete(row: IntakeDeskRow): Promise<void> {
    if (completing !== null) return;
    completing = row.matterId;
    completeFailure = null;
    // One key per attempt: a repeat answers with the number the first press drew.
    const outcome = await graduateMatter(fetch, row.matterId, crypto.randomUUID());
    completing = null;
    if (outcome.kind === "ok") {
      completed = outcome.value;
      lastStarted = null;
      reread();
      return;
    }
    // A refusal names each outstanding step in its own words; the desk repeats them.
    completeFailure = stated(
      outcome.failure,
      "The intake could not be completed.",
      "Couldn't connect. The intake is unchanged.",
    );
  }

  // ---- scheduling the consultation ------------------------------------------------------------

  let scheduling = $state<IntakeDeskRow | null>(null);
  let scheduleOpen = $state(false);

  const readerZone = readerTimeZone();
  const preferredTimeZones = readerZone === "" ? [] : [readerZone];

  /** The people the desk already knows are attending: the client, and the responsible attorney. */
  const scheduleParticipants = $derived.by(() => {
    const row = scheduling;
    if (row === null) return [];
    const responsible = (firmRoster.members ?? []).find(
      (member) => member.userId === row.responsibleMemberId,
    );
    return [
      ...(row.clientEntityId === null || row.clientDisplayName === null
        ? []
        : [entityParticipant(row.clientEntityId, row.clientDisplayName)]),
      ...(responsible === undefined
        ? []
        : [memberParticipant(responsible.userId, responsible.displayName)]),
    ];
  });

  function schedule(row: IntakeDeskRow): void {
    scheduling = row;
    scheduleOpen = true;
  }
</script>

<svelte:head><title>Intake · Magna Carta</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Intake">
    {#snippet actions()}
      <!-- The search, then the create control: the same pair, in the same order, as the docket and
           the custody register. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the desk"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <CreateControl
        noun="Intake"
        title="Start an intake: record who is calling and what they need."
        refusal={createRefusal}
        onpress={() => void startIntake()}
      />
      {#if narrowed}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Show every intake: {narrowingSummary}"
          title={narrowingSummary}
          class="text-accent-default"
          onclick={clearNarrowing}
        >
          <FunnelX class="size-16" aria-hidden="true" />
        </Button>
      {/if}
    {/snippet}
  </ScreenHeader>

  {#if lastStarted !== null}
    <!-- It opens the intake, because the next thing anyone does with a new one is answer its
         steps. An intake carries no number yet; that is drawn when it completes. -->
    <Alert.Root variant="success">
      <Alert.Title>The Intake Is Started</Alert.Title>
      <Alert.Description>
        <a class="underline underline-offset-2" href={intakeResumeHref(lastStarted)}>
          Open the intake
        </a>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if completed !== null}
    <!-- The consultation number the firm's sequence drew, which is what a receptionist quotes
         back to the caller from here on. -->
    <Alert.Root variant="success">
      <Alert.Title>The Intake Is Complete</Alert.Title>
      <Alert.Description>
        <a
          class="underline underline-offset-2 tabular-nums"
          href="/matters/{encodeURIComponent(completed.matterId)}"
        >
          {completed.consultationNumber}
        </a>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if completeFailure !== null}
    <FailureNotice
      failure={completeFailure.failure}
      title="The Intake Was Not Completed"
      fallback={completeFailure.fallback}
      whenSilent={completeFailure.whenSilent}
    />
  {/if}

  {#if firmRoster.failure !== null}
    <Alert.Root variant="info">
      <Alert.Title>The Firm's Member List Could Not Be Read</Alert.Title>
      <Alert.Description>{firmRoster.failure}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col gap-16">
    {#if list.failure !== null}
      <FailureNotice
        failure={list.failure}
        title="The Desk Could Not Be Read"
        fallback={list.failureMessage ?? undefined}
        onRetry={reread}
      />
    {:else}
      <DataTable.Grid
        {grid}
        class="min-h-0 flex-1"
        caption="The firm's intakes in flight"
        cell={deskCell}
        loading={rows === null}
      >
      </DataTable.Grid>

      <DataTable.GridFooter {grid}>
        {#snippet end()}
          {#if list.nextCursor !== null}
            <Button
              variant="secondary"
              size="sm"
              onclick={() => void list.loadMore(read)}
              disabled={list.loadingMore}
            >
              {list.loadingMore ? "Loading" : "Load more intakes"}
            </Button>
          {/if}
        {/snippet}
      </DataTable.GridFooter>
    {/if}
  </div>
</div>

{#snippet deskCell({ row, column, text }: DataTable.GridCellContext<IntakeDeskRow>)}
  {#if column.id === "consultationNumber"}
    <!-- Tabular figures: a number is read down a column and quoted back over the phone. The
         unnumbered word reads muted, because it is the absence of one. -->
    {@const number = deskNumberOf(row)}
    {#if number === null}
      <span class="text-text-muted">{UNNUMBERED_INTAKE}</span>
    {:else}
      <a
        class="tabular-nums underline-offset-2 hover:underline"
        href={intakeResumeHref(row)}
        onclick={(event) => event.stopPropagation()}
      >
        {number}
      </a>
    {/if}
  {:else if column.id === "status"}
    {@const seal = matterStatusPresentation(row.status)}
    <Badge variant={seal.variant} title={seal.meaning}>{seal.label}</Badge>
  {:else if column.id === "standing"}
    {@const refusal = completeRefusal(row, permissions)}
    <span class="flex items-center gap-8">
      <span
        class={row.status === "consultation" ||
        (row.checklist.bound && row.checklist.outstandingRequired === 0)
          ? "text-text-default"
          : "text-text-muted"}
      >
        {intakeStandingText(row.checklist, row.status)}
      </span>
      {#if row.status === "intake"}
        <!-- The lifecycle step itself, on the row: present and refused with the reason until every
             required step is answered, because the desk's whole point is that the consultation
             follows a complete intake. -->
        <Button
          variant="ghost"
          size="sm"
          disabled={refusal !== undefined || completing !== null}
          title={refusal ?? `Complete the intake for ${row.title}`}
          aria-label="Complete the intake for {row.title}"
          onclick={(event) => {
            event.stopPropagation();
            void complete(row);
          }}
        >
          <ClipboardCheck class="size-16" aria-hidden="true" />
          {completing === row.matterId ? "Completing" : "Complete Intake"}
        </Button>
      {/if}
    </span>
  {:else if column.id === "consultation"}
    {@const refusal = scheduleRefusal(row, permissions)}
    <span class="flex items-center gap-8">
      <span class={row.nextConsultation === null ? "text-text-muted" : "tabular-nums"}>
        {consultationText(row.nextConsultation)}
      </span>
      <!-- Present and refused rather than absent, carrying the reason: on an intake it says the
           intake comes first, and once a consultation is scheduled it says where the act moved to.
           A control that vanished would say neither. -->
      <Button
        variant="ghost"
        size="sm"
        disabled={refusal !== undefined}
        title={refusal ?? `Schedule the consultation for ${row.title}`}
        aria-label="Schedule the consultation for {row.title}"
        onclick={(event) => {
          event.stopPropagation();
          schedule(row);
        }}
      >
        <CalendarPlus class="size-16" aria-hidden="true" />
        Schedule
      </Button>
    </span>
  {:else if column.id === "createdAt"}
    <span class="flex items-center gap-8">
      <span class="tabular-nums">{text}</span>
      {#if row.isStale}
        <Badge variant="warning" title="Sat past the firm's stale-consultation age">Stale</Badge>
      {/if}
    </span>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#if session !== null}
  <NewMatterDialog
    bind:open={dialogOpen}
    purpose="intake"
    {session}
    {matterTypes}
    {locations}
    matters={docket ?? []}
    onCreated={onStarted}
    onMatterTypeAdopted={(created) => (matterTypes = [...matterTypes, created])}
  />
{/if}

{#if scheduling !== null}
  {#key scheduling.matterId}
    <RecordEventDialog
      bind:open={scheduleOpen}
      matterId={scheduling.matterId}
      matters={[]}
      mattersCapped={false}
      {eventTypes}
      members={firmRoster.members ?? []}
      {preferredTimeZones}
      initialDate={null}
      initialTitle={consultationTitle(scheduling)}
      initialParticipants={scheduleParticipants}
      onRecorded={() => {
        scheduling = null;
        reread();
      }}
    />
  {/key}
{/if}
