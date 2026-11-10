<script lang="ts">
  /*
   * THE task surface. One component, two screens: the matter's Tasks section and the firm's Tasks
   * page. They differ by which matter a new task lands on, whether the rows name their matter, and
   * where the host seats this list's controls, and by nothing else, because a task is one record and
   * a reader moving between the two screens should not have to learn a second layout.
   *
   * EVERYONE SEES EVERY TASK. Me Mode narrows the list to the reader's own work: what is assigned to
   * them (directly or through a team), what they watch, or both.
   *
   * WHAT IS OWED IS THE LIST; WHAT IS FINISHED IS ASKED FOR AT THE FOOT. Completed and archived work
   * is added by two controls below the rows rather than by a filter above them.
   *
   * THE ROW EDITS WHAT A ROW IS FOR. Its status is the coloured pill on the left, which opens the
   * statuses the list's flow allows and Mark Complete at its foot. Start, due and priority change
   * where they are read. Everything else about a task is changed in its window, opened from its
   * title. A due date that has passed on a task still owed is drawn red and never named.
   *
   * SUB-TASKS SIT UNDER THEIR PARENT, at any depth, and fold from the chevron beside the parent's
   * name. The page reads top-level tasks, then every sub-task under the tasks on it; sorting orders
   * siblings among themselves so a sub-task never drifts from the task it belongs to, and a band is
   * chosen by the top of the tree for the same reason.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Popover from "@magna-carta/design-system/popover";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Eye from "@lucide/svelte/icons/eye";
  import Settings from "@lucide/svelte/icons/settings-2";
  import UserRound from "@lucide/svelte/icons/user-round";
  import Columns from "@lucide/svelte/icons/columns-3";
  import SquareCheck from "@lucide/svelte/icons/square-check";
  import Square from "@lucide/svelte/icons/square";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import TaskRecordWindow from "$lib/matters/task-record-window.svelte";
  import TaskArchiveDialog from "$lib/matters/task-archive-dialog.svelte";
  import TaskStatusMenu from "$lib/matters/task-status-menu.svelte";
  import TaskDateField from "$lib/matters/task-date-field.svelte";
  import TaskSettingsDialog from "$lib/matters/task-settings-dialog.svelte";
  import { attachableFoldersFor } from "$lib/matters/record-attachable-documents.ts";
  import { SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import { resolveMatterRecord } from "$lib/matters/matter-record.ts";
  import {
    GROUP_BY_OPTIONS,
    hideableColumns,
    orderTaskRows,
    taskColumns,
    taskGrouping,
    taskRows,
    type TaskColumnContext,
    type TaskGroupBy,
    type TaskRow,
  } from "$lib/matters/task-columns.ts";
  import {
    PRIORITY_LABELS,
    TASK_PRIORITIES,
    editTaskFields,
    isOverdue,
    listTaskLists,
    listTaskTeams,
    moveTaskToStatus,
    readSubtaskTrees,
    setTaskCompletion,
    unarchiveTask,
    newWriteKey,
    type MatterTask,
    type MeMode,
    type TaskListFilters,
    type TaskListSummary,
    type TaskPriority,
    type TaskTeam,
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
  import { todayInUtc } from "$lib/dates";

  interface Props {
    /** What identifies the rows on screen, so a reload is told from a change of subject. */
    subject: string;
    /** Reads one page under the current filters. */
    read: (cursor: string | undefined, filters: TaskListFilters) => Promise<ApiOutcome<Page<MatterTask>>>;
    /** Which matter a new task lands on. Null on the firm's Tasks page: firm work has no matter. */
    matterId: string | null;
    /** Named in the window so nothing is stored the writer was not shown. */
    matterTitle: string | null;
    /** Rows name their matter on a list that spans several. */
    showMatter?: boolean;
    /** A sample matter has no firm behind it and therefore nothing to read. */
    isSample?: boolean;
    /**
     * Whether the list draws its own New Task button. The firm's Tasks page does; a matter's Tasks
     * section does not, because the matter header's create control is that screen's one create
     * button and the page puts openNew() behind it (create-action.svelte.ts).
     */
    ownNewButton?: boolean;
    /** The label leading the control row, where the screen's own header does not already say it. */
    heading?: string;
    /**
     * The band above the list, drawn by the host and handed this list's controls to seat in it. A
     * matter's Tasks section passes nothing and this list draws its own row under its heading.
     */
    screenHeader?: Snippet<[Snippet]>;
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
  }: Props = $props();

  const MANAGE_PERMISSION = "tasks:managePlans";

  const taskList = new PagedList<MatterTask>("The tasks could not be read.");
  const roster = new FirmRoster();

  let session = $state<SessionBootstrap | null>(null);
  let lists = $state<readonly TaskListSummary[]>([]);
  let teams = $state<readonly TaskTeam[]>([]);
  let matterTitles = $state<ReadonlyMap<string, string>>(new Map());
  let matterFiles = $state<MatterFile[] | null>(null);
  let matterFolders = $state<readonly FolderSummary[]>([]);

  /** Every sub-task under the top-level tasks read so far, by id. */
  let subtasks = $state<ReadonlyMap<string, MatterTask>>(new Map());
  /** Tasks whose sub-tasks are folded away. */
  let folded = $state<ReadonlySet<string>>(new Set());

  let showCompleted = $state(false);
  let showArchived = $state(false);
  let meMode = $state<"everyone" | MeMode>("everyone");
  let searchText = $state("");
  let appliedSearch = $state("");

  // THE VIEW: how the rows are laid out, how large, and grouped by what.
  let groupBy = $state<TaskGroupBy>("list");
  let layout = $state<"one" | "two">("one");
  let rowSize = $state<"small" | "medium" | "large">("medium");
  const ROW_SCALE = { small: 0.875, medium: 1, large: 1.25 } as const;

  const ME_MODE_LABELS: Record<MeMode, string> = {
    assigned: "Assigned To Me",
    watching: "Watching",
    both: "Both",
  };

  const readFailure = $derived(taskList.failure);
  const firstReadFailed = $derived(readFailure !== null && (taskList.items?.length ?? 0) === 0);

  const narrowed = $derived(appliedSearch !== "" || meMode !== "everyone");
  const narrowingSummary = $derived(
    [
      appliedSearch === "" ? null : `searching "${appliedSearch}"`,
      meMode === "everyone" ? null : `Me Mode: ${ME_MODE_LABELS[meMode]}`,
    ]
      .filter((part) => part !== null)
      .join(", "),
  );

  const filters = $derived<TaskListFilters>({
    topLevel: true,
    ...(showCompleted ? {} : { completed: false }),
    ...(showArchived ? { includeArchived: true } : {}),
    ...(appliedSearch === "" ? {} : { search: appliedSearch }),
    ...(meMode === "everyone" ? {} : { mine: meMode }),
  });

  /** Opens the window on a new task, for a screen whose create control lives outside this list. */
  export function openNew(): void {
    openWindow(null, null);
  }

  let openTask = $state<MatterTask | null>(null);
  /** The task a NEW task is a sub-task of, while one is being written. */
  let newParent = $state<MatterTask | null>(null);
  let windowOpen = $state(false);
  let windowEditing = $state(false);

  let archiving = $state<MatterTask | null>(null);
  let archivingOpen = $state(false);
  let settingsOpen = $state(false);

  let saving = $state(false);
  let writeFailure = $state<StatedFailure | null>(null);

  let offeredPlans = $state<readonly MatterPlan[] | null>(null);
  let reviewingPlan = $state<MatterPlan | null>(null);

  /** The record named in the address, opened once its row has been read. */
  let entryOpened = $state<string | null>(null);

  $effect(() => {
    if (taskList.showing(subject)) return;
    taskList.reset(subject);
    windowOpen = false;
    openTask = null;
    archivingOpen = false;
    archiving = null;
    searchText = "";
    appliedSearch = "";
    meMode = "everyone";
    showCompleted = false;
    showArchived = false;
    writeFailure = null;
    subtasks = new Map();
    folded = new Set();
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
    readOrganisation();
    reload();
    void roster.load(fetch);
    offeredPlans = null;
    reviewingPlan = null;
    if (matterId !== null) {
      void plansOfferedFor(fetch, matterId).then((outcome) => {
        // A failed plan read never fails the screen: the task list is the point.
        offeredPlans = outcome.kind === "ok" ? outcome.value.data : [];
      });
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

  /** The firm's lists and teams. A failed read leaves the rows standing with plainer labels. */
  function readOrganisation(): void {
    void listTaskLists(fetch).then((outcome) => {
      if (outcome.kind === "ok") lists = outcome.value.data;
    });
    void listTaskTeams(fetch).then((outcome) => {
      if (outcome.kind === "ok") teams = outcome.value.data;
    });
  }

  /** Every sub-task under the given top-level tasks, merged into what is already held. */
  async function readTreesUnder(roots: readonly MatterTask[]): Promise<void> {
    if (roots.length === 0) return;
    const outcome = await readSubtaskTrees(
      fetch,
      roots.map((task) => task.id),
      showArchived,
    );
    if (outcome.kind !== "ok") return;
    const next = new Map(subtasks);
    for (const task of outcome.value.data) next.set(task.id, task);
    subtasks = next;
  }

  function reload(): void {
    taskList.reset(subject);
    subtasks = new Map();
    const current = filters;
    void taskList
      .load((cursor) => read(cursor, current))
      .then(() => readTreesUnder(taskList.items ?? []))
      .then(openEntryOnce);
  }

  function loadMore(): void {
    const current = filters;
    const before = new Set((taskList.items ?? []).map((task) => task.id));
    void taskList
      .loadMore((cursor) => read(cursor, current))
      .then(() => readTreesUnder((taskList.items ?? []).filter((task) => !before.has(task.id))));
  }

  function openEntryOnce(): void {
    const entry = entryFromUrl();
    if (entry === null || entry === entryOpened) return;
    const found = allTasks.find((task) => task.id === entry);
    if (found === undefined) return;
    entryOpened = entry;
    openWindow(found, null);
  }

  function applySearch(query: string): void {
    const term = query.trim();
    if (term === appliedSearch) return;
    appliedSearch = term;
    reload();
  }

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    meMode = "everyone";
    reload();
  }

  /** Every task held: the top-level page and the sub-tasks under it. Completed sub-tasks wait for Show Completed. */
  const allTasks = $derived<MatterTask[]>([
    ...(taskList.items ?? []),
    ...[...subtasks.values()].filter((task) => showCompleted || task.completedAt === null),
  ]);

  // Matter names, read once for each matter the rows name, for the Matter column and its bands.
  const askedMatters = new Set<string>();
  $effect(() => {
    if (!showMatter) return;
    const wanted = [
      ...new Set(allTasks.flatMap((task) => (task.matterId === null ? [] : [task.matterId]))),
    ].filter((id) => !askedMatters.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) askedMatters.add(id);
    void Promise.all(
      wanted.map(async (id) => [id, (await resolveMatterRecord(fetch, id))?.title] as const),
    ).then((resolved) => {
      const next = new Map(matterTitles);
      for (const [id, title] of resolved) if (title !== undefined) next.set(id, title);
      matterTitles = next;
    });
  });

  function nameOf(userId: string | null): string {
    if (userId === null) return "Nobody Yet";
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? "Not recorded";
  }

  const context = $derived<TaskColumnContext>({
    showMatter,
    nameOf,
    teamName: (teamId) => teams.find((team) => team.id === teamId)?.name ?? "A retired team",
    matterTitle: (id) =>
      id === null ? "The Firm's Own Work" : (matterTitles.get(id) ?? "A matter you cannot open"),
    listOf: (listId) => lists.find((list) => list.id === listId),
  });

  const rows = $derived(taskRows(allTasks, folded));
  const columns = $derived(taskColumns(context));
  const today = todayInUtc();

  const grid = DataTable.createDataTableGrid<TaskRow>({
    columns: () => columns,
    rows: () => rows,
    rowKey: (row) => row.task.id,
    // Unsorted: the server's order is what is due next first, and the reader sorts by a header.
    initialSort: { columnId: null, direction: "ascending" },
    itemNoun: { singular: "task", plural: "tasks" },
    orderRows: orderTaskRows,
    grouping: () => taskGrouping(groupBy, rows, context, lists, today),
    onActivate: (row) => openWindow(row.task, null),
  });

  const myName = $derived(session?.user.name ?? "You");
  const canWrite = $derived(session === null || session.permissions.includes("tasks:write"));
  const canAssign = $derived(session === null || session.permissions.includes("tasks:assign"));
  const canManage = $derived(session !== null && session.permissions.includes(MANAGE_PERMISSION));
  const writeRefusal = $derived(
    isSample
      ? SAMPLE_MATTER_REFUSAL
      : canWrite
        ? undefined
        : permissionRefusal("Changing a task", "tasks:write"),
  );

  /** One change made from a row, then the rows read again. */
  async function rowWrite(
    call: () => Promise<ApiOutcome<unknown>>,
    whenRefused: string,
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
    writeFailure = stated(outcome.failure, whenRefused);
  }

  function openWindow(task: MatterTask | null, parent: MatterTask | null): void {
    openTask = task;
    newParent = task === null ? parent : null;
    windowEditing = task === null;
    windowOpen = true;
  }

  /*
   * A write landed: re-read the list, and re-point the window at the row the server now holds, so
   * the window never goes on showing what it was opened with.
   */
  function afterWrite(savedTaskId: string | null): void {
    const current = filters;
    const keepOpenOn = savedTaskId ?? openTask?.id ?? null;
    taskList.reset(subject);
    void taskList
      .load((cursor) => read(cursor, current))
      .then(() => {
        subtasks = new Map();
        return readTreesUnder(taskList.items ?? []);
      })
      .then(() => {
        if (!windowOpen || keepOpenOn === null || openTask === null) return;
        const reread = allTasks.find((candidate) => candidate.id === keepOpenOn);
        if (reread !== undefined && reread.id === openTask.id) openTask = reread;
      });
  }

  function toggleFold(taskId: string): void {
    const next = new Set(folded);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    folded = next;
  }

  const attachableFolders = $derived(attachableFoldersFor(matterFiles ?? [], matterFolders));
  const assignableMembers = $derived(roster.active);
  const childrenOfOpen = $derived(
    openTask === null ? [] : allTasks.filter((task) => task.parentTaskId === openTask?.id),
  );
  const hideable = $derived(hideableColumns(columns));
</script>

{#snippet controls()}
  <ScreenSearch
    bind:value={searchText}
    label="Search tasks"
    searchOn="pause"
    fieldClass="w-2xs sm:w-xs"
    disabled={isSample}
    onsearch={applySearch}
  />
  <!-- ME MODE: the reader's own work. Off, the list is everyone's. -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={buttonClasses({ variant: meMode === "everyone" ? "secondary" : "primary", size: "default" })}
      disabled={isSample}
      aria-pressed={meMode !== "everyone"}
    >
      <UserRound aria-hidden="true" />
      {meMode === "everyone" ? "Me Mode" : ME_MODE_LABELS[meMode]}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.RadioGroup
        value={meMode}
        onValueChange={(value) => {
          meMode = value as "everyone" | MeMode;
          reload();
        }}
      >
        <DropdownMenu.GroupHeading>Me Mode</DropdownMenu.GroupHeading>
        <DropdownMenu.RadioItem value="everyone">Off</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="assigned">Assigned To Me</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="watching">Watching</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="both">Both</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
  <DataTable.GroupByMenu options={GROUP_BY_OPTIONS} bind:value={groupBy} />
  <!-- THE VIEW: one line or two, how large, and which columns. -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger class={buttonClasses({ variant: "secondary", size: "default" })}>
      <Columns aria-hidden="true" />
      View
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.RadioGroup value={layout} onValueChange={(value) => (layout = value as "one" | "two")}>
        <DropdownMenu.GroupHeading>Layout</DropdownMenu.GroupHeading>
        <DropdownMenu.RadioItem value="one">One Line</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="two">Two Lines</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator />
      <DropdownMenu.RadioGroup
        value={rowSize}
        onValueChange={(value) => (rowSize = value as "small" | "medium" | "large")}
      >
        <DropdownMenu.GroupHeading>Row Size</DropdownMenu.GroupHeading>
        <DropdownMenu.RadioItem value="small">Small</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="medium">Medium</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="large">Large</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator />
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>Columns</DropdownMenu.GroupHeading>
        {#each hideable as column (column.id)}
          <DropdownMenu.CheckboxItem
            checked={grid.isColumnVisible(column.id)}
            closeOnSelect={false}
            onCheckedChange={(on) => grid.setColumnVisible(column.id, on === true)}
          >
            {column.label}
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.Group>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
  {#if canManage}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Task Settings"
      title="Task Settings: lists, their statuses, and teams"
      onclick={() => (settingsOpen = true)}
    >
      <Settings aria-hidden="true" />
    </Button>
  {/if}
  {#if ownNewButton}
    <CreateControl
      noun="Task"
      title="Add a task, with whose it is and when it is due."
      refusal={writeRefusal}
      onpress={openNew}
    />
  {/if}
  <DataTable.ClearFilters narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }} />
{/snippet}

{#snippet taskCell({ row, column, text }: DataTable.GridCellContext<TaskRow>)}
  {@const task = row.task}
  {#if column.id === "status"}
    <TaskStatusMenu
      {task}
      list={context.listOf(task.listId)}
      disabled={!canWrite || isSample || saving || task.archivedAt !== null}
      onMove={(statusId) =>
        void rowWrite(() => moveTaskToStatus(fetch, task.id, statusId), "The task was not moved.")}
      onCompletion={(completed) =>
        void rowWrite(
          () => setTaskCompletion(fetch, task.id, completed),
          completed ? "The task was not completed." : "The task was not reopened.",
        )}
    />
  {:else if column.id === "title"}
    <span class="flex min-w-0 items-center gap-4" style={`padding-inline-start: calc(var(--mc-space-16) * ${String(row.depth)})`}>
      {#if row.childCount > 0}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={!folded.has(task.id)}
          aria-label={folded.has(task.id) ? "Show the sub-tasks" : "Fold the sub-tasks away"}
          onclick={(event: MouseEvent) => {
            event.stopPropagation();
            toggleFold(task.id);
          }}
        >
          {#if folded.has(task.id)}
            <ChevronRight aria-hidden="true" />
          {:else}
            <ChevronDown aria-hidden="true" />
          {/if}
        </Button>
      {/if}
      <Button
        variant="ghost"
        class="h-auto min-w-0 justify-start p-0 text-left font-normal hover:underline"
        title="Open this task"
        onclick={() => openWindow(task, null)}
      >
        <span class="truncate" class:text-text-muted={task.completedAt !== null || task.archivedAt !== null}>
          {task.title}
        </span>
      </Button>
      {#if task.body !== null || task.checklist.length > 0}
        {@render preview(task)}
      {/if}
      {#if task.archivedAt !== null}
        <Badge variant="neutral">Archived</Badge>
      {/if}
    </span>
  {:else if column.id === "startsOn"}
    <TaskDateField
      value={task.startsOn}
      label="Start"
      disabled={!canWrite || isSample || saving}
      onchange={(startsOn) =>
        void rowWrite(() => editTaskFields(fetch, task, { startsOn }), "The start date was not changed.")}
    />
  {:else if column.id === "dueOn"}
    <TaskDateField
      value={task.dueOn}
      label="Due"
      past={isOverdue(task)}
      disabled={!canWrite || isSample || saving}
      onchange={(dueOn) =>
        void rowWrite(
          () => editTaskFields(fetch, task, dueOn === null ? { dueOn: null } : { dueOn, dueAtTime: null }),
          "The due date was not changed.",
        )}
    />
  {:else if column.id === "priority"}
    {#if !canWrite || isSample}
      {text}
    {:else}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={`${buttonClasses({ variant: "ghost", size: "sm" })} px-4 font-normal`}
          disabled={saving}
          aria-label={`Priority ${text}. Change it`}
        >
          {text}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          <DropdownMenu.RadioGroup
            value={task.priority}
            onValueChange={(value) =>
              void rowWrite(
                () => editTaskFields(fetch, task, { priority: value as TaskPriority }),
                "The priority was not changed.",
              )}
          >
            {#each TASK_PRIORITIES as priority (priority)}
              <DropdownMenu.RadioItem value={priority}>{PRIORITY_LABELS[priority]}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  {:else if text === ""}
    <span></span>
  {:else}
    <span class="truncate">{text}</span>
  {/if}
{/snippet}

<!-- The hover preview: a task's detail and its checklist, without opening it. -->
{#snippet preview(task: MatterTask)}
  <Popover.Root>
    <Popover.Trigger
      class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
      aria-label="Preview this task"
      title="Preview this task"
    >
      <Eye aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Content class="flex w-80 flex-col gap-8 text-sm">
      <p class="font-semibold">{task.title}</p>
      {#if task.body !== null}
        <p class="whitespace-pre-wrap text-text-muted">{task.body}</p>
      {/if}
      {#if task.checklist.length > 0}
        <ul class="flex flex-col gap-4">
          {#each task.checklist as item (item.id)}
            <li class="flex items-center gap-8">
              {#if item.doneAt === null}
                <Square aria-hidden="true" class="size-12 text-text-muted" />
                <span>{item.text}</span>
              {:else}
                <SquareCheck aria-hidden="true" class="size-12 text-text-muted" />
                <span class="text-text-muted line-through">{item.text}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/snippet}

<!-- The second line, in the Two Lines layout: the task's detail, where it has one. -->
{#snippet rowDetail(row: TaskRow)}
  {#if row.task.body !== null}
    <p
      class="w-full truncate text-xs text-text-muted"
      style={`padding-inline-start: calc(var(--mc-space-16) * ${String(row.depth)})`}
    >
      {row.task.body}
    </p>
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
    <FailureNotice failure={writeFailure.failure} title="Nothing Changed" fallback={writeFailure.fallback} />
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
    <!-- The offer, and it is only ever an offer. Nothing is written until somebody accepts it. -->
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

  {#if firstReadFailed && readFailure !== null}
    <FailureNotice failure={readFailure} title="Tasks Unavailable" fallback="The tasks could not be read." onRetry={reload} />
  {:else}
    {#if readFailure !== null}
      <FailureNotice
        failure={readFailure}
        title="The Rest Of The Tasks Could Not Be Read"
        fallback="The next page of tasks could not be read. What is shown was read and stands."
        onRetry={loadMore}
      />
    {/if}
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption="Tasks"
      cell={taskCell}
      rowDetail={layout === "two" ? rowDetail : undefined}
      scale={ROW_SCALE[rowSize]}
      loading={taskList.items === null}
    />
    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="tasks"
          more={taskList.nextCursor !== null}
          loading={taskList.loadingMore}
          onLoad={loadMore}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}

  <!-- WHAT IS NO LONGER OWED IS ASKED FOR WHERE THE OPEN WORK ENDS. Two questions, not one: a task
       is archived from wherever it stood, complete included. -->
  {#if taskList.items !== null && !firstReadFailed && !isSample}
    <div class="flex flex-wrap items-center justify-center gap-8 border-t border-border-subtle pt-12">
      <Button
        variant="ghost"
        size="sm"
        class={showCompleted ? "text-accent-default" : "text-text-muted"}
        onclick={() => {
          showCompleted = !showCompleted;
          reload();
        }}
      >
        {showCompleted ? "Hide Completed" : "Show Completed"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class={showArchived ? "text-accent-default" : "text-text-muted"}
        onclick={() => {
          showArchived = !showArchived;
          reload();
        }}
      >
        {showArchived ? "Hide Archived" : "Show Archived"}
      </Button>
    </div>
  {/if}
</section>

<TaskRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  task={openTask}
  parent={newParent}
  subtasks={childrenOfOpen}
  {lists}
  {teams}
  {matterId}
  {matterTitle}
  matterTitleOf={context.matterTitle}
  authorName={myName}
  {nameOf}
  {assignableMembers}
  {attachableFolders}
  matterFiles={matterFiles ?? []}
  {writeRefusal}
  {canAssign}
  onSaved={afterWrite}
  onOpenTask={(task) => openWindow(task, null)}
  onNewSubtask={(parent) => openWindow(null, parent)}
  onUnarchive={(task) =>
    void rowWrite(() => unarchiveTask(fetch, task.id, newWriteKey()), "The task was not put back.")}
  onArchive={(subject) => {
    archiving = subject;
    archivingOpen = true;
  }}
/>

<TaskArchiveDialog
  bind:open={archivingOpen}
  task={archiving}
  onArchived={() => {
    if (archiving !== null) afterWrite(archiving.id);
  }}
/>

{#if canManage}
  <TaskSettingsDialog
    bind:open={settingsOpen}
    {lists}
    {teams}
    members={assignableMembers}
    onChanged={() => {
      readOrganisation();
      afterWrite(null);
    }}
  />
{/if}
