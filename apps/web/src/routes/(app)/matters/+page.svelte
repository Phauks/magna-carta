<script lang="ts">
  /*
   * Matters — the firm's docket, and the List archetype's landing.
   *
   * It reads the firm's own record through the matters listing and renders it on the platform's one
   * table, so sorting, the per-column filters, column show/hide, reorder, pinning, resize and the
   * counts footer are the same machinery every other matter surface uses. Nothing here is a fixture.
   *
   * Three honest limits are on the screen rather than in a comment, because a person reading a
   * docket has to know which questions this page can answer:
   *
   *   - The listing is cursor-paged. Sorting and the column filters run over what has been LOADED,
   *     so the footer's counts are counts of the page, not of the firm, until the record is fully
   *     read. The line under "Load more" says so.
   *   - The listing's own default is the working docket, which leaves out unnumbered consultations.
   *     They are reachable only by asking for them, which is what the scope control is for.
   *   - The responsible attorney, practice area and Location arrive as identifiers and are named
   *     from the firm's own lists, read once per screen and joined here — never one request per
   *     row. A row whose identifier nothing names renders empty rather than showing the handle.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { goto } from "$app/navigation";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    listLocations,
    listMatterTypes,
    listMatters,
    readSession,
    type LocationSummary,
    type MatterScope,
    type MatterSummary,
    type MatterTypeSummary,
    type SessionBootstrap,
    CREATE_MATTER_PERMISSION,
  } from "$lib/matters/matters-api.ts";
  import {
    matterColumns,
    matterVocabulary,
    EMPTY_MATTER_VOCABULARY,
    MATTER_INITIAL_SORT,
  } from "$lib/matters/matter-columns.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";
  import NewMatterDialog from "$lib/matters/new-matter-dialog.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";

  // ---- what the screen is asking for ----------------------------------------------------------

  const SCOPE_ITEMS: readonly { value: MatterScope; label: string }[] = [
    { value: "caseload", label: "The working docket" },
    { value: "open", label: "Open matters" },
    { value: "closed", label: "Closed matters" },
    { value: "prospective", label: "Consultations" },
  ];

  let scope = $state<MatterScope>("caseload");
  let searchText = $state("");
  let appliedSearch = $state("");
  let dialogOpen = $state(false);
  let lastCreated = $state<{ matterId: string; matterNumber: string | null } | null>(null);

  // The typed query settles before it is sent: a docket read per keystroke is a request per
  // keystroke, and the server's search is the authoritative one over title, number and client.
  $effect(() => {
    const typed = searchText;
    const timer = setTimeout(() => (appliedSearch = typed), 300);
    return () => clearTimeout(timer);
  });

  // ---- the firm's own vocabularies and who is asking -------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let matterTypes = $state<readonly MatterTypeSummary[]>([]);
  let locations = $state<readonly LocationSummary[]>([]);
  let bootstrapped = $state(false);

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const [sessionOutcome, typesOutcome, locationsOutcome] = await Promise.all([
        readSession(fetch),
        listMatterTypes(fetch),
        listLocations(fetch),
        // The roster settles its own failure internally and is shared with the rest of the app, so
        // it rides the same bootstrap without a fourth outcome to unpack here.
        firmRoster.load(fetch),
      ]);
      if (sessionOutcome.kind === "ok") session = sessionOutcome.value;
      // A vocabulary that cannot be read leaves its column empty rather than failing the screen:
      // the docket is still readable without the names of its practice areas.
      if (typesOutcome.kind === "ok") matterTypes = typesOutcome.value.data;
      if (locationsOutcome.kind === "ok") locations = locationsOutcome.value.data;
    })();
  });

  // Every member the firm has, not only the active ones: a closed matter's responsible attorney may
  // have left, and their name is still the true answer for that row.
  const members = $derived(firmRoster.members ?? []);
  const vocabulary = $derived(
    matterTypes.length === 0 && locations.length === 0 && members.length === 0
      ? EMPTY_MATTER_VOCABULARY
      : matterVocabulary(matterTypes, locations, members),
  );

  // The create control is honest about the two different reasons it may be unavailable: a member
  // without the permission is told so, and a session that has not landed is simply not yet ready.
  const mayCreate = $derived(session?.permissions.includes(CREATE_MATTER_PERMISSION) ?? false);
  const createDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayCreate
        ? undefined
        : "Opening a matter needs the matters:create permission, which this account does not hold.",
  );

  // ---- the docket ------------------------------------------------------------------------------

  const list = new PagedList<MatterSummary>("The firm's matters could not be read.");
  const matters = $derived(list.items);
  const loadFailure = $derived(list.failure);
  // A change of scope or of the settled query is a different question, so it is a different read.
  const subject = $derived(`${scope}|${appliedSearch.trim()}`);

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load((cursor) => listMatters(fetch, { scope, search: appliedSearch, cursor }));
  });

  function loadMore(): void {
    void list.loadMore((cursor) => listMatters(fetch, { scope, search: appliedSearch, cursor }));
  }

  function reread(): void {
    list.reset(subject);
    void list.load((cursor) => listMatters(fetch, { scope, search: appliedSearch, cursor }));
  }

  const grid = DataTable.createDataTableGrid<MatterSummary>({
    columns: () => matterColumns(vocabulary),
    rows: () => matters ?? [],
    rowKey: (matter) => matter.id,
    initialSort: MATTER_INITIAL_SORT,
    itemNoun: { singular: "matter", plural: "matters" },
    onActivate: (matter) => void goto(`/matters/${matter.id}`),
  });

  const searching = $derived(appliedSearch.trim() !== "");

  function onCreated(created: { matterId: string; matterNumber: string | null }): void {
    lastCreated = created;
    reread();
  }
</script>

<svelte:head>
  <title>Matters · Magna Carta</title>
</svelte:head>

{#snippet matterCell({ row, column, text }: DataTable.GridCellContext<MatterSummary>)}
  {#if column.id === "matterNumber" && text !== ""}
    <!-- Tabular figures: matter numbers are read down a column and have to align. -->
    <span class="tabular-nums">{text}</span>
  {:else if column.id === "title"}
    <!-- A real link, so the docket keeps the browser's own gestures: open in place, or hold
         Ctrl/Cmd for a second matter in its own tab. -->
    <a class="underline underline-offset-2" href="/matters/{row.id}">{row.title}</a>
  {:else if column.id === "status"}
    {@const seal = matterStatusPresentation(row.status)}
    <Badge variant={seal.variant}>{seal.label}</Badge>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Matters</Masthead.Title>
    <Masthead.Meta>
      <span>The firm's active docket</span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <Button
      variant="primary"
      disabled={!mayCreate}
      title={createDisabledReason}
      onclick={() => (dialogOpen = true)}
    >
      <Plus class="size-16" aria-hidden="true" />
      New matter
    </Button>
  </Masthead.Actions>
</Masthead.Root>

{#if createDisabledReason !== undefined && session !== null}
  <Alert.Root variant="info" class="mb-16">
    <Alert.Title>Opening A Matter Is Not Available To This Account</Alert.Title>
    <Alert.Description>{createDisabledReason}</Alert.Description>
  </Alert.Root>
{/if}

{#if lastCreated !== null}
  <!-- The heading follows the outcome, never the intent: a consultation was not opened, and saying
       it was would contradict the sentence underneath it. -->
  <Alert.Root variant="success" class="mb-16">
    <Alert.Title>
      {lastCreated.matterNumber === null ? "The Consultation Is Recorded" : "The Matter Is Open"}
    </Alert.Title>
    <Alert.Description>
      {#if lastCreated.matterNumber === null}
        It is unnumbered until the firm decides to take it, so it sits under Consultations rather
        than on the working docket.
      {:else}
        The firm's counter drew number {lastCreated.matterNumber}.
      {/if}
      <a class="underline underline-offset-2" href="/matters/{lastCreated.matterId}">
        {lastCreated.matterNumber === null ? "Open the consultation" : "Open the matter"}
      </a>
    </Alert.Description>
  </Alert.Root>
{/if}

<section class="flex flex-col gap-16">
  <div class="flex flex-wrap items-end justify-between gap-16">
    <div class="flex flex-wrap items-end gap-16">
      <div class="flex flex-col gap-8">
        <Label id="matters-scope-label">Showing</Label>
        <Select.Root type="single" items={[...SCOPE_ITEMS]} bind:value={scope} allowDeselect={false}>
          <Select.Trigger class="min-w-64" aria-labelledby="matters-scope-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each SCOPE_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex flex-col gap-8">
        <Label for="matters-search">Search</Label>
        <Input
          id="matters-search"
          type="search"
          bind:value={searchText}
          aria-describedby="matters-search-hint"
        />
        <p id="matters-search-hint" class="text-xs text-text-muted">
          Over title, matter number and client, run by the firm's own record rather than over the
          rows on screen.
        </p>
      </div>
    </div>
    <DataTable.GridColumnsMenu {grid} />
  </div>

  {#if loadFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>The Docket Could Not Be Read</Alert.Title>
      <Alert.Description>
        {loadFailure}
        <Button variant="secondary" class="mt-8" onclick={reread}>
          <RotateCcw class="size-16" aria-hidden="true" />
          Try again
        </Button>
      </Alert.Description>
    </Alert.Root>
  {:else}
    <DataTable.Grid {grid} caption="The firm's matters" cell={matterCell} loading={matters === null}>
      {#snippet empty()}
        {#if searching}
          <EmptyState title="Nothing Matches That Search">
            No matter on the firm's record answers to that title, number or client. Clearing the
            search brings the docket back.
          </EmptyState>
        {:else if scope === "prospective"}
          <EmptyState title="No Consultations Yet">
            A consultation is a matter the firm has not taken on: it carries no number until it is
            opened, and it stays out of the working docket until then.
          </EmptyState>
        {:else}
          <EmptyState title="No Matters Yet">
            {#snippet actions()}
              <Button
                variant="primary"
                disabled={!mayCreate}
                title={createDisabledReason}
                onclick={() => (dialogOpen = true)}
              >
                <Plus class="size-16" aria-hidden="true" />
                New matter
              </Button>
            {/snippet}
            A matter is the file of record for everything the firm does: numbering, documents, time
            and trust all hang from one. Opening the first draws the firm's first matter number.
          </EmptyState>
        {/if}
      {/snippet}
    </DataTable.Grid>

    <DataTable.GridFooter {grid} />

    {#if list.nextCursor !== null}
      <div class="flex flex-col items-start gap-8">
        <Button variant="secondary" onclick={loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? "Loading" : "Load more matters"}
        </Button>
        <p class="text-xs text-text-muted">
          The firm's record continues past what is on screen. Sorting and the column filters run
          over the matters loaded so far, so the counts below the table are counts of these rows,
          not of the whole docket.
        </p>
      </div>
    {/if}

    {#if firmRoster.failure !== null}
      <!-- Said once, plainly, and only when it happened: the Responsible Attorney column is empty
           because the roster could not be read, not because the matters have no attorney. -->
      <p class="text-xs text-text-muted">
        {firmRoster.failure} The Responsible Attorney column reads empty until it can.
      </p>
    {/if}
  {/if}
</section>

{#if session !== null}
  <NewMatterDialog bind:open={dialogOpen} {session} {matterTypes} {locations} {onCreated} />
{/if}
