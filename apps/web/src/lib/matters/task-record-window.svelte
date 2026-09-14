<script lang="ts">
  /*
   * A task, opened.
   *
   * ONE WINDOW READS IT AND CHANGES IT. It opens in the product's one record window — the same
   * window a note, a time entry and a cost open in — and Edit turns the same pane into fields
   * without the reader going anywhere. That is the owner's standing direction and the reason the
   * shell is shaped the way it is: a surface for reading a record and a second surface for changing
   * it are two places to learn one record, and the second is always the one that drifts.
   *
   * WRITING A NEW TASK IS THIS SAME WINDOW WITH NOTHING IN IT YET, opened straight into its fields.
   * A task has nothing to read before it exists, and a separate panel for making one would be the
   * two-surface defect wearing a different name — the call log was corrected for exactly that.
   *
   * EVERY FIELD THE TASK WILL CARRY IS ON SCREEN WHILE IT IS BEING WRITTEN, generated ones included:
   * the matter it lands on, whose name goes on it, and the instant it will be stamped with. Nothing
   * is stored that the writer was not shown.
   *
   * WHAT IS STATED AND NEVER EDITED is the part the task did not get by being typed: the time logged
   * against it, the systems it is mirrored into, the task it waits on, and what became of it. A
   * field that looked editable and silently was not would be worse than a stated fact.
   *
   * ASSIGNMENT IS ITS OWN WRITE, because it is its own permission. Content and assignee change
   * together in the fields and separately on the wire, and a member who may write a task but may not
   * put it in somebody else's name gets the field stated rather than offered.
   *
   * ATTACHING WORKS BEFORE THE TASK EXISTS. The picker offers the matter's files while the task is
   * still a draft, the choices are held here, and they are written the moment the task itself is.
   * A task on no matter can point at nothing, because every document belongs to a matter, and the
   * tab says that rather than offering an empty picker.
   *
   * THE FOUR RUNGS ARE THE ACTION BAR, and only while the window is reading. Beside them are the two
   * ways a task leaves a list, and the copy says which is which: archiving keeps every word of it,
   * deleting takes it. Archiving is not a fifth rung — a task is archived FROM wherever it stood, and
   * putting it back returns it there.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Badge from "@magna-carta/design-system/badge";
  import * as Select from "@magna-carta/design-system/select";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordAttachments, {
    ATTACHMENTS_TAB_KEY,
    unattachedDocumentFolders,
    type AttachableDocument,
    type AttachableDocumentFolder,
    type RecordAttachment,
  } from "@magna-carta/design-system/record-attachments";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Archive from "@lucide/svelte/icons/archive";
  import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { printSheetDates } from "$lib/print-sheet";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import {
    isPendingAttachment,
    pendingAttachmentsOf,
    recordAttachmentsOf,
  } from "./record-attachable-documents.ts";
  import { dueLine, taskSheet } from "./task-print-sheet.ts";
  import {
    PRIORITY_LABELS,
    RUNG_LABELS,
    TASK_PRIORITIES,
    TASK_RUNGS,
    archiveTask,
    attachTaskDocument,
    createTask,
    deleteTask,
    describeTimeLogged,
    detachTaskDocument,
    editTask,
    externalSystemLabel,
    isOverdue,
    moveTaskToRung,
    newWriteKey,
    reassignTask,
    unarchiveTask,
    viewerTimeZone,
    type MatterTask,
    type TaskPriority,
    type TaskRung,
  } from "./tasks-api.ts";

  let {
    open = $bindable(false),
    task = null,
    editing = $bindable(false),
    matterId,
    matterTitle,
    authorName,
    nameOf,
    assignableMembers = [],
    attachableFolders = [],
    matterFiles = [],
    writeRefusal,
    canAssign,
    onSaved,
    onAttachmentsUnwritten,
    onArchive,
  }: {
    open?: boolean;
    /** The task being read, or null while a new one is being written. */
    task?: MatterTask | null;
    /**
     * Whether the record's fields are open for change. The window owns it — its Edit control raises
     * it and its abandon lowers it — and it is bound here so writing a NEW task can open straight
     * into the fields, and so this file can lower it once a save has actually landed.
     */
    editing?: boolean;
    /** Which matter a NEW task lands on. Null on the member's own list: firm work has no matter. */
    matterId: string | null;
    /** The matter's name, or what to call the firm's own work where there is none. */
    matterTitle: string | null;
    /** Whose name goes on a task written here. Stated, never chosen: the writer is the author. */
    authorName: string;
    /** How an account identifier reads as a person. */
    nameOf: (userId: string | null) => string;
    /** Who the task may be put in the name of — the firm's members who are still here. */
    assignableMembers?: readonly FirmMemberSummary[];
    /** The matter's files, grouped by folder, as the picker offers them. */
    attachableFolders?: readonly AttachableDocumentFolder[];
    /** Those same files flat, so a pending choice can be named before anything is written. */
    matterFiles?: readonly MatterFile[];
    /**
     * Why nothing here can be written — the account lacks the permission, or the matter is a sample
     * with no firm record behind it. Undefined where writing is allowed. It arrives as the SENTENCE
     * rather than as a flag because the window states it on every refused control, and only the
     * surface knows which of the reasons applies.
     */
    writeRefusal?: string;
    /** Whether it may put a task in somebody else's name. Its own permission. */
    canAssign: boolean;
    /** A write landed: the surface re-reads what the server now holds. */
    onSaved: (savedTaskId: string) => void;
    /**
     * A task was written but one or more of the documents chosen for it was not attached.
     *
     * Reported to the SURFACE rather than kept here because the window has already closed on a task
     * that now exists: a message inside a window nobody is looking at would leave a person believing
     * their document is attached, and pressing Save again would file the task twice.
     */
    onAttachmentsUnwritten?: (names: readonly string[]) => void;
    /**
     * Put this task away. The optional reason is asked for in the surface's own panel, so one panel
     * serves the list and the window.
     */
    onArchive: (subject: MatterTask) => void;
  } = $props();

  const creating = $derived(task === null);

  let titleText = $state("");
  let bodyText = $state("");
  let priority = $state<TaskPriority>("normal");
  let dueOnText = $state("");
  let dueAtTimeText = $state("");
  let assignee = $state("");
  /**
   * The documents a task being written will point at, by file identity. Held here because there is
   * no task yet to hang them on; written immediately after the task is.
   */
  let pendingFileIds = $state<string[]>([]);
  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  let printOpen = $state(false);

  /*
   * The instant a NEW task will be stamped with, kept live so the window is not describing a moment
   * that has already passed by the time somebody presses Save. A task that exists has its own.
   */
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

  /*
   * What the fields held when they were last seeded or last saved, so the window can answer honestly
   * whether walking away would lose anything — and so abandoning has something to put back.
   */
  const seeded = $state({
    title: "",
    body: "",
    priority: "normal" as TaskPriority,
    dueOn: "",
    dueAtTime: "",
    assignee: "",
    fileIds: "",
  });

  function rememberWhatIsInTheFields(): void {
    seeded.title = titleText;
    seeded.body = bodyText;
    seeded.priority = priority;
    seeded.dueOn = dueOnText;
    seeded.dueAtTime = dueAtTimeText;
    seeded.assignee = assignee;
    seeded.fileIds = pendingFileIds.join(",");
  }

  /*
   * The fields are re-seeded from the record whenever the window opens on a different task, and
   * never while it is being edited: a re-seed mid-edit would silently discard what somebody typed.
   */
  let seededFor = $state<string | null>(null);
  $effect(() => {
    const identity = task === null ? "new" : task.id;
    if (!open) {
      seededFor = null;
      return;
    }
    if (seededFor === identity) return;
    seededFor = identity;
    saveFailure = null;
    createdPreview = new Date().toISOString();
    titleText = task?.title ?? "";
    bodyText = task?.body ?? "";
    priority = task?.priority ?? "normal";
    dueOnText = task?.dueOn ?? "";
    dueAtTimeText = task?.dueAtTime ?? "";
    assignee = task?.assigneeUserId ?? "";
    pendingFileIds = [];
    rememberWhatIsInTheFields();
  });

  const unsavedChanges = $derived(
    titleText !== seeded.title ||
      bodyText !== seeded.body ||
      priority !== seeded.priority ||
      dueOnText !== seeded.dueOn ||
      dueAtTimeText !== seeded.dueAtTime ||
      assignee !== seeded.assignee ||
      pendingFileIds.join(",") !== seeded.fileIds,
  );

  function forgetChanges(): void {
    titleText = seeded.title;
    bodyText = seeded.body;
    priority = seeded.priority;
    dueOnText = seeded.dueOn;
    dueAtTimeText = seeded.dueAtTime;
    assignee = seeded.assignee;
    pendingFileIds = seeded.fileIds === "" ? [] : seeded.fileIds.split(",");
    saveFailure = null;
    // A task being written from nothing has no earlier state to fall back to, so leaving its fields
    // and leaving the window are the same act.
    if (task === null) open = false;
  }

  const heading = $derived(creating ? "New Task" : editing ? "Edit Task" : "Task");
  const subtitleText = $derived(matterTitle ?? "The firm's own work, on no matter");

  const attachments = $derived<readonly RecordAttachment[]>(
    task === null
      ? pendingAttachmentsOf(pendingFileIds, matterFiles)
      : recordAttachmentsOf(task.documents, nameOf),
  );
  const offerable = $derived(unattachedDocumentFolders(attachableFolders, attachments));

  /** Where the task belongs decides whether it can point at anything: every document has a matter. */
  const attachesTo = $derived(task === null ? matterId : task.matterId);
  const documentSourceRefusal = $derived(
    attachesTo === null
      ? "This task belongs to no matter, and every document in Magna Carta belongs to one."
      : attachableFolders.length === 0
        ? "This matter holds no files to point at yet."
        : undefined,
  );

  const due = $derived(task === null ? null : dueLine(task, formatDate));
  // Most tasks carry no time at all, and a row printing "0m" on every one of them would be noise
  // standing in for a fact nobody recorded, so the absence renders as nothing.
  const timeLogged = $derived(task === null ? null : describeTimeLogged(task.timeLogged));
  const overdue = $derived(task !== null && isOverdue(task));
  const assigneeName = $derived(nameOf(task === null ? null : task.assigneeUserId));

  const canWrite = $derived(writeRefusal === undefined);
  const saveRefusal = $derived(
    writeRefusal ??
      (titleText.trim() === ""
        ? "A task says what is to be done. Write that first."
        : saving
          ? "Saving."
          : undefined),
  );

  const sheet = $derived(
    task === null
      ? null
      : taskSheet(task, {
          matterTitle: subtitleText,
          assigneeName,
          authorName: nameOf(task.createdBy),
          completedByName: task.completedBy === null ? null : nameOf(task.completedBy),
          archivedByName: task.archivedBy === null ? null : nameOf(task.archivedBy),
          instant: (at) => formatInstant(at),
          ...printSheetDates(),
          attachedNames: task.documents.map((document) => document.fileName),
          printedAt: formatInstant(new Date()),
        }),
  );

  /*
   * The due date as the server takes it: a date needs a zone, a time needs a date, and nothing is
   * inferred. A time with no date is simply not sent.
   */
  function dueOf(): { dueOn: string | null; dueAtTime: string | null; timeZone: string | null } {
    if (dueOnText.trim() === "") return { dueOn: null, dueAtTime: null, timeZone: null };
    return {
      dueOn: dueOnText,
      dueAtTime: dueAtTimeText.trim() === "" ? null : dueAtTimeText,
      timeZone: viewerTimeZone(),
    };
  }

  async function save(): Promise<void> {
    if (saveRefusal !== undefined) return;
    saving = true;
    saveFailure = null;

    if (task !== null) {
      /*
       * The edit REPLACES the task's content, so every field it should keep has to travel — an
       * omitted link is a cleared link, not an unchanged one. The window does not offer the three
       * link fields, so they are carried through from the task rather than left out, which would
       * silently drop a "waiting on" somebody editing a title never touched.
       */
      const changed = await editTask(
        fetch,
        task.id,
        {
          title: titleText.trim(),
          body: bodyText.trim() === "" ? null : bodyText.trim(),
          priority,
          blockedByTaskId: task.blockedByTaskId,
          triggerEventId: task.triggerEventId,
          deadlineId: task.deadlineId,
          ...dueOf(),
        },
        newWriteKey(),
      );
      if (changed.kind !== "ok") {
        saving = false;
        saveFailure = stated(changed.failure, "The task was not changed.");
        return;
      }
      // Assignment is a different endpoint and a different permission, so it is a second write and
      // only where it actually changed: re-sending the same name would be a write nobody asked for.
      if (canAssign && assignee !== (task.assigneeUserId ?? "")) {
        const reassigned = await reassignTask(
          fetch,
          task.id,
          assignee === "" ? null : assignee,
          newWriteKey(),
        );
        if (reassigned.kind !== "ok") {
          saving = false;
          // The words say exactly what landed and what did not: a reader told only "not saved"
          // would type the title again and wonder why it was already there.
          saveFailure = stated(
            reassigned.failure,
            "The task was changed, but it was not reassigned.",
          );
          onSaved(task.id);
          return;
        }
      }
      saving = false;
      rememberWhatIsInTheFields();
      editing = false;
      onSaved(task.id);
      return;
    }

    const written = await createTask(
      fetch,
      {
        matterId,
        title: titleText.trim(),
        body: bodyText.trim() === "" ? null : bodyText.trim(),
        priority,
        assigneeUserId: assignee === "" ? null : assignee,
        ...dueOf(),
      },
      newWriteKey(),
    );
    if (written.kind !== "ok") {
      saving = false;
      saveFailure = stated(written.failure, "The task was not created.");
      return;
    }

    /*
     * The task exists now, so a failure from here is a DIFFERENT failure: the task is written and
     * one of its documents is not attached. Saying so exactly is the whole point — a reader told
     * only "not saved" would write the task a second time.
     */
    const unattached: string[] = [];
    for (const fileId of pendingFileIds) {
      const attached = await attachTaskDocument(fetch, written.value.id, fileId, newWriteKey());
      if (attached.kind !== "ok") unattached.push(fileId);
    }
    saving = false;
    pendingFileIds = [];
    rememberWhatIsInTheFields();
    editing = false;
    open = false;
    onSaved(written.value.id);
    if (unattached.length > 0) onAttachmentsUnwritten?.(unattached.map(nameOfFile));
  }

  /** A chosen document's name, for saying which ones did not make it onto the task. */
  function nameOfFile(fileId: string): string {
    return matterFiles.find((file) => file.id === fileId)?.name ?? fileId;
  }

  /** One act on the task that is open, with its own words for what did not happen. */
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
    // A pending choice has never reached the server, so unpicking it is not a request.
    if (isPendingAttachment(attachment)) {
      pendingFileIds = pendingFileIds.filter(
        (fileId) => fileId !== attachment.documentIdentifier,
      );
      return;
    }
    await act(
      () => detachTaskDocument(fetch, attachment.identifier, newWriteKey()),
      "The document was not detached.",
    );
  }
</script>

{#snippet subtitle()}
  <span>{subtitleText}</span>
{/snippet}

<!--
  ONE pane, both modes. The window hands it whether the fields are open; the stated facts and the
  fields are the same rows in the same order, which is what stops a reader losing their place the
  moment they press Edit.
-->
{#snippet record({ editing: fieldsOpen }: { editing: boolean })}
  <div class="@container flex flex-col gap-16">
    {#if saveFailure !== null}
      <FailureNotice
        failure={saveFailure.failure}
        title={creating ? "Not Saved" : "Nothing Changed"}
        fallback={saveFailure.fallback}
      />
    {/if}

    <!--
      What the task carries without anybody typing it. Stated in both modes and editable in neither:
      the writer is the author, the matter is the one the list was standing on, and the instant is
      the server's. Showing them is what stops a task being stored with facts nobody was shown.
    -->
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

    <!-- Where the task stands, and the marks that are comparisons rather than columns. Overdue is
         computed against now, here, so it is never stale; waiting is guidance and gates nothing. -->
    {#if task !== null}
      <div class="flex flex-wrap items-center gap-8">
        <Badge variant="neutral">{RUNG_LABELS[task.rung]}</Badge>
        {#if task.archivedAt !== null}
          <Badge variant="neutral">Archived</Badge>
        {/if}
        {#if overdue}
          <Badge variant="danger">Overdue</Badge>
        {/if}
        {#if task.blockedByTaskId !== null}
          <Badge variant="neutral">Waiting on another task</Badge>
        {/if}
      </div>
    {/if}

    <div class="flex flex-col gap-4">
      <Label for="task-title">What to do</Label>
      <Input id="task-title" disabled={!fieldsOpen || saving} bind:value={titleText} />
    </div>

    <div class="flex flex-col gap-4">
      <Label for="task-body">Detail</Label>
      <Textarea id="task-body" rows={5} disabled={!fieldsOpen || saving} bind:value={bodyText} />
    </div>

    <!--
      Date and time are ONE fact about ONE moment, so they sit on one line. The time is refused until
      there is a date to hang it on, which is the same rule the record itself enforces.
    -->
    {#if fieldsOpen}
      <div class="grid grid-cols-2 gap-12 @md:grid-cols-4">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="Due"
            value={civilDateValue(dueOnText)}
            onValueChange={(next) => (dueOnText = civilDateTextOrEmpty(next))}
            disabled={saving}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="task-due-time">Time</Label>
          <Input
            id="task-due-time"
            type="time"
            disabled={saving || dueOnText.trim() === ""}
            bind:value={dueAtTimeText}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="task-priority">Priority</Label>
          <Select.Root type="single" bind:value={priority} disabled={saving}>
            <Select.Trigger id="task-priority">{PRIORITY_LABELS[priority]}</Select.Trigger>
            <Select.Content>
              {#each TASK_PRIORITIES as candidate (candidate)}
                <Select.Item value={candidate} label={PRIORITY_LABELS[candidate]} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-4">
          <Label for="task-assignee">Assigned to</Label>
          {#if canAssign}
            <Select.Root type="single" bind:value={assignee} disabled={saving}>
              <Select.Trigger id="task-assignee">
                {assignee === "" ? "Nobody yet" : nameOf(assignee)}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="" label="Nobody yet" />
                {#each assignableMembers as member (member.userId)}
                  <Select.Item value={member.userId} label={member.displayName} />
                {/each}
              </Select.Content>
            </Select.Root>
          {:else}
            <!-- Putting a task in somebody else's name is its own permission. Without it the fact
                 is stated rather than offered, so the window never shows a control that refuses. -->
            <p id="task-assignee" class="text-sm">{assigneeName}</p>
          {/if}
        </div>
      </div>
    {:else}
      <dl class="grid gap-x-24 gap-y-8 @md:grid-cols-4">
        <div class="flex flex-col gap-4">
          <dt class="text-xs text-text-muted">Due</dt>
          <dd class="text-sm">{due ?? "Not scheduled"}</dd>
        </div>
        <div class="flex flex-col gap-4">
          <dt class="text-xs text-text-muted">Priority</dt>
          <dd class="text-sm">{PRIORITY_LABELS[task?.priority ?? "normal"]}</dd>
        </div>
        <div class="flex flex-col gap-4">
          <dt class="text-xs text-text-muted">Assigned to</dt>
          <dd class="text-sm">{assigneeName}</dd>
        </div>
      </dl>
    {/if}

    {#if task !== null}
      <!--
        The facts the task did not get by being typed, so none of them is a field that looks
        editable. Each is absent where there is nothing to say rather than stating its own emptiness.
      -->
      <dl class="flex flex-col gap-8">
        {#if task.rung === "done" && task.completedAt !== null}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">Done by</dt>
            <dd>
              {nameOf(task.completedBy)},
              <time datetime={instantAttribute(task.completedAt)}>
                {formatInstant(task.completedAt)}
              </time>
            </dd>
          </div>
        {/if}
        {#if task.archivedAt !== null}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">Archived</dt>
            <dd>
              {nameOf(task.archivedBy)},
              <time datetime={instantAttribute(task.archivedAt)}>
                {formatInstant(task.archivedAt)}
              </time>
            </dd>
          </div>
          <!-- Only where there is one: an archiving does not have to say why, and a line reading
               "Not recorded" would put a gap on screen where there is no gap. -->
          {#if task.archiveReason !== null}
            <div class="flex gap-8 text-sm">
              <dt class="text-text-muted">Because</dt>
              <dd>{task.archiveReason}</dd>
            </div>
          {/if}
        {/if}
        <!-- Minutes, never money: what a task cost is a billing question with a different audience.
             "by you" appears where the reader may not see other timekeepers' time, so the number is
             never mistaken for the whole task's. -->
        {#if timeLogged !== null}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">Time logged</dt>
            <dd>{timeLogged}</dd>
          </div>
        {/if}
        <!-- Where else this task is written down. Absent on nearly every task, because the product
             integrates with nothing on its own — a row here means an addon put it there, and saying
             so is what stops somebody editing in two places without knowing the other exists. -->
        {#each task.externalLinks as link (link.id)}
          <div class="flex gap-8 text-sm">
            <dt class="text-text-muted">{externalSystemLabel(link.system)}</dt>
            <dd>
              {#if link.externalUrl === null}
                <!-- No addressable page over there. The platform will not invent a URL from an id
                     pattern — that would be guessing at somebody else's routing. -->
                {link.externalId}
              {:else}
                <!-- Another system entirely, so it opens beside the reader rather than in place,
                     through the product's one gate for that. -->
                <a class="underline" href={link.externalUrl} {...opensBeside("external")}>
                  {link.externalId}
                </a>
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
    {/if}
  </div>
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

<!--
  THE ACTION BAR IS THE FOUR RUNGS, then the two ways a task leaves a list.
  ─────────────────────────────────────────────────────────────────────────────────────────────────
  The rungs are one control group, not four scattered verbs, because they are one question: where is
  this. The rung the task is ON renders pressed and does nothing — a reader can see where it stands
  without reading the badge, and pressing it again is not a write. The shell's own geometry puts the
  abandon and the commit after whatever this renders while the fields are open, which is why none of
  it draws then: moving a task somebody is halfway through rewriting is not an act anybody means.

  ARCHIVE AND DELETE ARE THE TWO WAYS OUT and they sit apart from the rungs, because they are not a
  fifth rung: a task is archived FROM wherever it stood. They differ in exactly one thing and the
  copy says which — an archive keeps every word of the task, a delete takes it.

  AN ARCHIVED TASK SHOWS ONE CONTROL: put it back. Offering the rungs on a task nobody can see would
  be writing into a list that is not on screen, and the server refuses it anyway.
-->
{#snippet actions({ editing: fieldsOpen }: { editing: boolean })}
  {#if task !== null && canWrite && !fieldsOpen}
    {#if task.archivedAt === null}
      <div class="flex flex-wrap items-center gap-4" role="group" aria-label="Where this task stands">
        {#each TASK_RUNGS as rung (rung)}
          {@const here = task.rung === rung}
          <Button
            variant={here ? "secondary" : "ghost"}
            disabled={saving || here}
            aria-pressed={here}
            title={here ? `This task is ${RUNG_LABELS[rung]}` : `Move to ${RUNG_LABELS[rung]}`}
            onclick={() =>
              void act(
                (subject) => moveTaskToRung(fetch, subject.id, rung, newWriteKey()),
                "The task was not moved.",
              )}
          >
            {RUNG_LABELS[rung]}
          </Button>
        {/each}
      </div>
      <Button
        variant="secondary"
        disabled={saving}
        title="Put this task away and keep it — every word of it stays on the record"
        onclick={() => onArchive(task)}
      >
        <Archive aria-hidden="true" />
        Archive
      </Button>
    {:else}
      <Button
        variant="secondary"
        disabled={saving}
        title="Put this task back on the list, on the rung it left from"
        onclick={() =>
          void act(
            (subject) => unarchiveTask(fetch, subject.id, newWriteKey()),
            "The task was not put back.",
          )}
      >
        <ArchiveRestore aria-hidden="true" />
        Put Back
      </Button>
    {/if}
    <Button
      variant="destructive"
      disabled={saving}
      title="Delete — for a task that should not exist. Archiving is the other way out, and it keeps the task."
      onclick={() =>
        void act(
          (subject) => deleteTask(fetch, subject.id, newWriteKey()),
          "The task was not deleted.",
          true,
        )}
    >
      <Trash2 aria-hidden="true" />
      Delete
    </Button>
  {/if}
{/snippet}

<RecordWindow
  bind:open
  bind:editing
  {heading}
  {subtitle}
  {record}
  {actions}
  tabs={[
    {
      key: ATTACHMENTS_TAB_KEY,
      label: "Attachments",
      count: attachments.length,
      content: attachmentsTab,
    },
  ] satisfies RecordWindowTab[]}
  defaultTab={ATTACHMENTS_TAB_KEY}
  editDisabledReason={writeRefusal}
  saveDisabledReason={saveRefusal}
  {unsavedChanges}
  onSave={() => void save()}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
