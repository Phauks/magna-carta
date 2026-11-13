<script lang="ts">
  /*
   * A task, opened.
   *
   * ITS FIELDS ARE EDITED WHERE THEY ARE READ. There is no Edit button: the title, the detail, the
   * dates, the priority, the location, the people, the checklist and the links each change in
   * place, and each change is its own small write. A form over a dozen facts would lose all of them
   * to one refused write, and a mode to enter before changing one of them is a door to nowhere.
   *
   * A NEW TASK IS THIS SAME WINDOW WITH NOTHING IN IT YET, and it keeps its Save: there is no task
   * yet to save a field onto. Every field it will carry is on screen while it is written, the
   * generated ones included, so nothing is stored that the writer was not shown. Its checklist,
   * links and sub-tasks are added once it exists.
   *
   * WHERE IT STANDS sits in the action bar: the status dropdown beside Mark Complete, because
   * finishing is not a status and completing a task leaves its status where it stood. The rare acts
   * (Duplicate, Archive, Delete) are in the "..." menu beside Print.
   *
   * A SUB-TASK shares its parent's list and matter, so neither is offered on one. Sub-tasks are
   * listed in their own section, each with its own status, and open in this same window.
   *
   * WHAT IS STATED AND NEVER EDITED is the part the task did not get by being typed: who wrote it and
   * when, the time logged against it, the systems it is mirrored into, and what became of it.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Badge from "@magna-carta/design-system/badge";
  import * as Select from "@magna-carta/design-system/select";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordAttachments, {
    ATTACHMENTS_TAB_KEY,
    unattachedDocumentFolders,
    type AttachableDocument,
    type AttachableDocumentFolder,
    type RecordAttachment,
  } from "@magna-carta/design-system/record-attachments";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import Archive from "@lucide/svelte/icons/archive";
  import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Copy from "@lucide/svelte/icons/copy";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import Video from "@lucide/svelte/icons/video";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import {
    isPendingAttachment,
    pendingAttachmentsOf,
    recordAttachmentsOf,
  } from "./record-attachable-documents.ts";
  import { taskSheet } from "./task-print-sheet.ts";
  import TaskStatusMenu from "./task-status-menu.svelte";
  import TaskPeopleMenu from "./task-people-menu.svelte";
  import TaskDateField from "./task-date-field.svelte";
  import { assigneeInputs, statusOf } from "./task-columns.ts";
  import {
    PRIORITY_LABELS,
    TASK_PRIORITIES,
    addChecklistItem,
    addTaskLink,
    attachTaskDocument,
    createTask,
    deleteTask,
    describeTimeLogged,
    detachTaskDocument,
    editTaskFields,
    externalSystemLabel,
    isOverdue,
    moveTaskToList,
    moveTaskToStatus,
    newWriteKey,
    removeChecklistItem,
    removeTaskLink,
    setTaskAssignees,
    setTaskCompletion,
    setTaskRecurrence,
    setTaskWatchers,
    updateChecklistItem,
    viewerTimeZone,
    type AssigneeInput,
    type MatterTask,
    type TaskListSummary,
    type TaskPriority,
    type TaskRecurrenceMode,
    type TaskTeam,
  } from "./tasks-api.ts";
  import { formatRecurrence, type RecurrenceRule } from "@magna-carta/civil-time/recurrence";
  import TaskRepeatField from "./task-repeat-field.svelte";
  import TaskComments from "./task-comments.svelte";
  import { storedRule } from "./task-recurrence.ts";

  let {
    open = $bindable(false),
    task = null,
    editing = $bindable(false),
    parent = null,
    subtasks = [],
    lists = [],
    teams = [],
    matterId,
    matterTitle,
    matterTitleOf,
    authorName,
    viewerUserId = null,
    nameOf,
    assignableMembers = [],
    attachableFolders = [],
    matterFiles = [],
    writeRefusal,
    canAssign,
    onSaved,
    onOpenTask,
    onNewSubtask,
    onUnarchive,
    onAttachmentsUnwritten,
    onArchive,
  }: {
    open?: boolean;
    /** The task being read, or null while a new one is being written. */
    task?: MatterTask | null;
    /** Raised while a NEW task is written; an existing task is edited in place and never enters it. */
    editing?: boolean;
    /** The task a NEW task is a sub-task of. It takes that task's list and matter. */
    parent?: MatterTask | null;
    /** The open task's sub-tasks, from the rows already read. */
    subtasks?: readonly MatterTask[];
    lists?: readonly TaskListSummary[];
    teams?: readonly TaskTeam[];
    /** Which matter a NEW top-level task lands on. Null on the firm's Tasks page. */
    matterId: string | null;
    /** The matter's name on a matter's own Tasks section. */
    matterTitle: string | null;
    /** A matter's name from its identifier, for a task whose matter the screen did not name. */
    matterTitleOf?: (matterId: string | null) => string;
    /** Whose name goes on a task written here. Stated, never chosen: the writer is the author. */
    authorName: string;
    /** Who is reading, so their own comments offer Edit and Delete. */
    viewerUserId?: string | null;
    nameOf: (userId: string | null) => string;
    assignableMembers?: readonly FirmMemberSummary[];
    attachableFolders?: readonly AttachableDocumentFolder[];
    matterFiles?: readonly MatterFile[];
    /** Why nothing here can be written, or undefined where writing is allowed. */
    writeRefusal?: string;
    /** Whether it may assign anybody but the writer, or a team. Its own permission. */
    canAssign: boolean;
    /** A write landed: the surface re-reads what the server now holds. */
    onSaved: (savedTaskId: string) => void;
    onOpenTask: (task: MatterTask) => void;
    onNewSubtask: (parent: MatterTask) => void;
    onUnarchive: (task: MatterTask) => void;
    onAttachmentsUnwritten?: (names: readonly string[]) => void;
    onArchive: (subject: MatterTask) => void;
  } = $props();

  const creating = $derived(task === null);

  // A NEW task's fields. An existing task is read straight from the record and written field by field.
  let titleText = $state("");
  let bodyText = $state("");
  let priority = $state<TaskPriority>("normal");
  let startsOn = $state<string | null>(null);
  let dueOn = $state<string | null>(null);
  let dueAtTimeText = $state("");
  let locationText = $state("");
  let listId = $state("");
  let statusId = $state("");
  let assignees = $state<AssigneeInput[]>([]);
  let watcherUserIds = $state<string[]>([]);
  let pendingFileIds = $state<string[]>([]);

  // How the task repeats. On a new task this is part of the draft; on an existing one it is a draft
  // of its own, saved by its own button, because a rule is four answers and writing after each
  // would make three copies of a rule nobody chose.
  let repeatRule = $state<RecurrenceRule | null>(null);
  let repeatMode = $state<TaskRecurrenceMode>("completed");
  // A due date moved on a repeating task waits here until the reader says how far the move goes.
  let pendingDueOn = $state<string | null | undefined>(undefined);

  let newChecklistText = $state("");
  let newLinkUrl = $state("");
  let newLinkLabel = $state("");

  let commentCount = $state(0);
  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  let printOpen = $state(false);

  let createdPreview = $state(new Date().toISOString());
  $effect(() => {
    if (!open || task !== null) return;
    const tick = setInterval(() => {
      createdPreview = new Date().toISOString();
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  });

  const defaultList = $derived(lists.find((list) => list.isDefault) ?? lists[0]);

  /*
   * A new task's fields are seeded when the window opens on one, and never while it is being written.
   */
  let seededFor = $state<string | null>(null);
  $effect(() => {
    const identity = task === null ? `new:${parent?.id ?? ""}` : task.id;
    if (!open) {
      seededFor = null;
      return;
    }
    if (seededFor === identity) return;
    seededFor = identity;
    saveFailure = null;
    newChecklistText = "";
    newLinkUrl = "";
    newLinkLabel = "";
    pendingDueOn = undefined;
    repeatRule = storedRule(task?.recurrence?.rule);
    repeatMode = task?.recurrence?.mode ?? "completed";
    if (task !== null) return;
    createdPreview = new Date().toISOString();
    titleText = "";
    bodyText = "";
    priority = "normal";
    startsOn = null;
    dueOn = null;
    dueAtTimeText = "";
    locationText = "";
    listId = parent?.listId ?? defaultList?.id ?? "";
    const list = lists.find((candidate) => candidate.id === listId);
    statusId = list?.statuses[0]?.id ?? "";
    assignees = [];
    watcherUserIds = [];
    pendingFileIds = [];
  });

  const unsavedChanges = $derived(
    creating &&
      (titleText !== "" ||
        bodyText !== "" ||
        startsOn !== null ||
        dueOn !== null ||
        locationText !== "" ||
        assignees.length > 0 ||
        watcherUserIds.length > 0 ||
        pendingFileIds.length > 0),
  );

  function abandon(): void {
    saveFailure = null;
    open = false;
  }

  const heading = $derived(creating ? (parent === null ? "New Task" : "New Sub-Task") : "Task");
  const taskMatterId = $derived(task?.matterId ?? parent?.matterId ?? matterId);
  const subtitleText = $derived(
    taskMatterId === matterId && matterTitle !== null
      ? matterTitle
      : (matterTitleOf?.(taskMatterId) ??
          (taskMatterId === null ? "The firm's own work, on no matter" : "A matter")),
  );

  const attachments = $derived<readonly RecordAttachment[]>(
    task === null
      ? pendingAttachmentsOf(pendingFileIds, matterFiles)
      : recordAttachmentsOf(task.documents, nameOf),
  );
  const offerable = $derived(unattachedDocumentFolders(attachableFolders, attachments));
  const documentSourceRefusal = $derived(
    taskMatterId === null
      ? "This task belongs to no matter, and every document in Magna Carta belongs to one."
      : taskMatterId !== matterId
        ? "Open this task from its matter to attach that matter's files."
        : attachableFolders.length === 0
          ? "This matter holds no files to point at yet."
          : undefined,
  );

  /** Whether the repeat being edited differs from the one the task has. */
  const repeatChanged = $derived(
    task !== null &&
      ((repeatRule === null ? null : formatRecurrence(repeatRule)) !== (task.recurrence?.rule ?? null) ||
        (repeatRule !== null && repeatMode !== (task.recurrence?.mode ?? "completed"))),
  );

  const taskList = $derived(task === null ? undefined : lists.find((list) => list.id === task.listId));
  const newList = $derived(lists.find((list) => list.id === listId));
  const timeLogged = $derived(task === null ? null : describeTimeLogged(task.timeLogged));
  const canWrite = $derived(writeRefusal === undefined);
  const fieldsLocked = $derived(!canWrite || saving || (task !== null && task.archivedAt !== null));

  const chosenAssignees = $derived<readonly AssigneeInput[]>(
    task === null ? assignees : assigneeInputs(task),
  );
  const chosenWatchers = $derived<readonly string[]>(task === null ? watcherUserIds : task.watcherUserIds);

  function personOrTeam(entry: AssigneeInput): string {
    return "teamId" in entry
      ? (teams.find((team) => team.id === entry.teamId)?.name ?? "A retired team")
      : nameOf(entry.userId);
  }

  const assigneeText = $derived(
    chosenAssignees.length === 0 ? "Nobody Yet" : chosenAssignees.map(personOrTeam).join(", "),
  );

  const saveRefusal = $derived(
    writeRefusal ??
      (titleText.trim() === ""
        ? "A task says what is to be done. Write that first."
        : saving
          ? "Saving."
          : undefined),
  );

  /** A location that is a web address is a meeting link, and gets a Join button. */
  function meetingLink(location: string | null): string | null {
    if (location === null) return null;
    try {
      const url = new URL(location.trim());
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  const sheet = $derived(
    task === null
      ? null
      : taskSheet(task, {
          matterTitle: subtitleText,
          assigneeName: assigneeText,
          statusName: statusOf(task, taskList)?.name ?? "No Status",
          authorName: nameOf(task.createdBy),
          completedByName: task.completedBy === null ? null : nameOf(task.completedBy),
          archivedByName: task.archivedBy === null ? null : nameOf(task.archivedBy),
          instant: (at) => formatInstant(at),
          ...printSheetDates(),
          attachedNames: task.documents.map((document) => document.fileName),
          printedAt: formatInstant(new Date()),
        }),
  );

  async function save(): Promise<void> {
    if (saveRefusal !== undefined || task !== null) return;
    saving = true;
    saveFailure = null;
    const written = await createTask(
      fetch,
      {
        matterId: parent?.matterId ?? matterId,
        title: titleText.trim(),
        body: bodyText.trim() === "" ? null : bodyText.trim(),
        priority,
        startsOn,
        location: locationText.trim() === "" ? null : locationText.trim(),
        dueOn,
        dueAtTime: dueOn === null || dueAtTimeText.trim() === "" ? null : dueAtTimeText,
        timeZone: dueOn === null ? null : viewerTimeZone(),
        ...(parent === null ? { listId: listId === "" ? null : listId } : { parentTaskId: parent.id }),
        ...(statusId === "" ? {} : { statusId }),
        assignees,
        watcherUserIds,
      },
      newWriteKey(),
    );
    if (written.kind !== "ok") {
      saving = false;
      saveFailure = stated(written.failure, "The task was not created.");
      return;
    }
    // The repeat is set on the task that now exists; a refusal leaves the task, said as such.
    if (repeatRule !== null && dueOn !== null && parent === null) {
      const repeated = await setTaskRecurrence(
        fetch,
        written.value.id,
        formatRecurrence(repeatRule),
        repeatMode,
      );
      if (repeated.kind !== "ok") {
        saving = false;
        editing = false;
        onSaved(written.value.id);
        saveFailure = stated(repeated.failure, "The task was created, but it was not set to repeat.");
        return;
      }
    }
    // The task exists now, so a failure from here is a different one: a document not attached.
    const attachedOutcomes = await Promise.all(
      pendingFileIds.map((fileId) => attachTaskDocument(fetch, written.value.id, fileId, newWriteKey())),
    );
    const unattached = pendingFileIds.filter((_, index) => attachedOutcomes[index]?.kind !== "ok");
    saving = false;
    pendingFileIds = [];
    editing = false;
    open = false;
    onSaved(written.value.id);
    if (unattached.length > 0) {
      onAttachmentsUnwritten?.(
        unattached.map((fileId) => matterFiles.find((file) => file.id === fileId)?.name ?? fileId),
      );
    }
  }

  /** One change to the open task, with its own words for what did not happen. */
  async function act(
    call: (subject: MatterTask) => Promise<ApiOutcome<unknown>>,
    whenRefused: string,
    closes = false,
  ): Promise<void> {
    const subject = task;
    if (subject === null || saving || !canWrite) return;
    saving = true;
    saveFailure = null;
    const outcome = await call(subject);
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure = stated(outcome.failure, whenRefused);
      return;
    }
    if (closes) open = false;
    onSaved(subject.id);
  }

  /** A copy of the task, with its people, checklist and links, on the same list and matter. */
  async function duplicate(): Promise<void> {
    await act(async (subject) => {
      const copied = await createTask(
        fetch,
        {
          matterId: subject.matterId,
          title: `${subject.title} (Copy)`,
          body: subject.body,
          priority: subject.priority,
          startsOn: subject.startsOn,
          location: subject.location,
          dueOn: subject.dueOn,
          dueAtTime: subject.dueAtTime,
          timeZone: subject.timeZone,
          ...(subject.parentTaskId === null
            ? { listId: subject.listId }
            : { parentTaskId: subject.parentTaskId }),
          ...(subject.statusId === null ? {} : { statusId: subject.statusId }),
          assignees: assigneeInputs(subject),
          watcherUserIds: subject.watcherUserIds,
        },
        newWriteKey(),
      );
      if (copied.kind !== "ok") return copied;
      // The checklist in its own order, one after another, since the order is the list's meaning.
      const parts = await subject.checklist.reduce<Promise<ApiOutcome<unknown>>>(
        async (previous, item) => {
          const before = await previous;
          return before.kind === "ok" ? addChecklistItem(fetch, copied.value.id, item.text) : before;
        },
        Promise.resolve(copied),
      );
      if (parts.kind !== "ok") return parts;
      const links = await Promise.all(
        subject.links.map((link) => addTaskLink(fetch, copied.value.id, { url: link.url, label: link.label })),
      );
      return links.find((outcome) => outcome.kind !== "ok") ?? copied;
    }, "The task was not duplicated.");
  }

  async function attachExisting(document: AttachableDocument): Promise<void> {
    if (!canWrite || saving) return;
    if (task === null) {
      pendingFileIds = [...pendingFileIds, document.identifier];
      return;
    }
    await act(
      (subject) => attachTaskDocument(fetch, subject.id, document.identifier, newWriteKey()),
      "The document was not attached.",
    );
  }

  async function detach(attachment: RecordAttachment): Promise<void> {
    if (!canWrite || saving) return;
    if (isPendingAttachment(attachment)) {
      pendingFileIds = pendingFileIds.filter((fileId) => fileId !== attachment.documentIdentifier);
      return;
    }
    await act(
      () => detachTaskDocument(fetch, attachment.identifier, newWriteKey()),
      "The document was not detached.",
    );
  }

  function changeAssignees(next: AssigneeInput[]): void {
    if (task === null) assignees = next;
    else void act((subject) => setTaskAssignees(fetch, subject.id, next), "The assignees were not changed.");
  }

  function changeWatchers(next: AssigneeInput[]): void {
    const userIds = next.flatMap((entry) => ("userId" in entry ? [entry.userId] : []));
    if (task === null) watcherUserIds = userIds;
    else void act((subject) => setTaskWatchers(fetch, subject.id, userIds), "The watchers were not changed.");
  }

  // Without the assigning permission a member may name only themselves, so the menus offer that.
  const offeredMembers = $derived(canAssign ? assignableMembers : []);
</script>

{#snippet subtitle()}
  <span>{subtitleText}</span>
{/snippet}

{#snippet record()}
  <div class="@container flex flex-col gap-16">
    {#if saveFailure !== null}
      <FailureNotice
        failure={saveFailure.failure}
        title={creating ? "Not Saved" : "Nothing Changed"}
        fallback={saveFailure.fallback}
      />
    {/if}

    <dl class="grid gap-x-24 gap-y-8 @md:grid-cols-3">
      <div class="flex flex-col gap-4">
        <dt class="text-xs text-text-muted">Matter</dt>
        <dd class="text-sm">{subtitleText}</dd>
      </div>
      <div class="flex flex-col gap-4">
        <dt class="text-xs text-text-muted">Created By</dt>
        <dd class="text-sm">{task === null ? authorName : nameOf(task.createdBy)}</dd>
      </div>
      <div class="flex flex-col gap-4">
        <dt class="text-xs text-text-muted">Created</dt>
        <dd class="text-sm">
          {#if task === null}
            <time datetime={instantAttribute(createdPreview)}>{formatInstant(createdPreview)}</time>
          {:else}
            <time datetime={instantAttribute(task.createdAt)}>{formatInstant(task.createdAt)}</time>
          {/if}
        </dd>
      </div>
    </dl>

    {#if task !== null && (task.archivedAt !== null || task.completedAt !== null)}
      <div class="flex flex-wrap items-center gap-8">
        {#if task.completedAt !== null}
          <Badge variant="neutral">Complete</Badge>
        {/if}
        {#if task.archivedAt !== null}
          <Badge variant="neutral">Archived</Badge>
        {/if}
      </div>
    {/if}

    <div class="flex flex-col gap-4">
      <Label for="task-title">Task</Label>
      {#if task === null}
        <Input id="task-title" disabled={saving} bind:value={titleText} />
      {:else}
        <Input
          id="task-title"
          value={task.title}
          disabled={fieldsLocked}
          onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
            const title = event.currentTarget.value.trim();
            if (title === "" || title === task?.title) return;
            void act((subject) => editTaskFields(fetch, subject, { title }), "The title was not changed.");
          }}
        />
      {/if}
    </div>

    <div class="flex flex-col gap-4">
      <Label for="task-body">Detail</Label>
      {#if task === null}
        <Textarea id="task-body" rows={4} disabled={saving} bind:value={bodyText} />
      {:else}
        <Textarea
          id="task-body"
          rows={4}
          value={task.body ?? ""}
          disabled={fieldsLocked}
          onchange={(event: Event & { currentTarget: HTMLTextAreaElement }) => {
            const body = event.currentTarget.value.trim();
            if (body === (task?.body ?? "")) return;
            void act(
              (subject) => editTaskFields(fetch, subject, { body: body === "" ? null : body }),
              "The detail was not changed.",
            );
          }}
        />
      {/if}
    </div>

    <div class="grid grid-cols-2 gap-12 @md:grid-cols-4">
      <div class="flex flex-col gap-4">
        <span class="text-xs text-text-muted">Start</span>
        <TaskDateField
          value={task === null ? startsOn : task.startsOn}
          label="Start"
          disabled={fieldsLocked}
          onchange={(next) => {
            if (task === null) startsOn = next;
            else void act((subject) => editTaskFields(fetch, subject, { startsOn: next }), "The start date was not changed.");
          }}
        />
      </div>
      <div class="flex flex-col gap-4">
        <span class="text-xs text-text-muted">Due</span>
        <TaskDateField
          value={task === null ? dueOn : task.dueOn}
          label="Due"
          past={task !== null && isOverdue(task)}
          disabled={fieldsLocked}
          onchange={(next) => {
            if (task === null) dueOn = next;
            // A repeating task asks how far a moved date goes; taking the date off is refused by
            // the server with its own reason, so it is sent as it is.
            else if (task.recurrence !== null && next !== null && next !== task.dueOn) pendingDueOn = next;
            else void act((subject) => editTaskFields(fetch, subject, { dueOn: next }), "The due date was not changed.");
          }}
        />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="task-due-time">Time</Label>
        {#if task === null}
          <Input id="task-due-time" type="time" disabled={saving || dueOn === null} bind:value={dueAtTimeText} />
        {:else}
          <Input
            id="task-due-time"
            type="time"
            value={task.dueAtTime ?? ""}
            disabled={fieldsLocked || task.dueOn === null}
            onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
              const time = event.currentTarget.value;
              void act(
                (subject) => editTaskFields(fetch, subject, { dueAtTime: time === "" ? null : time }),
                "The due time was not changed.",
              );
            }}
          />
        {/if}
      </div>
      <div class="flex flex-col gap-4">
        <Label for="task-priority">Priority</Label>
        <Select.Root
          type="single"
          value={task === null ? priority : task.priority}
          disabled={fieldsLocked}
          onValueChange={(value) => {
            const next = value as TaskPriority;
            if (task === null) priority = next;
            else if (next !== task.priority)
              void act((subject) => editTaskFields(fetch, subject, { priority: next }), "The priority was not changed.");
          }}
        >
          <Select.Trigger id="task-priority">{PRIORITY_LABELS[task === null ? priority : task.priority]}</Select.Trigger>
          <Select.Content>
            {#each TASK_PRIORITIES as candidate (candidate)}
              <Select.Item value={candidate} label={PRIORITY_LABELS[candidate]} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>

    {#if task !== null && pendingDueOn !== undefined}
      <!-- A moved due date on a repeating task: this copy alone, or the series with it. -->
      <div class="flex flex-wrap items-center gap-8 rounded-md bg-surface-sunken p-8" role="group" aria-label="Change the due date for">
        <span class="text-sm">Change the due date for</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={fieldsLocked}
          onclick={() => {
            const next = pendingDueOn ?? null;
            pendingDueOn = undefined;
            void act(
              (subject) => editTaskFields(fetch, subject, { dueOn: next, recurrenceScope: "this" }),
              "The due date was not changed.",
            );
          }}>This Task Only</Button
        >
        <Button
          size="sm"
          variant="secondary"
          disabled={fieldsLocked}
          onclick={() => {
            const next = pendingDueOn ?? null;
            pendingDueOn = undefined;
            void act(
              (subject) => editTaskFields(fetch, subject, { dueOn: next, recurrenceScope: "later" }),
              "The due date was not changed.",
            );
          }}>This And Later Ones</Button
        >
        <Button size="sm" variant="ghost" onclick={() => (pendingDueOn = undefined)}>Cancel</Button>
      </div>
    {/if}

    {#if (task === null && parent === null) || (task !== null && task.parentTaskId === null)}
      <!-- Whether the task repeats. A sub-task repeats with its parent, so it is not asked here. -->
      <div class="flex flex-col gap-8">
        <TaskRepeatField
          bind:rule={repeatRule}
          bind:mode={repeatMode}
          dueOn={task === null ? dueOn : task.dueOn}
          startsOn={task === null ? startsOn : task.startsOn}
          occurrenceOn={task?.recurrence?.occurrenceOn ?? null}
          unreadable={task !== null && task.recurrence !== null && storedRule(task.recurrence.rule) === null}
          disabled={fieldsLocked}
        />
        {#if task !== null && repeatChanged}
          <div class="flex gap-8">
            <Button
              size="sm"
              disabled={fieldsLocked}
              onclick={() =>
                void act(
                  (subject) =>
                    setTaskRecurrence(
                      fetch,
                      subject.id,
                      repeatRule === null ? null : formatRecurrence(repeatRule),
                      repeatMode,
                    ),
                  "The repeat was not changed.",
                )}>Save Repeat</Button
            >
            <Button
              size="sm"
              variant="ghost"
              onclick={() => {
                repeatRule = storedRule(task?.recurrence?.rule);
                repeatMode = task?.recurrence?.mode ?? "completed";
              }}>Discard</Button
            >
          </div>
        {/if}
      </div>
    {/if}

    <!-- The list, and on a new task the status it starts at. A sub-task shares its parent's list. -->
    {#if (task === null && parent === null) || (task !== null && task.parentTaskId === null)}
      <div class="grid grid-cols-2 gap-12">
        <div class="flex flex-col gap-4">
          <Label for="task-list">List</Label>
          <Select.Root
            type="single"
            value={task === null ? listId : (task.listId ?? "")}
            disabled={fieldsLocked}
            onValueChange={(value) => {
              if (task === null) {
                listId = value;
                statusId = lists.find((list) => list.id === value)?.statuses[0]?.id ?? "";
              } else if (value !== task.listId) {
                void act((subject) => moveTaskToList(fetch, subject.id, value), "The task was not moved to that list.");
              }
            }}
          >
            <Select.Trigger id="task-list">
              {(task === null ? newList : taskList)?.name ?? "Choose a list"}
            </Select.Trigger>
            <Select.Content>
              {#each lists as list (list.id)}
                <Select.Item value={list.id} label={list.name} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        {#if task === null}
          <div class="flex flex-col gap-4">
            <Label for="task-status">Status</Label>
            <Select.Root type="single" bind:value={statusId} disabled={saving}>
              <Select.Trigger id="task-status">
                {newList?.statuses.find((status) => status.id === statusId)?.name ?? "Choose a status"}
              </Select.Trigger>
              <Select.Content>
                {#each newList?.statuses ?? [] as status (status.id)}
                  <Select.Item value={status.id} label={status.name} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
      </div>
    {/if}

    <!-- PEOPLE: who does the work, and who is kept informed of it. -->
    <section class="flex flex-col gap-8">
      <h3 class="text-sm font-semibold">People</h3>
      <div class="flex flex-wrap items-center gap-8">
        <TaskPeopleMenu
          label="Assigned To"
          chosen={chosenAssignees}
          members={offeredMembers}
          teams={canAssign ? teams : []}
          disabled={fieldsLocked || !canAssign}
          disabledReason={canAssign ? writeRefusal : permissionRefusal("Assigning work to others", "tasks:assign")}
          onchange={changeAssignees}
        />
        <span class="text-sm">{assigneeText}</span>
      </div>
      <div class="flex flex-wrap items-center gap-8">
        <TaskPeopleMenu
          label="Watchers"
          chosen={chosenWatchers.map((userId) => ({ userId }))}
          members={offeredMembers}
          disabled={fieldsLocked || !canAssign}
          disabledReason={canAssign ? writeRefusal : permissionRefusal("Adding watchers", "tasks:assign")}
          onchange={changeWatchers}
        />
        <span class="text-sm">
          {chosenWatchers.length === 0 ? "Nobody" : chosenWatchers.map((userId) => nameOf(userId)).join(", ")}
        </span>
      </div>
    </section>

    <!-- LOCATION: a room, an address, or a meeting link, which gets a Join button. -->
    <section class="flex flex-col gap-4">
      <Label for="task-location">Location</Label>
      <div class="flex items-center gap-8">
        {#if task === null}
          <Input id="task-location" class="flex-1" disabled={saving} bind:value={locationText} />
        {:else}
          <Input
            id="task-location"
            class="flex-1"
            value={task.location ?? ""}
            disabled={fieldsLocked}
            onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
              const location = event.currentTarget.value.trim();
              if (location === (task?.location ?? "")) return;
              void act(
                (subject) => editTaskFields(fetch, subject, { location: location === "" ? null : location }),
                "The location was not changed.",
              );
            }}
          />
        {/if}
        {#if meetingLink(task === null ? locationText : task.location) !== null}
          <a
            class={buttonClasses({ variant: "secondary", size: "default" })}
            href={meetingLink(task === null ? locationText : task.location)}
            {...opensBeside("external")}
          >
            <Video aria-hidden="true" />
            Join
          </a>
        {/if}
      </div>
    </section>

    {#if task !== null}
      <!-- CHECKLIST: the steps inside the task, each ticked off on its own. -->
      <section class="flex flex-col gap-8">
        <h3 class="text-sm font-semibold">Checklist</h3>
        <ul class="flex flex-col gap-4">
          {#each task.checklist as item (item.id)}
            <li class="flex items-center gap-8">
              <Checkbox
                checked={item.doneAt !== null}
                disabled={fieldsLocked}
                aria-label={item.text}
                onCheckedChange={(on) =>
                  void act(() => updateChecklistItem(fetch, item.id, { done: on === true }), "The checklist was not changed.")}
              />
              <span class="flex-1 text-sm" class:line-through={item.doneAt !== null} class:text-text-muted={item.doneAt !== null}>
                {item.text}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={fieldsLocked}
                aria-label={`Remove ${item.text}`}
                onclick={() => void act(() => removeChecklistItem(fetch, item.id), "The checklist item was not removed.")}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          {/each}
        </ul>
        <form
          class="flex items-center gap-8"
          onsubmit={(event) => {
            event.preventDefault();
            const text = newChecklistText.trim();
            if (text === "") return;
            void act((subject) => addChecklistItem(fetch, subject.id, text), "The checklist item was not added.").then(
              () => (newChecklistText = ""),
            );
          }}
        >
          <Input class="flex-1" aria-label="New checklist item" bind:value={newChecklistText} disabled={fieldsLocked} />
          <Button type="submit" variant="secondary" disabled={fieldsLocked || newChecklistText.trim() === ""}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </form>
      </section>

      <!-- SUB-TASKS: each with its own status, opened in this same window. -->
      <section class="flex flex-col gap-8">
        <h3 class="text-sm font-semibold">Sub-Tasks</h3>
        <ul class="flex flex-col gap-4">
          {#each subtasks as subtask (subtask.id)}
            <li class="flex items-center gap-8">
              <TaskStatusMenu
                task={subtask}
                list={lists.find((list) => list.id === subtask.listId)}
                disabled={!canWrite || saving}
                onMove={(next) => void act(() => moveTaskToStatus(fetch, subtask.id, next), "The sub-task was not moved.")}
                onCompletion={(completed) =>
                  void act(() => setTaskCompletion(fetch, subtask.id, completed), "The sub-task was not changed.")}
              />
              <Button
                variant="ghost"
                class="h-auto min-w-0 justify-start p-0 text-left font-normal hover:underline"
                onclick={() => onOpenTask(subtask)}
              >
                <span class="truncate" class:text-text-muted={subtask.completedAt !== null}>{subtask.title}</span>
              </Button>
            </li>
          {/each}
        </ul>
        <div>
          <Button variant="secondary" disabled={fieldsLocked} onclick={() => onNewSubtask(task)}>
            <Plus aria-hidden="true" />
            Add Sub-Task
          </Button>
        </div>
      </section>

      <!-- LINKS: web addresses the work refers to. -->
      <section class="flex flex-col gap-8">
        <h3 class="text-sm font-semibold">Links</h3>
        <ul class="flex flex-col gap-4">
          {#each task.links as link (link.id)}
            <li class="flex items-center gap-8 text-sm">
              <a class="min-w-0 flex-1 truncate underline" href={link.url} {...opensBeside("external")}>
                {link.label ?? link.url}
              </a>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={fieldsLocked}
                aria-label={`Remove ${link.label ?? link.url}`}
                onclick={() => void act(() => removeTaskLink(fetch, link.id), "The link was not removed.")}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          {/each}
        </ul>
        <form
          class="flex flex-wrap items-center gap-8"
          onsubmit={(event) => {
            event.preventDefault();
            const url = newLinkUrl.trim();
            if (url === "") return;
            const label = newLinkLabel.trim();
            void act(
              (subject) => addTaskLink(fetch, subject.id, { url, label: label === "" ? null : label }),
              "The link was not added.",
            ).then(() => {
              newLinkUrl = "";
              newLinkLabel = "";
            });
          }}
        >
          <Input class="min-w-48 flex-1" type="url" aria-label="Link address" placeholder="https://" bind:value={newLinkUrl} disabled={fieldsLocked} />
          <Input class="w-40" aria-label="Link name" placeholder="Name" bind:value={newLinkLabel} disabled={fieldsLocked} />
          <Button type="submit" variant="secondary" disabled={fieldsLocked || newLinkUrl.trim() === ""}>
            <Plus aria-hidden="true" />
            Add Link
          </Button>
        </form>
      </section>

      <dl class="flex flex-col gap-8">
        {#if task.completedAt !== null}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">Completed by</dt>
            <dd>
              {nameOf(task.completedBy)},
              <time datetime={instantAttribute(task.completedAt)}>{formatInstant(task.completedAt)}</time>
            </dd>
          </div>
        {/if}
        {#if task.archivedAt !== null}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">Archived</dt>
            <dd>
              {nameOf(task.archivedBy)},
              <time datetime={instantAttribute(task.archivedAt)}>{formatInstant(task.archivedAt)}</time>
            </dd>
          </div>
          {#if task.archiveReason !== null}
            <div class="flex gap-8 text-sm">
              <dt class="text-text-muted">Because</dt>
              <dd>{task.archiveReason}</dd>
            </div>
          {/if}
        {/if}
        {#if timeLogged !== null}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">Time logged</dt>
            <dd>{timeLogged}</dd>
          </div>
        {/if}
        {#each task.externalLinks as link (link.id)}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">{externalSystemLabel(link.system)}</dt>
            <dd>
              {#if link.externalUrl === null}
                {link.externalId}
              {:else}
                <a class="underline" href={link.externalUrl} {...opensBeside("external")}>{link.externalId}</a>
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
    {/if}
  </div>
{/snippet}

<!-- The comment thread stands in its own column on the right, always in view, rather than behind a
     tab: a conversation about the work is read alongside the work, not instead of its attachments. -->
{#snippet commentsPanel()}
  {#if task !== null}
    <div class="flex flex-col gap-12">
      <h3 class="text-sm font-semibold">
        Comments
        {#if commentCount > 0}<span class="font-normal text-text-subtle tabular-nums">{commentCount}</span>{/if}
      </h3>
      <TaskComments
        {task}
        {viewerUserId}
        members={assignableMembers}
        {teams}
        {nameOf}
        {writeRefusal}
        bind:count={commentCount}
      />
    </div>
  {/if}
{/snippet}

{#snippet attachmentsTab()}
  <RecordAttachments
    {attachments}
    canEdit={canWrite}
    attachDisabledReason={writeRefusal}
    documentSource={offerable}
    documentSourceDisabledReason={documentSourceRefusal}
    onAttachExisting={(document) => void attachExisting(document)}
    onDetach={(attachment) => void detach(attachment)}
  />
{/snippet}

<!-- WHERE IT STANDS: the status dropdown beside Mark Complete. An archived task offers Put Back. -->
{#snippet actions()}
  {#if task !== null && canWrite}
    {#if task.archivedAt === null}
      <TaskStatusMenu
        {task}
        list={taskList}
        disabled={saving}
        onMove={(next) => void act((subject) => moveTaskToStatus(fetch, subject.id, next), "The task was not moved.")}
        onCompletion={(completed) =>
          void act((subject) => setTaskCompletion(fetch, subject.id, completed), "The task was not changed.")}
      />
      {#if task.completedAt === null}
        <Button
          variant="secondary"
          disabled={saving}
          onclick={() => void act((subject) => setTaskCompletion(fetch, subject.id, true), "The task was not completed.")}
        >
          <CircleCheck aria-hidden="true" />
          Mark Complete
        </Button>
      {:else}
        <Button
          variant="secondary"
          disabled={saving}
          onclick={() => void act((subject) => setTaskCompletion(fetch, subject.id, false), "The task was not reopened.")}
        >
          <RotateCcw aria-hidden="true" />
          Reopen
        </Button>
      {/if}
    {:else}
      <Button variant="secondary" disabled={saving} onclick={() => onUnarchive(task)}>
        <ArchiveRestore aria-hidden="true" />
        Put Back
      </Button>
    {/if}
  {/if}
{/snippet}

<!-- THE RARE ACTS: a copy, and the two ways a task leaves a list. Archiving keeps every word of it;
     deleting takes it. -->
{#snippet menu()}
  <DropdownMenu.Item disabled={!canWrite || saving} onSelect={() => void duplicate()}>
    <Copy aria-hidden="true" />
    Duplicate
  </DropdownMenu.Item>
  {#if task !== null && task.archivedAt === null}
    <DropdownMenu.Item disabled={!canWrite || saving} onSelect={() => task !== null && onArchive(task)}>
      <Archive aria-hidden="true" />
      Archive
    </DropdownMenu.Item>
  {/if}
  <DropdownMenu.Separator />
  <DropdownMenu.Item
    disabled={!canWrite || saving}
    onSelect={() => void act((subject) => deleteTask(fetch, subject.id, newWriteKey()), "The task was not deleted.", true)}
  >
    <Trash2 aria-hidden="true" />
    Delete
  </DropdownMenu.Item>
{/snippet}

<RecordWindow
  bind:open
  bind:editing
  {heading}
  {subtitle}
  {record}
  {actions}
  menu={task === null ? undefined : menu}
  editControl={false}
  tabs={[
    {
      key: ATTACHMENTS_TAB_KEY,
      label: "Attachments",
      count: attachments.length,
      content: attachmentsTab,
    },
  ] satisfies RecordWindowTab[]}
  defaultTab={ATTACHMENTS_TAB_KEY}
  aside={task === null ? undefined : commentsPanel}
  asideLabel="Comments"
  editDisabledReason={writeRefusal}
  saveDisabledReason={saveRefusal}
  {unsavedChanges}
  onSave={creating ? () => void save() : undefined}
  onCancel={abandon}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
