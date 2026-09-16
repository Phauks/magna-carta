<script lang="ts">
  /*
   * THE task surface. One component, two screens: the matter's Tasks section and the member's own
   * work list. They differ by which matter a new task lands on, whether the rows name their matter,
   * and where the host seats this list's controls — and by nothing else, because a task is one
   * record and a reader moving between the two screens should not have to learn a second layout.
   *
   * IT IS A TABLE, ON THE PLATFORM'S ONE TABLE. The owner's ruling of 2026-09-16: "tasks should be
   * a table. should be able to sort by matter, date, and all information." So the rows are
   * DataTable.Grid, which brings the settled machinery every other register has — click a heading
   * to sort, right-click it for its filter, hide and reorder and pin columns, double-click a row to
   * open it — and the column model (task-columns.ts) declares every fact a task can answer, the
   * few a reader wants first visible and the rest a press away.
   *
   * WHAT IS OWED IS THE LIST; WHAT IS CLOSED IS ASKED FOR IN THE TABLE'S OWN FOOTER. Open work is
   * all the list shows until somebody says otherwise. Done and archived work are added by two
   * switches in the counts strip under the rows — the strip that already says how much of the
   * record is on screen — rather than by two buttons floating under the list, which is the design
   * the owner disliked. They WIDEN the list and are undone by their own switch, so neither is a
   * filter and neither draws the clear control.
   *
   * THE STATUS CELL IS A CONTROL. A task's rung changes from the row, without opening it, because
   * moving a task along is the act a list is for — the same reason Done used to sit beside every
   * row. Everything else a task can do to itself is in its window.
   *
   * THE DESCRIPTION IS THE ROW'S SECOND LINE, never a column, on the standing ruling that prose in
   * a column is either cut to a few words or wide enough to push the facts off the screen.
   *
   * OVERDUE IS COMPUTED HERE. There is no overdue field on the wire and no column behind it: it is a
   * comparison against now, made where somebody is reading, so it is never stale. Only an open task
   * can be overdue — a done task was done, and an archived one is not owed.
   *
   * A DEEP LINK OPENS ITS TASK. A notification or an activity row lands here with `?entry=`, and the
   * task it names is read by its handle and opened in its window — never left for the reader to
   * find in the rows, which may not even hold it.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Switch from "@magna-carta/design-system/switch";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import CreateControl from "@magna-carta/design-system/create-control";
  import TaskRecordWindow from "$lib/matters/task-record-window.svelte";
  import TaskArchiveDialog from "$lib/matters/task-archive-dialog.svelte";
  import { attachableFoldersFor } from "$lib/matters/record-attachable-documents.ts";
  import { SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import { timeZoneShortCode } from "$lib/calendar/time-zone-options.ts";
  import {
    TASK_INITIAL_SORT,
    taskColumns,
    taskNarrowingSummary,
    tasksAreNarrowed,
  } from "$lib/matters/task-columns.ts";
  import {
    OPEN_RUNGS,
    PRIORITY_LABELS,
    RUNG_LABELS,
    TASK_RUNGS,
    isOverdue,
    moveTaskToRung,
    newWriteKey,
    readTask,
    type MatterTask,
    type TaskListFilters,
    type TaskRung,
  } from "$lib/matters/tasks-api.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { listMatterFolders, type FolderSummary } from "$lib/file-manager/folder-api.ts";
  import PlanProposalReview from "$lib/matters/plan-proposal.svelte";
  import { plansOfferedFor, type MatterPlan } from "$lib/matters/matter-plans-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { ApiOutcome, Page } from "$lib/api/request.ts";
  import type { Snippet } from "svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  interface Props {
    /** What identifies the rows on screen, so a reload is told from a change of subject. */
    subject: string;
    /** Reads one page under the current filters. */
    read: (cursor: string | undefined, filters: TaskListFilters) => Promise<ApiOutcome<Page<MatterTask>>>;
    /** Which matter a new task lands on. Null on the member's own list: firm work has no matter. */
    matterId: string | null;
    /** Named in the composer so nothing is stored the writer was not shown. */
    matterTitle: string | null;
    /** Rows name their matter on a list that spans several. */
    showMatter?: boolean;
    /** A sample matter has no firm behind it and therefore nothing to read. */
    isSample?: boolean;
    /**
     * Whether the list draws its own New Task button. The member's own work list does; a matter's
     * Tasks section does not, because the matter header's create control is that screen's one create
     * button and the page puts openNew() behind it (create-action.svelte.ts).
     */
    ownNewButton?: boolean;
    /**
     * The label leading the control row. A matter's Tasks section names itself here, because the
     * matter's own masthead carries the MATTER's name and the section would otherwise be unnamed.
     * Omitted where the screen's own header already states it, so the name is not said twice.
     */
    heading?: string;
    /**
     * The band above the list, drawn by the host and handed this list's controls to seat in it.
     * A screen with a masthead of its own passes one and puts the controls in its action row, so
     * the search and the create control sit where every other main screen keeps them; a matter's
     * Tasks section passes nothing and this list draws its own row under its heading.
     */
    screenHeader?: Snippet<[Snippet]>;
    /** The table's accessible name. */
    caption: string;
  }

  let {
    subject,
    read,
    matterId,
    matterTitle,
    showMatter = false,
    isSample = false,
    ownNewButton = true,
    heading,
    screenHeader,
    caption,
  }: Props = $props();

  const taskList = new PagedList<MatterTask>("The tasks could not be read.");
  const roster = new FirmRoster();

  const tasks = $derived(taskList.items);
  const readFailure = $derived(taskList.failure);

  let session = $state<SessionBootstrap | null>(null);
  let matterFiles = $state<MatterFile[] | null>(null);
  let matterFolders = $state<readonly FolderSummary[]>([]);

  // WHAT IS NO LONGER OWED, and whether it has been asked for. Both off by default, because a task
  // list whose job is to say what is outstanding starts by showing what is outstanding. They are two
  // questions and not one: a done task was done, and an archived one was put away from wherever it
  // stood — including from done.
  let showDone = $state(false);
  let showArchived = $state(false);
  // ScreenSearch owns the field and the pause before a query leaves the machine; this holds only
  // what the last pause actually sent, which is what the read is filtered by.
  let searchText = $state("");
  let appliedSearch = $state("");

  // The three open rungs always, and Done only when it is asked for.
  const rungs = $derived<readonly TaskRung[]>([
    ...OPEN_RUNGS,
    ...(showDone ? (["done"] as const) : []),
  ]);
  const filters = $derived<TaskListFilters>({
    rungs,
    ...(showArchived ? { includeArchived: true } : {}),
    ...(appliedSearch === "" ? {} : { search: appliedSearch }),
  });

  /** Opens the window on a new task, for a screen whose create control lives outside this list. */
  export function openNew(): void {
    openWindow(null);
  }

  /*
   * THE WINDOW, and the one task it is open on. Null is a NEW task rather than "no task": the window
   * has one mode for a record that does not exist yet, and holding that as a separate flag here
   * would be a second answer to the same question.
   */
  let openTask = $state<MatterTask | null>(null);
  let windowOpen = $state(false);
  let windowEditing = $state(false);

  /** The task being put away. Its optional reason is asked for in its own panel. */
  let archiving = $state<MatterTask | null>(null);
  let archivingOpen = $state(false);

  let saving = $state(false);
  // The failure RECORD, not a sentence assembled from it: the Error ID and the remedy reach the
  // screen from the record, and a surface that flattened it would drop both.
  let writeFailure = $state<StatedFailure | null>(null);

  // THE PLANS THIS MATTER IS OFFERED, and the one being reviewed if any. The offer lives here rather
  // than on the new-matter screen: a matter opened before its plan existed can still take it, and
  // somebody who declined at open can come back. What it is not is automatic.
  let offeredPlans = $state<readonly MatterPlan[] | null>(null);
  let reviewingPlan = $state<MatterPlan | null>(null);

  $effect(() => {
    if (taskList.showing(subject)) return;
    taskList.reset(subject);
    windowOpen = false;
    openTask = null;
    archivingOpen = false;
    archiving = null;
    searchText = "";
    appliedSearch = "";
    showDone = false;
    showArchived = false;
    writeFailure = null;
    matterFiles = null;
    matterFolders = [];
    honouredEntry = null;
    if (isSample) {
      taskList.settleEmpty();
      matterFiles = [];
      return;
    }
    void readSession(fetch).then((outcome) => {
      session = outcome.kind === "ok" ? outcome.value : null;
    });
    void taskList.load((cursor) => read(cursor, { rungs: OPEN_RUNGS }));
    void roster.load(fetch);
    offeredPlans = null;
    reviewingPlan = null;
    if (matterId !== null) {
      void plansOfferedFor(fetch, matterId).then((outcome) => {
        // A failed plan read never fails the screen: the task list is the point, and the offer is an
        // addition to it.
        offeredPlans = outcome.kind === "ok" ? outcome.value.data : [];
      });
      // The matter's files and the folders they are filed in, for the window's Attachments tab. A
      // failed read never fails the screen: tasks still read, and the picker says what it cannot
      // offer rather than disappearing.
      void listMatterFiles(fetch, matterId).then((outcome) => {
        matterFiles = outcome.kind === "ok" ? outcome.value.data : [];
      });
      void listMatterFolders(fetch, matterId).then((outcome) => {
        matterFolders = outcome.kind === "ok" ? outcome.value.data : [];
      });
    } else {
      matterFiles = [];
      offeredPlans = [];
    }
  });

  /*
   * The task this address names, opened the way any task opens — read by its handle rather than
   * found on the page, so a task past the first page, or one that is done, opens all the same. Once
   * per address.
   */
  let honouredEntry = $state<string | null>(null);
  $effect(() => {
    const entry = entryFromUrl();
    if (entry === null || isSample || honouredEntry === entry) return;
    honouredEntry = entry;
    void readTask(fetch, entry).then((outcome) => {
      if (outcome.kind === "ok") openWindow(outcome.value);
    });
  });

  function nameOf(userId: string | null): string {
    if (userId === null) return "";
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? "Not recorded";
  }

  const myName = $derived(session?.user.name ?? "You");
  const selfUserId = $derived(session?.user.id ?? null);
  // Writing, editing, moving along the rungs, archiving and deleting are one permission; putting a
  // task in somebody else's name is a second. A member without either still reads the list, so the
  // controls are absent rather than present-and-refusing.
  const canWrite = $derived(session === null || session.permissions.includes("tasks:write"));
  const canAssign = $derived(session === null || session.permissions.includes("tasks:assign"));
  // Why nothing can be written, stated once and read by every control that refuses. Two copies of a
  // refusal is one copy that has already drifted.
  const writeRefusal = $derived(
    isSample
      ? SAMPLE_MATTER_REFUSAL
      : canWrite
        ? undefined
        : permissionRefusal("Changing a task", "tasks:write"),
  );

  function reload(): void {
    taskList.reset(subject);
    const current = filters;
    void taskList.load((cursor) => read(cursor, current));
  }

  function loadMore(): void {
    const current = filters;
    void taskList.loadMore((cursor) => read(cursor, current));
  }

  // What the control hands over once typing has stopped. Re-reading on a query that did not change
  // would spend a request to redraw the rows already on screen.
  function applySearch(query: string): void {
    const term = query.trim();
    if (term === appliedSearch) return;
    appliedSearch = term;
    reload();
  }

  async function runWrite(
    call: () => Promise<ApiOutcome<unknown>>,
    whenSilent: string,
  ): Promise<void> {
    if (saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await call();
    saving = false;
    if (outcome.kind === "ok") {
      afterWrite(null);
      return;
    }
    writeFailure = stated(outcome.failure, whenSilent);
  }

  /*
   * Open the window on a task, or on a new one.
   *
   * A task that exists opens in its VALUES: reading it is what somebody came to do, and the window's
   * own Edit control is what turns them into fields. A new one has nothing to read, so it opens in
   * its fields — the one difference between the two doors, and the whole of it.
   */
  function openWindow(task: MatterTask | null): void {
    openTask = task;
    windowEditing = task === null;
    windowOpen = true;
  }

  /*
   * A write landed: re-read the list, and re-point the window at the row the server now holds.
   * Without the second half the window would go on showing the values it was opened with, which is
   * how a surface comes to disagree with the list underneath it. A task the list no longer holds — a
   * task just ticked off with done work hidden — is re-read by its handle so the window stays true.
   */
  function afterWrite(savedTaskId: string | null): void {
    const current = filters;
    const wanted = savedTaskId ?? openTask?.id ?? null;
    taskList.reset(subject);
    void taskList
      .load((cursor) => read(cursor, current))
      .then(() => {
        if (!windowOpen || openTask === null || wanted === null) return;
        const reread = (taskList.items ?? []).find((candidate) => candidate.id === wanted);
        if (reread !== undefined) {
          openTask = reread;
          return;
        }
        void readTask(fetch, wanted).then((outcome) => {
          if (outcome.kind === "ok" && windowOpen && openTask?.id === wanted) openTask = outcome.value;
        });
      });
  }

  /** The matter's files as the window's picker offers them, grouped by where they were filed. */
  const attachableFolders = $derived(attachableFoldersFor(matterFiles ?? [], matterFolders));

  const assignableMembers = $derived(
    (roster.members ?? []).filter((member) => member.status === "active"),
  );
  // Every member's name, for the people columns' set filters: the whole roster, not the names that
  // happen to be on screen, so a colleague carrying nothing today can still be asked for.
  const memberNames = $derived(
    [...new Set((roster.members ?? []).map((member) => member.displayName))].toSorted((left, right) =>
      left.localeCompare(right),
    ),
  );

  // ---- the table ------------------------------------------------------------------------------

  const grid = DataTable.createDataTableGrid<MatterTask>({
    columns: () => taskColumns({ nameOf, memberNames }, { showMatter }),
    rows: () => tasks ?? [],
    rowKey: (task) => task.id,
    initialSort: TASK_INITIAL_SORT,
    itemNoun: { singular: "task", plural: "tasks" },
    // Double-click and Enter open the task, anywhere on the row.
    onActivate: (task) => openWindow(task),
  });

  const narrowing = $derived({ search: appliedSearch, columnFilterCount: grid.activeFilterCount });
  const narrowed = $derived(tasksAreNarrowed(narrowing));
  const narrowingSummary = $derived(taskNarrowingSummary(narrowing));

  // Both halves of the query, because the control reports a query it was TYPED into and clearing
  // from out here is not typing.
  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid.clearAllFilters();
    reload();
  }

  /** The zone beside a due time, as a shortcode worked out on the task's own day. */
  function zoneCode(task: MatterTask): string {
    if (task.timeZone === null || task.dueOn === null) return "";
    return timeZoneShortCode(task.timeZone, new Date(`${task.dueOn}T12:00:00Z`));
  }

  const identity = $props.id();
</script>

<!-- The search, then the way back to everything, then the create control: the same three, in the
     same order, as the docket. The search grows toward the inline start as it opens, so what
     follows it never moves. WHERE they sit is the host's, not this list's. -->
{#snippet controls()}
  <ScreenSearch
    bind:value={searchText}
    label="Search tasks"
    placeholder={placeholderOf("Search tasks")}
    searchOn="pause"
    fieldClass="w-2xs sm:w-xs"
    disabled={isSample}
    onsearch={applySearch}
  />
  <!-- Present only while something is narrowing the list, so its absence answers "is anything
       hidden". Showing done or archived work widens the list and is not counted. -->
  <DataTable.ClearFilters
    {grid}
    narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
  />
  {#if ownNewButton}
    <CreateControl
      noun="Task"
      title="Add a task, with whose it is and when it is due."
      refusal={writeRefusal}
      onpress={openNew}
    />
  {/if}
{/snippet}

{#snippet cell({ row, column, text }: DataTable.GridCellContext<MatterTask>)}
  {#if column.id === "title"}
    {@const overdue = isOverdue(row)}
    <span class="flex flex-wrap items-center gap-8">
      <span class={row.rung === "done" || row.archivedAt !== null ? "text-text-muted line-through" : ""}>
        {row.title}
      </span>
      {#if row.archivedAt !== null}
        <Badge variant="neutral">Archived</Badge>
      {/if}
      {#if overdue}
        <Badge variant="danger">Overdue</Badge>
      {/if}
      {#if row.blockedByTaskId !== null}
        <!-- Waiting is guidance and gates nothing: this task can still be completed. -->
        <Badge variant="neutral">Waiting</Badge>
      {/if}
      {#if row.documents.length > 0}
        <span class="flex items-center gap-4 text-xs text-text-muted" title="{row.documents.length} attached">
          <Paperclip aria-hidden="true" class="size-12" />
          {row.documents.length}
        </span>
      {/if}
    </span>
  {:else if column.id === "rung"}
    {#if canWrite && row.archivedAt === null && !isSample}
      <!-- THE STATUS IS A CONTROL: the rung moves from the row, without opening the task. The menu
           lists the four with the current one marked, and picking one is the same write the
           window's action bar makes. -->
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="inline-flex items-center gap-4 rounded-md border border-border-subtle px-8 py-2 text-sm hover:border-border-emphasis"
          title="Move this task"
          aria-label="Status: {RUNG_LABELS[row.rung]}. Move this task"
          disabled={saving}
        >
          {RUNG_LABELS[row.rung]}
          <ChevronDown class="size-12 text-text-muted" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          <DropdownMenu.RadioGroup value={row.rung}>
            {#each TASK_RUNGS as rung (rung)}
              <DropdownMenu.RadioItem
                value={rung}
                disabled={rung === row.rung}
                onSelect={() =>
                  void runWrite(
                    () => moveTaskToRung(fetch, row.id, rung, newWriteKey()),
                    "The task was not moved.",
                  )}
              >
                {RUNG_LABELS[rung]}
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {:else}
      <Badge variant="neutral">{RUNG_LABELS[row.rung]}</Badge>
    {/if}
  {:else if column.id === "dueOn"}
    {#if text === ""}
      <span class="text-text-muted">—</span>
    {:else}
      <span class="tabular-nums">
        {text}
        {#if row.dueAtTime !== null}
          <span>{row.dueAtTime}</span>
          <span class="text-text-muted" title={row.timeZone ?? undefined}>{zoneCode(row)}</span>
        {/if}
      </span>
    {/if}
  {:else if column.id === "priority"}
    {#if row.priority === "urgent"}
      <Badge variant="danger">{PRIORITY_LABELS.urgent}</Badge>
    {:else if row.priority === "high"}
      <Badge variant="warning">{PRIORITY_LABELS.high}</Badge>
    {:else}
      {text}
    {/if}
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<!-- The description is the row's second line, wrapping at the row's full width. -->
{#snippet rowDetail(row: MatterTask)}
  {#if row.body !== null}
    <p class="w-full text-sm whitespace-pre-wrap text-text-muted">{row.body}</p>
  {/if}
{/snippet}

<section class="flex min-h-0 flex-1 flex-col gap-16">
  {#if screenHeader !== undefined}
    {@render screenHeader(controls)}
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-16 border-b border-border-strong pb-8">
      {#if heading !== undefined}
        <FieldLabel as="h2">
          {heading}
        </FieldLabel>
      {/if}
      <div class="flex flex-wrap items-center gap-8">
        {@render controls()}
      </div>
    </div>
  {/if}

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      title="Nothing Changed"
      fallback={writeFailure.fallback}
    />
  {/if}

  {#if reviewingPlan !== null && matterId !== null}
    <PlanProposalReview
      {matterId}
      planId={reviewingPlan.id}
      planName={reviewingPlan.name}
      onAccepted={() => {
        reviewingPlan = null;
        reload();
      }}
      onDismiss={() => (reviewingPlan = null)}
    />
  {:else if canWrite && offeredPlans !== null && offeredPlans.length > 0}
    <!-- The offer, and it is only ever an offer. Nothing is written until somebody opens this and
         accepts what they see. -->
    <div class="flex flex-wrap items-center justify-between gap-8 rounded-md border border-border-subtle p-12">
      <span class="text-xs text-text-muted">
        {offeredPlans.length === 1
          ? `This matter has a plan: ${offeredPlans[0]?.name ?? ""}.`
          : `This matter has ${String(offeredPlans.length)} plans.`}
        Reviewing one shows what it would add, and adds nothing until you say so.
      </span>
      <div class="flex flex-wrap gap-8">
        {#each offeredPlans as plan (plan.id)}
          <Button variant="secondary" disabled={saving} onclick={() => (reviewingPlan = plan)}>
            Review {plan.name}
          </Button>
        {/each}
      </div>
    </div>
  {/if}

  {#if readFailure !== null && (tasks?.length ?? 0) === 0}
    <!-- A failed FIRST read settles to the notice with Retry, so the shape never stands over
         nothing. -->
    <FailureNotice
      failure={readFailure}
      title="Tasks Unavailable"
      fallback="The tasks could not be read."
      onRetry={reload}
    />
  {:else}
    {#if readFailure !== null}
      <!-- A further page that did not land. The rows below were read and stand. -->
      <FailureNotice
        failure={readFailure}
        title="The Rest Of The Tasks Could Not Be Read"
        fallback="The next page of tasks could not be read. What is shown was read and stands."
        onRetry={loadMore}
      />
    {/if}
    <!-- The table holds the height it would hold when full, so the screen does not reflow as rows
         arrive or a filter narrows them. -->
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      {caption}
      {cell}
      {rowDetail}
      loading={tasks === null}
    >
    </DataTable.Grid>

    <!-- The counts strip: how much is on screen, what is hiding the rest, the way to all of it —
         and the two switches that ADD the closed work to the list. They live here, in the strip
         that already counts the rows, because what they change is what the count is of. -->
    <DataTable.GridFooter {grid}>
      {#snippet end()}
        {#if tasks !== null && !isSample}
          <span class="flex items-center gap-16">
            <span class="flex items-center gap-8">
              <Switch
                id="{identity}-show-done"
                checked={showDone}
                disabled={saving}
                onCheckedChange={(next) => {
                  showDone = next;
                  reload();
                }}
              />
              <Label for="{identity}-show-done" class="text-xs text-text-muted">Show done</Label>
            </span>
            <span class="flex items-center gap-8">
              <Switch
                id="{identity}-show-archived"
                checked={showArchived}
                disabled={saving}
                onCheckedChange={(next) => {
                  showArchived = next;
                  reload();
                }}
              />
              <Label for="{identity}-show-archived" class="text-xs text-text-muted">
                Show archived
              </Label>
            </span>
          </span>
        {/if}
        <DataTable.LoadMore
          noun="tasks"
          more={taskList.nextCursor !== null}
          loading={taskList.loadingMore}
          onLoad={loadMore}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</section>

<!-- THE WINDOW a task is read and changed in, and the one a new task is written in. It carries its
     own fields and its own failures, so no part of a draft or an edit touches this component's
     state and the list keeps its shape while one is open. -->
<TaskRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  task={openTask}
  {matterId}
  {matterTitle}
  authorName={myName}
  {selfUserId}
  {nameOf}
  {assignableMembers}
  {attachableFolders}
  matterFiles={matterFiles ?? []}
  {writeRefusal}
  {canAssign}
  onSaved={afterWrite}
  onArchive={(subject) => {
    archiving = subject;
    archivingOpen = true;
  }}
/>

<!-- Putting a task away, asked for once and serving both the window and this list. -->
<TaskArchiveDialog
  bind:open={archivingOpen}
  task={archiving}
  onArchived={() => {
    if (archiving !== null) afterWrite(archiving.id);
  }}
/>
