<script lang="ts">
  /*
   * THE task surface. One component, two screens: the matter's Tasks section and the member's own
   * work list. They differ by two props — which matter a new task lands on, and whether the rows
   * name their matter — and by nothing else, because a task is one record and a reader moving
   * between the two screens should not have to learn a second layout.
   *
   * WHAT IS DUE NEXT IS FIRST, and everything nobody has scheduled is last. That ordering is the
   * server's and is the same on both screens, so a task does not move when you change surface.
   *
   * OVERDUE IS COMPUTED HERE. There is no overdue field on the wire and no column behind it: it is a
   * comparison against now, made where somebody is reading, so it is never stale. Only an open task
   * can be overdue — a done task was done, and a cancelled one is not owed.
   *
   * CANCELLING AND DELETING ARE BOTH OFFERED, and the copy says which is which. Cancelling records
   * that the firm decided not to do the work and keeps the decision; deleting is for a task that
   * should not exist. Collapsing them would lose the difference the record exists to hold.
   */
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleDate, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Ban from "@lucide/svelte/icons/ban";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import X from "@lucide/svelte/icons/x";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import {
    describeTimeLogged,
    externalSystemLabel,
    PRIORITY_LABELS,
    STATE_LABELS,
    TASK_PRIORITIES,
    attachTaskDocument,
    cancelTask,
    completeTask,
    createTask,
    deleteTask,
    detachTaskDocument,
    editTask,
    isOverdue,
    newWriteKey,
    reassignTask,
    reopenTask,
    viewerTimeZone,
    type MatterTask,
    type TaskListFilters,
    type TaskPriority,
    type TaskState,
  } from "$lib/matters/tasks-api.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import PlanProposalReview from "$lib/matters/plan-proposal.svelte";
  import { plansOfferedFor, type MatterPlan } from "$lib/matters/matter-plans-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { ApiOutcome, Page } from "$lib/api/request.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

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

  // The filters. `showDone` is the only one on by default being off: a task list whose job is to say
  // what is owed starts by showing what is owed.
  let showDone = $state(false);
  let showCancelled = $state(false);
  // ScreenSearch owns the field and the pause before a query leaves the machine; this holds only
  // what the last pause actually sent, which is what the read is filtered by.
  let searchText = $state("");
  let appliedSearch = $state("");

  const states = $derived<readonly TaskState[]>(
    ["open", ...(showDone ? (["done"] as const) : []), ...(showCancelled ? (["cancelled"] as const) : [])],
  );
  // Anything narrowing the view. Its truth is what draws the clear control, so the control's absence
  // is itself the answer to "is anything hidden".
  const narrowed = $derived(appliedSearch !== "" || showDone || showCancelled);
  // What the clear control says it will undo, so pressing it is never a guess.
  const narrowingSummary = $derived(
    [
      ...(appliedSearch === "" ? [] : [`searching "${appliedSearch}"`]),
      ...(showDone ? ["showing done"] : []),
      ...(showCancelled ? ["showing cancelled"] : []),
    ].join(", "),
  );

  const filters = $derived<TaskListFilters>({
    states,
    ...(appliedSearch === "" ? {} : { search: appliedSearch }),
  });

  /** Opens the composer, for a screen whose create control lives outside this list. */
  export function openNew(): void {
    composing = true;
  }

  // Composing.
  let composing = $state(false);
  let draftTitle = $state("");
  let draftBody = $state("");
  let draftPriority = $state<TaskPriority>("normal");
  let draftDueOn = $state("");
  let draftDueAtTime = $state("");
  let draftAssignee = $state("");
  let saving = $state(false);
  // The failure RECORD, not a sentence assembled from it: the Error ID and the remedy reach the
  // screen from the record, and a surface that flattened it would drop both. The words travel with
  // the failure rather than with the surface, because one slot here holds several different
  // actions and "the task was not completed" and "the task was not deleted" are different facts.
  let writeFailure = $state<StatedFailure | null>(null);

  // Editing an existing task, keyed by task so only the one being edited turns into fields.
  let editingTaskId = $state<string | null>(null);
  let editTitle = $state("");
  let editBody = $state("");
  let editPriority = $state<TaskPriority>("normal");
  let editDueOn = $state("");
  let editDueAtTime = $state("");

  // Which task is being cancelled, and why. The reason is required, so the control is a field rather
  // than a confirmation: "we decided not to" with no explanation tells a firm nothing later.
  let cancelling = $state<MatterTask | null>(null);
  let cancelReason = $state("");

  let attachingTaskId = $state<string | null>(null);

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
    composing = false;
    editingTaskId = null;
    cancelling = null;
    attachingTaskId = null;
    searchText = "";
    appliedSearch = "";
    writeFailure = null;
    matterFiles = null;
    if (isSample) {
      taskList.settleEmpty();
      matterFiles = [];
      return;
    }
    void readSession(fetch).then((outcome) => {
      session = outcome.kind === "ok" ? outcome.value : null;
    });
    void taskList.load((cursor) => read(cursor, { states: ["open"] }));
    void roster.load(fetch);
    offeredPlans = null;
    reviewingPlan = null;
    if (matterId !== null) {
      void plansOfferedFor(fetch, matterId).then((outcome) => {
        // A failed plan read never fails the screen: the task list is the point, and the offer is an
        // addition to it.
        offeredPlans = outcome.kind === "ok" ? outcome.value.data : [];
      });
      void listMatterFiles(fetch, matterId).then((outcome) => {
        // A failed file read never fails the screen: tasks still read, and the attach control says
        // what it cannot offer rather than disappearing.
        matterFiles = outcome.kind === "ok" ? outcome.value.data : [];
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
  // Writing, editing, completing, cancelling and deleting are one permission; putting a task in
  // somebody else's name is a second. A member without either still reads the list, so the controls
  // are absent rather than present-and-refusing.
  const canWrite = $derived(session === null || session.permissions.includes("tasks:write"));
  const canAssign = $derived(session === null || session.permissions.includes("tasks:assign"));

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
    showDone = false;
    showCancelled = false;
    reload();
  }

  // The due date as the server takes it: a date needs a zone, a time needs a date, and nothing is
  // inferred. A time with no date is simply not sent.
  function dueOf(dueOn: string, dueAtTime: string) {
    if (dueOn.trim().length === 0) return { dueOn: null, dueAtTime: null, timeZone: null };
    return {
      dueOn,
      dueAtTime: dueAtTime.trim().length === 0 ? null : dueAtTime,
      timeZone: viewerTimeZone(),
    };
  }

  function resetComposer(): void {
    composing = false;
    draftTitle = "";
    draftBody = "";
    draftPriority = "normal";
    draftDueOn = "";
    draftDueAtTime = "";
    draftAssignee = "";
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

  async function saveTask(): Promise<void> {
    if (draftTitle.trim().length === 0) return;
    await runWrite(
      () =>
        createTask(
          fetch,
          {
            matterId,
            title: draftTitle.trim(),
            body: draftBody.trim().length === 0 ? null : draftBody.trim(),
            priority: draftPriority,
            assigneeUserId: draftAssignee === "" ? null : draftAssignee,
            ...dueOf(draftDueOn, draftDueAtTime),
          },
          newWriteKey(),
        ),
      "The task was not created.",
      resetComposer,
    );
  }

  function beginEdit(task: MatterTask): void {
    editingTaskId = task.id;
    editTitle = task.title;
    editBody = task.body ?? "";
    editPriority = task.priority;
    editDueOn = task.dueOn ?? "";
    editDueAtTime = task.dueAtTime ?? "";
  }

  // The edit replaces the task's content fields, so EVERY one it should keep has to travel — an
  // omitted link is a cleared link, not an unchanged one. The form does not offer the three link
  // fields, so they are carried through from the task rather than left out, which would silently
  // drop a "waiting on" the person editing a title never touched.
  async function saveEdit(task: MatterTask): Promise<void> {
    if (editTitle.trim().length === 0) return;
    await runWrite(
      () =>
        editTask(
          fetch,
          task.id,
          {
            title: editTitle.trim(),
            body: editBody.trim().length === 0 ? null : editBody.trim(),
            priority: editPriority,
            blockedByTaskId: task.blockedByTaskId,
            triggerEventId: task.triggerEventId,
            deadlineId: task.deadlineId,
            ...dueOf(editDueOn, editDueAtTime),
          },
          newWriteKey(),
        ),
      "The task was not changed.",
      () => {
        editingTaskId = null;
      },
    );
  }

  async function confirmCancel(): Promise<void> {
    const task = cancelling;
    if (task === null || cancelReason.trim().length === 0) return;
    await runWrite(
      () => cancelTask(fetch, task.id, cancelReason.trim(), newWriteKey()),
      "The task was not cancelled.",
      () => {
        cancelling = null;
        cancelReason = "";
      },
    );
  }

  // What the attach picker may offer: the matter's files, minus the ones this task already carries.
  function attachableFor(task: MatterTask): MatterFile[] {
    const already = new Set(task.documents.map((document) => document.fileId));
    return (matterFiles ?? []).filter((file) => !already.has(file.id));
  }

  // When it is due, as one line. Null where nobody has scheduled it.
  function dueText(task: MatterTask): string | null {
    if (task.dueOn === null) return null;
    if (task.dueAtTime === null) return formatDate(task.dueOn);
    return `${formatDate(task.dueOn)}, ${task.dueAtTime}${
      task.timeZone === null ? "" : ` (${task.timeZone})`
    }`;
  }

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

<section class="flex min-h-0 flex-1 flex-col gap-16">
  <div class="flex flex-wrap items-center justify-between gap-16 border-b border-border-strong pb-8">
    <div class="flex flex-wrap items-center gap-16">
      {#if heading !== undefined}
        <FieldLabel as="h2">
          {heading}
        </FieldLabel>
      {/if}
      <div class="flex items-center gap-12 text-xs">
        <label class="flex items-center gap-4">
          <Checkbox
            checked={showDone}
            disabled={isSample}
            onCheckedChange={(value) => {
              showDone = value === true;
              applyFilters();
            }}
          />
          Done
        </label>
        <label class="flex items-center gap-4">
          <Checkbox
            checked={showCancelled}
            disabled={isSample}
            onCheckedChange={(value) => {
              showCancelled = value === true;
              applyFilters();
            }}
          />
          Cancelled
        </label>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-8">
      <!-- The search, then the create control, then the clear: the same three, in the same order,
           as the docket and the custody register. The search grows toward the inline start as it
           opens, so what follows it never moves. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search tasks"
        placeholder={placeholderOf("Search tasks")}
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        disabled={isSample}
        onsearch={applySearch}
      />
      {#if composing}
        <Button variant="secondary" disabled={saving} onclick={resetComposer}>Cancel</Button>
      {:else if ownNewButton}
        <!-- The one create control, the design system's, so this list reads like every other
             screen. -->
        <CreateControl
          noun="Task"
          title="Add a task, with whose it is and when it is due."
          refusal={isSample
            ? "This is a sample matter. There is no firm record behind it, so nothing can be recorded against it."
            : canWrite
              ? undefined
              : permissionRefusal("Adding a task", "tasks:write")}
          onpress={openNew}
        />
      {/if}
      <!-- Present only while something is narrowing the list, so its absence answers "is anything
           hidden". -->
      {#if narrowed}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Show every task: {narrowingSummary}"
          title={narrowingSummary}
          class="text-accent-default"
          onclick={clearNarrowing}
        >
          <FunnelX class="size-16" aria-hidden="true" />
        </Button>
      {/if}
    </div>
  </div>

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      title="Nothing Changed"
      fallback={writeFailure.fallback}
    />
  {/if}

  {#if composing}
    <!-- Everything the task will carry, generated fields included, so nothing is stored that the
         writer was not shown. -->
    <div class="flex flex-col gap-12 rounded-md border border-border-strong p-16">
      <dl class="flex flex-wrap gap-x-24 gap-y-4 text-xs">
        <div class="flex gap-4">
          <dt class="text-text-muted">Matter</dt>
          <dd>{matterTitle ?? "None — the firm's own work"}</dd>
        </div>
        <div class="flex gap-4">
          <dt class="text-text-muted">Created by</dt>
          <dd>{myName}</dd>
        </div>
      </dl>

      <div class="flex flex-col gap-4">
        <Label for="task-title">What to do</Label>
        <Input id="task-title" bind:value={draftTitle} disabled={saving} />
      </div>

      <div class="flex flex-col gap-4">
        <Label for="task-body">Detail</Label>
        <Textarea id="task-body" bind:value={draftBody} rows={3} disabled={saving} />
      </div>

      <div class="flex flex-wrap items-end gap-16">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="Due"
            value={civilDateValue(draftDueOn)}
            onValueChange={(next) => (draftDueOn = civilDateTextOrEmpty(next))}
            disabled={saving}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="task-due-time">Time</Label>
          <Input
            id="task-due-time"
            type="time"
            bind:value={draftDueAtTime}
            disabled={saving || draftDueOn === ""}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="task-priority">Priority</Label>
          <Select.Root type="single" bind:value={draftPriority} disabled={saving}>
            <Select.Trigger id="task-priority" class="w-128">
              {PRIORITY_LABELS[draftPriority]}
            </Select.Trigger>
            <Select.Content>
              {#each TASK_PRIORITIES as priority (priority)}
                <Select.Item value={priority} label={PRIORITY_LABELS[priority]} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        {#if canAssign}
          <div class="flex flex-col gap-4">
            <Label for="task-assignee">Assign to</Label>
            <Select.Root type="single" bind:value={draftAssignee} disabled={saving}>
              <Select.Trigger id="task-assignee" class="w-192">
                {draftAssignee === "" ? "Nobody yet" : nameOf(draftAssignee)}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="" label="Nobody yet" />
                {#each assignableMembers as member (member.userId)}
                  <Select.Item value={member.userId} label={member.displayName} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
      </div>

      <div class="flex justify-end">
        <Button onclick={saveTask} disabled={saving || draftTitle.trim().length === 0}>
          Create Task
        </Button>
      </div>
    </div>
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
                <Button variant="ghost" title="Edit">
                  <PencilLine aria-hidden="true" />
                </Button>
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
          {@const due = dueText(task)}
          {@const timeLogged = describeTimeLogged(task.timeLogged)}
          <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
            {#if editingTaskId === task.id}
              <div class="flex flex-col gap-4">
                <Label for={`edit-title-${task.id}`}>What to do</Label>
                <Input id={`edit-title-${task.id}`} bind:value={editTitle} disabled={saving} />
              </div>
              <div class="flex flex-col gap-4">
                <Label for={`edit-body-${task.id}`}>Detail</Label>
                <Textarea id={`edit-body-${task.id}`} bind:value={editBody} rows={3} disabled={saving} />
              </div>
              <div class="flex flex-wrap items-end gap-16">
                <div class="flex flex-col gap-4">
                  <DatePicker
                    label="Due"
                    value={civilDateValue(editDueOn)}
                    onValueChange={(next) => (editDueOn = civilDateTextOrEmpty(next))}
                    disabled={saving}
                  />
                </div>
                <div class="flex flex-col gap-4">
                  <Label for={`edit-time-${task.id}`}>Time</Label>
                  <Input
                    id={`edit-time-${task.id}`}
                    type="time"
                    bind:value={editDueAtTime}
                    disabled={saving || editDueOn === ""}
                  />
                </div>
                <div class="flex flex-col gap-4">
                  <Label for={`edit-priority-${task.id}`}>Priority</Label>
                  <Select.Root type="single" bind:value={editPriority} disabled={saving}>
                    <Select.Trigger id={`edit-priority-${task.id}`} class="w-128">
                      {PRIORITY_LABELS[editPriority]}
                    </Select.Trigger>
                    <Select.Content>
                      {#each TASK_PRIORITIES as priority (priority)}
                        <Select.Item value={priority} label={PRIORITY_LABELS[priority]} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              </div>
              <div class="flex justify-end gap-8">
                <Button variant="secondary" disabled={saving} onclick={() => (editingTaskId = null)}>
                  Cancel
                </Button>
                <Button disabled={saving || editTitle.trim().length === 0} onclick={() => saveEdit(task)}>
                  Save
                </Button>
              </div>
            {:else}
              <div class="flex items-start justify-between gap-16">
                <div class="flex min-w-0 flex-col gap-4">
                  <div class="flex flex-wrap items-center gap-8">
                    <span class={task.state === "open" ? "" : "text-text-muted line-through"}>
                      {task.title}
                    </span>
                    {#if task.priority !== "normal"}
                      <Badge variant={task.priority === "urgent" ? "danger" : "neutral"}>
                        {PRIORITY_LABELS[task.priority]}
                      </Badge>
                    {/if}
                    {#if task.state !== "open"}
                      <Badge variant="neutral">{STATE_LABELS[task.state]}</Badge>
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
                    {#if task.state === "cancelled" && task.cancellationReason !== null}
                      <div class="flex gap-4">
                        <dt>Not doing it because</dt>
                        <dd class="text-text">{task.cancellationReason}</dd>
                      </div>
                    {/if}
                  </dl>
                  {#if task.documents.length > 0}
                    <ul class="flex flex-wrap gap-8 text-xs">
                      {#each task.documents as document (document.id)}
                        <li class="flex items-center gap-4">
                          <Paperclip aria-hidden="true" class="size-12 text-text-muted" />
                          <span>{document.fileName}</span>
                          {#if canWrite}
                            <Button
                              variant="ghost"
                              disabled={saving}
                              title="Detach this document — it stays in the matter's files"
                              onclick={() =>
                                runWrite(
                                  () => detachTaskDocument(fetch, document.id, newWriteKey()),
                                  "The document was not detached.",
                                )}
                            >
                              <X aria-hidden="true" />
                            </Button>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>

                {#if canWrite}
                  <!-- Row actions render at rest rather than on hover: a control somebody has to
                       discover by pointing at it is a control most people never find. -->
                  <div class="flex shrink-0 flex-wrap items-center justify-end gap-4">
                    {#if task.state === "open"}
                      <Button
                        variant="secondary"
                        disabled={saving}
                        onclick={() =>
                          runWrite(
                            () => completeTask(fetch, task.id, newWriteKey()),
                            "The task was not completed.",
                          )}
                      >
                        Done
                      </Button>
                    {:else}
                      <Button
                        variant="secondary"
                        disabled={saving}
                        title="Put this task back on the list"
                        onclick={() =>
                          runWrite(
                            () => reopenTask(fetch, task.id, newWriteKey()),
                            "The task was not reopened.",
                          )}
                      >
                        <RotateCcw aria-hidden="true" />
                        Reopen
                      </Button>
                    {/if}
                    <Button variant="ghost" disabled={saving} title="Edit" onclick={() => beginEdit(task)}>
                      <PencilLine aria-hidden="true" />
                    </Button>
                    {#if task.matterId !== null && attachableFor(task).length > 0}
                      <Button
                        variant="ghost"
                        disabled={saving}
                        title="Point at one of the matter's documents"
                        onclick={() =>
                          (attachingTaskId = attachingTaskId === task.id ? null : task.id)}
                      >
                        <Paperclip aria-hidden="true" />
                      </Button>
                    {/if}
                    {#if task.state === "open"}
                      <Button
                        variant="ghost"
                        disabled={saving}
                        title="The firm decided not to do this"
                        onclick={() => {
                          cancelling = task;
                          cancelReason = "";
                        }}
                      >
                        <Ban aria-hidden="true" />
                      </Button>
                    {/if}
                    <Button
                      variant="ghost"
                      disabled={saving}
                      title="Delete — for a task that should not exist"
                      onclick={() =>
                        runWrite(
                          () => deleteTask(fetch, task.id, newWriteKey()),
                          "The task was not deleted.",
                        )}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                {/if}
              </div>

              {#if canAssign && task.state === "open"}
                <div class="flex items-center gap-8 text-xs">
                  <Label for={`assignee-${task.id}`} class="text-text-muted">Assigned to</Label>
                  <Select.Root
                    type="single"
                    value={task.assigneeUserId ?? ""}
                    disabled={saving}
                    onValueChange={(value) =>
                      runWrite(
                        () => reassignTask(fetch, task.id, value === "" ? null : value, newWriteKey()),
                        "The task was not reassigned.",
                      )}
                  >
                    <Select.Trigger id={`assignee-${task.id}`} class="w-192">
                      {nameOf(task.assigneeUserId)}
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="" label="Nobody" />
                      {#each assignableMembers as member (member.userId)}
                        <Select.Item value={member.userId} label={member.displayName} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              {/if}

              {#if attachingTaskId === task.id}
                <div class="flex flex-wrap items-center gap-8 border-t border-border-subtle pt-8">
                  <span class="text-xs text-text-muted">
                    Points at a document the matter already holds. Nothing is uploaded or copied.
                  </span>
                  {#each attachableFor(task) as file (file.id)}
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onclick={() =>
                        runWrite(
                          () => attachTaskDocument(fetch, task.id, file.id, newWriteKey()),
                          "The document was not attached.",
                          () => {
                            attachingTaskId = null;
                          },
                        )}
                    >
                      {file.name}
                    </Button>
                  {/each}
                </div>
              {/if}

              {#if cancelling?.id === task.id}
                <div class="flex flex-col gap-8 border-t border-border-subtle pt-8">
                  <Label for={`cancel-reason-${task.id}`}>
                    Why is the firm not doing this? The decision is the record, so it is required.
                  </Label>
                  <Textarea
                    id={`cancel-reason-${task.id}`}
                    bind:value={cancelReason}
                    rows={2}
                    disabled={saving}
                  />
                  <div class="flex justify-end gap-8">
                    <Button variant="secondary" disabled={saving} onclick={() => (cancelling = null)}>
                      Keep It
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={saving || cancelReason.trim().length === 0}
                      onclick={confirmCancel}
                    >
                      Cancel Task
                    </Button>
                  </div>
                </div>
              {/if}
            {/if}
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
</section>
