<script lang="ts">
  /*
   * THE task surface. One component, two screens: the matter's Tasks section and the member's own
   * work list. They differ by which matter a new task lands on, whether the rows name their matter,
   * and where the host seats this list's controls — and by nothing else, because a task is one
   * record and a reader moving between the two screens should not have to learn a second layout.
   *
   * WHAT IS OWED IS THE LIST; WHAT IS CLOSED IS ASKED FOR AT THE FOOT. Open work is all the list
   * shows until somebody says otherwise, and finished and archived work is added by two controls
   * below the rows rather than by a filter above them. The row above the list is for the acts a reader
   * arrives wanting — searching, and making a new task.
   *
   * THE LIST IS A LIST. A task is READ AND CHANGED in its own record window (task-record-window.svelte)
   * and so is a new one, which opens that same window with nothing in it yet. Nothing here unfolds
   * into a form: not the composer, not the edit, not the reason the firm is not doing something, not
   * the attach picker. Each of those was a second place to learn where a task's fields live, and
   * each of them took the list's own shape away — its count, its ordering, what is overdue — while
   * somebody typed in the middle of it. What the rows still carry is what a LIST is for: reading
   * what is owed, and ticking a thing off.
   *
   * WHAT IS DUE NEXT IS FIRST, and everything nobody has scheduled is last. That ordering is the
   * server's and is the same on both screens, so a task does not move when you change surface.
   *
   * OVERDUE IS COMPUTED HERE. There is no overdue field on the wire and no column behind it: it is a
   * comparison against now, made where somebody is reading, so it is never stale. Only an open task
   * can be overdue — a done task was done, and an archived one is not owed.
   *
   * CANCELLING AND DELETING ARE BOTH OFFERED — in the window, where the rest of a task's acts live —
   * and the copy says which is which. Cancelling records that the firm decided not to do the work
   * and keeps the decision; deleting is for a task that should not exist. Collapsing them would lose
   * the difference the record exists to hold.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleDate, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import CreateControl from "@magna-carta/design-system/create-control";
  import TaskRecordWindow from "$lib/matters/task-record-window.svelte";
  import TaskArchiveDialog from "$lib/matters/task-archive-dialog.svelte";
  import { attachableFoldersFor } from "$lib/matters/record-attachable-documents.ts";
  import { dueLine } from "$lib/matters/task-print-sheet.ts";
  import { SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import {
    describeTimeLogged,
    externalSystemLabel,
    OPEN_RUNGS,
    PRIORITY_LABELS,
    RUNG_LABELS,
    isOverdue,
    moveTaskToRung,
    newWriteKey,
    unarchiveTask,
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
    /** What to say when the record is genuinely empty, as opposed to filtered empty. */
    emptyTitle: string;
    emptyDescription: string;
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
    emptyTitle,
    emptyDescription,
  }: Props = $props();

  const taskList = new PagedList<MatterTask>("The tasks could not be read.");
  const roster = new FirmRoster();

  const tasks = $derived(taskList.items);
  const readFailure = $derived(taskList.failure);
  // A failed FIRST read settles the list to the notice with Retry, so the shape never stands over
  // nothing. A failed further page keeps the rows already read and says so above them.
  const firstReadFailed = $derived(readFailure !== null && (tasks?.length ?? 0) === 0);

  let session = $state<SessionBootstrap | null>(null);
  let matterFiles = $state<MatterFile[] | null>(null);
  let matterFolders = $state<readonly FolderSummary[]>([]);

  // WHAT IS NO LONGER OWED, and whether it has been asked for. Both off by default, because a task
  // list whose job is to say what is outstanding starts by showing what is outstanding; asking for
  // either is a disclosure at the foot of the list rather than a filter above it (see the controls
  // in the markup). They are two questions and not one: a done task was done, and an archived one
  // was put away from wherever it stood — including from done.
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
  // What is NARROWING the view, which is the search and nothing else. Its truth is what draws the
  // clear control, so the control's absence is itself the answer to "is anything hidden". Asking for
  // done or archived work WIDENS the list and is undone by its own control, so neither belongs
  // here: a clear control that appeared because more was shown would answer the wrong question.
  const narrowed = $derived(appliedSearch !== "");
  // What the clear control says it will undo, so pressing it is never a guess.
  const narrowingSummary = $derived(appliedSearch === "" ? "" : `searching "${appliedSearch}"`);

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
   *
   * `windowEditing` is bound because the two doors differ in exactly one thing — a new task opens in
   * its fields because there is nothing to read; an existing one opens in its values, and the
   * window's own Edit control is what turns them into fields.
   */
  let openTask = $state<MatterTask | null>(null);
  let windowOpen = $state(false);
  let windowEditing = $state(false);

  /** The task being put away. Its optional reason is asked for in its own panel. */
  let archiving = $state<MatterTask | null>(null);
  let archivingOpen = $state(false);

  let saving = $state(false);
  // The failure RECORD, not a sentence assembled from it: the Error ID and the remedy reach the
  // screen from the record, and a surface that flattened it would drop both. The words travel with
  // the failure rather than with the surface, because the two acts this list still performs —
  // ticking a task off and putting it back — fail differently.
  let writeFailure = $state<StatedFailure | null>(null);

  // THE PLANS THIS MATTER IS OFFERED, and the one being reviewed if any.
  //
  // The offer lives here rather than on the new-matter screen, and that is a better reading of
  // propose-and-confirm than hooking the moment a matter is created: a matter opened before its plan
  // existed can still take it, and somebody who declined at open can come back. What it is not is
  // automatic — reviewing is a thing a person starts.
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

  function nameOf(userId: string | null): string {
    if (userId === null) return "Unassigned";
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? "Not recorded";
  }

  const myName = $derived(session?.user.name ?? "You");
  // Writing, editing, moving along the rungs, archiving and deleting are one permission; putting a task in
  // somebody else's name is a second. A member without either still reads the list, so the controls
  // are absent rather than present-and-refusing.
  const canWrite = $derived(session === null || session.permissions.includes("tasks:write"));
  const canAssign = $derived(session === null || session.permissions.includes("tasks:assign"));
  // Why nothing can be written, stated once and read by every control that refuses — the one that
  // opens the window, and the window's own Edit, Save, attach and acts. Two copies of a refusal is
  // one copy that has already drifted.
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

  function applyFilters(): void {
    reload();
  }

  // What the control hands over once typing has stopped. Re-reading on a query that did not change
  // would spend a request to redraw the rows already on screen.
  function applySearch(query: string): void {
    const term = query.trim();
    if (term === appliedSearch) return;
    appliedSearch = term;
    reload();
  }

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    reload();
  }

  async function runWrite(
    call: () => Promise<ApiOutcome<unknown>>,
    whenSilent: string,
    after?: () => void,
  ): Promise<void> {
    if (saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await call();
    saving = false;
    if (outcome.kind === "ok") {
      after?.();
      reload();
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
   * A write landed on the task the window is open on: re-read the list, and re-point the window at
   * the row the server now holds. Without the second half the window would go on showing the values
   * it was opened with, which is how a surface comes to disagree with the list underneath it.
   */
  function afterWrite(savedTaskId: string): void {
    const current = filters;
    taskList.reset(subject);
    void taskList
      .load((cursor) => read(cursor, current))
      .then(() => {
        if (!windowOpen || openTask === null) return;
        // The saved task may have left the list entirely — a task just ticked off is not open work
        // — and the window is still showing it, so the row it was opened with stands rather than
        // the window emptying under the reader.
        const reread = (taskList.items ?? []).find((candidate) => candidate.id === savedTaskId);
        if (reread !== undefined) openTask = reread;
      });
  }

  /** The matter's files as the window's picker offers them, grouped by where they were filed. */
  const attachableFolders = $derived(attachableFoldersFor(matterFiles ?? [], matterFolders));

  const assignableMembers = $derived(
    (roster.members ?? []).filter((member) => member.status === "active"),
  );

  // The shape drawn while the first page is read: three rows in the list's own anatomy — title,
  // priority, who it is with and when it is due, the row's controls. Sample words only: the names
  // and dates are the sample vocabulary's, the titles are a task's own kind of words.
  const TASK_FIXTURE = [
    {
      title: "Draft the responses to the first set of interrogatories",
      priority: "High",
      assignee: samplePerson(0).name,
      due: sampleDate(0),
    },
    {
      title: "Confirm the deposition venue",
      priority: "Normal",
      assignee: samplePerson(1).name,
      due: sampleDate(3),
    },
    {
      title: "Send the client the hearing summary",
      priority: "Normal",
      assignee: "Unassigned",
      due: sampleDate(4),
    },
  ];
</script>

<!-- The search, then the create control, then the way back to everything: the same three, in the
     same order, as the docket and the custody register. The search grows toward the inline start as
     it opens, so what follows it never moves. WHERE they sit is the host's, not this list's — a
     screen with a masthead seats them in its action row, which is where every other main screen
     keeps them, and a matter's Tasks section seats them in the row under its own heading. -->
{#snippet controls()}
  <ScreenSearch
    bind:value={searchText}
    label="Search tasks"
    searchOn="pause"
    fieldClass="w-2xs sm:w-xs"
    disabled={isSample}
    onsearch={applySearch}
  />
  {#if ownNewButton}
    <!-- The one create control, the design system's, so this list reads like every other screen. It
         stays put while the panel is open — the control never leaves its place in the row, and
         abandoning a draft is asked for in the panel, where the draft is. -->
    <CreateControl
      noun="Task"
      title="Add a task, with whose it is and when it is due."
      refusal={writeRefusal}
      onpress={openNew}
    />
  {/if}
  <!-- Present only while something is narrowing the list, so its absence answers "is anything
       hidden". -->
  <DataTable.ClearFilters narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }} />
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

  <LoadingRegion
    loading={tasks === null}
    failed={firstReadFailed}
    empty={tasks !== null && tasks.length === 0}
    label="Reading the tasks"
    onRetry={reload}
    class="flex flex-col gap-16"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="Tasks Unavailable"
          fallback="The tasks could not be read."
          onRetry={reload}
        />
      {/if}
    {/snippet}
    {#snippet emptyState()}
      <EmptyState title={narrowed ? "Nothing matches" : emptyTitle}>
        {narrowed
          ? "No task matches what you are narrowing by. Clear it to see the rest."
          : emptyDescription}
      </EmptyState>
    {/snippet}
    {#snippet fixture()}
      <ul class="flex flex-col gap-8">
        {#each TASK_FIXTURE as task (task.title)}
          <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
            <div class="flex items-start justify-between gap-16">
              <div class="flex min-w-0 flex-col gap-4">
                <div class="flex flex-wrap items-center gap-8">
                  <span>{task.title}</span>
                  <Badge variant="neutral">{task.priority}</Badge>
                </div>
                <dl class="flex flex-wrap gap-x-16 gap-y-2 text-xs text-text-muted">
                  <div class="flex gap-4">
                    <dt>Assigned to</dt>
                    <dd class="text-text">{task.assignee}</dd>
                  </div>
                  <div class="flex gap-4">
                    <dt>Due</dt>
                    <dd class="text-text">{task.due}</dd>
                  </div>
                </dl>
              </div>
              <div class="flex shrink-0 flex-wrap items-center justify-end gap-4">
                <Button variant="secondary">Done</Button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/snippet}
    {@const shown = tasks ?? []}
    {#if readFailure !== null}
      <!-- A further page that did not land. The rows above were read and stand. -->
      <FailureNotice
        failure={readFailure}
        title="The Rest Of The Tasks Could Not Be Read"
        fallback="The next page of tasks could not be read. What is shown was read and stands."
        onRetry={() => {
          const current = filters;
          void taskList.loadMore((cursor) => read(cursor, current));
        }}
      />
    {/if}
    {#if shown.length > 0}
      <ul class="flex flex-col gap-8">
        {#each shown as task (task.id)}
          {@const overdue = isOverdue(task)}
          {@const due = dueLine(task, DataTable.formatDate)}
          {@const timeLogged = describeTimeLogged(task.timeLogged)}
          <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
            <div class="flex items-start justify-between gap-16">
              <div class="flex min-w-0 flex-col gap-4">
                <div class="flex flex-wrap items-center gap-8">
                  <!-- WHAT THE ROW IS, AND THE WAY IN. The task's own words are the control that
                       opens it, which is how a reader reaches a record everywhere else in the
                       product; the acts on the record are in the window, not repeated out here. -->
                  <Button
                    variant="ghost"
                    class="h-auto p-0 text-left font-normal whitespace-normal hover:underline"
                    title="Open this task"
                    onclick={() => openWindow(task)}
                  >
                    <span
                      class={task.rung === "done" || task.archivedAt !== null
                        ? "text-text-muted line-through"
                        : ""}
                    >
                      {task.title}
                    </span>
                  </Button>
                  {#if task.priority !== "normal"}
                    <Badge variant={task.priority === "urgent" ? "danger" : "neutral"}>
                      {PRIORITY_LABELS[task.priority]}
                    </Badge>
                  {/if}
                  <!-- WHERE IT STANDS, said once. To Do is the resting state of every open task
                       and a badge on every row saying so would be a badge nobody reads, so it is
                       the one rung that shows nothing. -->
                  {#if task.rung !== "to_do"}
                    <Badge variant="neutral">{RUNG_LABELS[task.rung]}</Badge>
                  {/if}
                  {#if task.archivedAt !== null}
                    <Badge variant="neutral">Archived</Badge>
                  {/if}
                  <!-- Overdue is a comparison against now, made here. It is not a state and there is
                       no column behind it. -->
                  {#if overdue}
                    <Badge variant="danger">Overdue</Badge>
                  {/if}
                  {#if task.blockedByTaskId !== null}
                    <!-- Waiting is guidance and gates nothing: this task can still be completed. -->
                    <Badge variant="neutral">Waiting on another task</Badge>
                  {/if}
                </div>
                {#if task.body !== null}
                  <p class="text-xs text-text-muted whitespace-pre-wrap">{task.body}</p>
                {/if}
                <dl class="flex flex-wrap gap-x-16 gap-y-2 text-xs text-text-muted">
                  <div class="flex gap-4">
                    <dt>Assigned to</dt>
                    <dd class="text-text">{nameOf(task.assigneeUserId)}</dd>
                  </div>
                  {#if due !== null}
                    <div class="flex gap-4">
                      <dt>Due</dt>
                      <dd class="text-text">{due}</dd>
                    </div>
                  {/if}
                  {#if showMatter && task.matterId === null}
                    <div class="flex gap-4">
                      <dt>Matter</dt>
                      <dd class="text-text">The firm's own work</dd>
                    </div>
                  {/if}
                  <!-- Only where there IS time. Most tasks carry none, and "0m" on every row would
                       be noise standing in for a fact nobody recorded. "by you" appears where the
                       reader may not see other timekeepers' time, so the number is never mistaken
                       for the whole task's. -->
                  {#if timeLogged !== null}
                    <div class="flex gap-4">
                      <dt>Time logged</dt>
                      <dd class="text-text">{timeLogged}</dd>
                    </div>
                  {/if}
                  <!-- Where else this task is written down. Absent on nearly every task, because
                       the product integrates with nothing on its own — a row here means an addon
                       put it there, and saying so is what stops somebody editing in two places
                       without knowing the other exists. -->
                  {#each task.externalLinks as link (link.id)}
                    <div class="flex gap-4">
                      <dt>{externalSystemLabel(link.system)}</dt>
                      <dd class="text-text">
                        {#if link.externalUrl === null}
                          <!-- No addressable page over there. The platform will not invent a URL
                               from an id pattern — that would be guessing at somebody else's
                               routing — so the handle is the honest thing to show. -->
                          {link.externalId}
                        {:else}
                          <!-- The destination is another system entirely, so it opens beside the
                               reader rather than in place — through the product's one gate for
                               that, never a hand-written target. -->
                          <a class="underline" href={link.externalUrl} {...opensBeside("external")}>
                            {link.externalId}
                          </a>
                        {/if}
                      </dd>
                    </div>
                  {/each}
                  {#if task.archiveReason !== null}
                    <div class="flex gap-4">
                      <dt>Archived because</dt>
                      <dd class="text-text">{task.archiveReason}</dd>
                    </div>
                  {/if}
                </dl>
                <!-- What the task points at, NAMED and nothing more. Attaching and detaching are
                     acts on the record and live in its window's Attachments tab; a row that offered
                     them would be the list editing a record it is only listing. -->
                {#if task.documents.length > 0}
                  <ul class="flex flex-wrap gap-8 text-xs">
                    {#each task.documents as document (document.id)}
                      <li class="flex items-center gap-4">
                        <Paperclip aria-hidden="true" class="size-12 text-text-muted" />
                        <span>{document.fileName}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>

              {#if canWrite}
                <!-- THE ONE ACT A LIST IS FOR: ticking a thing off, and putting it back. The four
                     rungs are in the task's own window, where the rest of its acts are; a list that
                     carried the whole group on every row would be four controls deep on work
                     somebody is only scanning. Done is the one that belongs out here, because
                     clearing finished work off a list IS what a list is for.
                     An ARCHIVED row offers only the way back: everything else about it is an act on
                     a record nobody is looking at from here.
                     It renders at rest rather than on hover: a control somebody has to discover by
                     pointing at it is a control most people never find. -->
                <div class="flex shrink-0 flex-wrap items-center justify-end gap-4">
                  {#if task.archivedAt !== null}
                    <Button
                      variant="secondary"
                      disabled={saving}
                      title="Put this task back on the list, on the rung it left from"
                      onclick={() =>
                        runWrite(
                          () => unarchiveTask(fetch, task.id, newWriteKey()),
                          "The task was not put back.",
                        )}
                    >
                      <ArchiveRestore aria-hidden="true" />
                      Put Back
                    </Button>
                  {:else if task.rung === "done"}
                    <Button
                      variant="secondary"
                      disabled={saving}
                      title="Put this task back on the list"
                      onclick={() =>
                        runWrite(
                          () => moveTaskToRung(fetch, task.id, "to_do", newWriteKey()),
                          "The task was not reopened.",
                        )}
                    >
                      <RotateCcw aria-hidden="true" />
                      Reopen
                    </Button>
                  {:else}
                    <Button
                      variant="secondary"
                      disabled={saving}
                      onclick={() =>
                        runWrite(
                          () => moveTaskToRung(fetch, task.id, "done", newWriteKey()),
                          "The task was not completed.",
                        )}
                    >
                      Done
                    </Button>
                  {/if}
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>

      {#if taskList.nextCursor !== null}
        <div class="flex justify-center">
          <Button
            variant="secondary"
            disabled={taskList.loadingMore}
            onclick={() => {
              const current = filters;
              void taskList.loadMore((cursor) => read(cursor, current));
            }}
          >
            Show More
          </Button>
        </div>
      {/if}
    {/if}
  </LoadingRegion>

  <!-- WHAT IS NO LONGER OWED IS ASKED FOR WHERE THE OPEN WORK ENDS. Finished and archived tasks are not what
       this list is for, so they are not two boxes over it competing with the search for the row a
       reader searches from: they are two disclosures at the foot, met after everything still owed
       has been read. Two questions and not one: a task is archived FROM wherever it stood, done
       included. Each is undone by its own label, which is why neither draws the clear control
       — a control that says "Show Everything" because MORE is on screen answers the wrong
       question. Absent while the list has not settled, so nothing offers to widen a list that is
       not there yet. -->
  {#if tasks !== null && !firstReadFailed && !isSample}
    <div class="flex flex-wrap items-center justify-center gap-8 border-t border-border-subtle pt-12">
      <Button
        variant="ghost"
        size="sm"
        class={showDone ? "text-accent-default" : "text-text-muted"}
        title={showDone ? "Leave the done work out of the list" : "Add the work already done to the list"}
        onclick={() => {
          showDone = !showDone;
          applyFilters();
        }}
      >
        {showDone ? "Hide Done" : "Show Done"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class={showArchived ? "text-accent-default" : "text-text-muted"}
        title={showArchived
          ? "Leave the archived work out of the list"
          : "Add the work that has been put away to the list"}
        onclick={() => {
          showArchived = !showArchived;
          applyFilters();
        }}
      >
        {showArchived ? "Hide Archived" : "Show Archived"}
      </Button>
    </div>
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
