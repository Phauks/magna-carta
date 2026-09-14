<script lang="ts">
  /*
   * A note, opened.
   *
   * It opens in the product's one record window — the same window a time entry and a cost open in —
   * because a note is a record like any other and a second window for it would be a second thing to
   * learn. Writing a new note is that same window with nothing in it yet: the owner's direction is
   * that starting a note is a modal act, as recording time is, rather than a form unfolding inside
   * the list.
   *
   * EVERY FIELD THE NOTE WILL CARRY IS ON SCREEN WHILE IT IS BEING WRITTEN, generated ones included:
   * the matter it lands on, whose name goes on it, and the instant it will be stamped with. Somebody
   * writing a record that may be read years later should never have to guess what is being stored
   * beside their words, so the generated fields are stated (never editable) rather than hidden.
   *
   * TWO TIMES, KEPT APART. `createdAt` is when somebody typed the note. The Date is when the thing
   * the note describes happened — frequently an earlier day — and it is what the list and the
   * matter's history order by. They sit in different rows and are labelled differently on purpose;
   * a note about Tuesday's call typed on Thursday must be able to say both.
   *
   * ATTACHING WORKS BEFORE THE NOTE EXISTS. A person writing about a document should not have to
   * save first and come back: the picker offers the matter's files while the note is still a draft,
   * the choices are held here, and they are written the moment the note itself is. Nothing is
   * uploaded and nothing is copied either way — the document stays in the matter's files with
   * everything that follows from being there, and detaching ends the association without touching it.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
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
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import {
    isPendingAttachment,
    recordAttachmentsOf,
    pendingAttachmentsOf,
  } from "./record-attachable-documents.ts";
  import { noteSheet, occurrenceLine } from "./note-print-sheet.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import {
    attachNoteDocument,
    createMatterNote,
    detachNoteDocument,
    editMatterNote,
    newWriteKey,
    viewerTimeZone,
    type MatterNote,
  } from "./notes-api.ts";

  let {
    open = $bindable(false),
    note = null,
    editing = $bindable(false),
    matterId,
    matterTitle,
    authorName,
    nameOf,
    attachableFolders,
    matterFiles,
    canWrite,
    onSaved,
    onAttachmentsUnwritten,
    onDelete,
  }: {
    open?: boolean;
    /** The note being read, or null while a new one is being written. */
    note?: MatterNote | null;
    /**
     * Whether the record's fields are open for change. The window owns it — its Edit control raises
     * it and its abandon lowers it — and it is bound here so writing a NEW note can open straight
     * into the fields, and so this file can lower it once a save has actually landed.
     */
    editing?: boolean;
    matterId: string;
    matterTitle: string;
    /** Whose name goes on a note written here. Stated, never chosen: the writer is the author. */
    authorName: string;
    /** How an account identifier reads as a person, for the attachments the note already carries. */
    nameOf: (userId: string | null) => string;
    /** The matter's files, grouped by folder, as the picker offers them. */
    attachableFolders: readonly AttachableDocumentFolder[];
    /** Those same files flat, so a pending choice can be named before anything is written. */
    matterFiles: readonly MatterFile[];
    /** Whether this account may write, change, delete or attach. */
    canWrite: boolean;
    /** A write landed: the surface re-reads what the server now holds. */
    onSaved: (savedNoteId: string) => void;
    /**
     * A note was written but one or more of the documents chosen for it was not attached.
     *
     * It is reported to the SURFACE rather than kept here because the window has already closed on
     * a note that now exists: a message inside a window nobody is looking at would leave a person
     * believing their document is attached, and pressing Save again would file the note twice.
     */
    onAttachmentsUnwritten: (names: readonly string[]) => void;
    /** Delete this note. The confirmation is the surface's, so one dialog serves list and window. */
    onDelete: (subject: MatterNote) => void;
  } = $props();

  const creating = $derived(note === null);

  let bodyText = $state("");
  let occurredOnText = $state("");
  let occurredAtTimeText = $state("");
  /**
   * The documents a note being written will point at, by file identity. Held here because there is
   * no note yet to hang them on; written immediately after the note is.
   */
  let pendingFileIds = $state<string[]>([]);
  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  let printOpen = $state(false);

  /*
   * The instant a NEW note will be stamped with, kept live so the window is not describing a moment
   * that has already passed by the time somebody presses Save. A note that exists has its own.
   */
  let writtenPreview = $state(new Date().toISOString());
  $effect(() => {
    if (!open || note !== null) return;
    const tick = setInterval(() => {
      writtenPreview = new Date().toISOString();
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  });

  /*
   * What the fields held when they were last seeded or last saved, so the window can answer
   * honestly whether walking away would lose anything — and so abandoning has something to put back.
   */
  const seeded = $state({ body: "", occurredOn: "", occurredAtTime: "", fileIds: "" });

  function rememberWhatIsInTheFields(): void {
    seeded.body = bodyText;
    seeded.occurredOn = occurredOnText;
    seeded.occurredAtTime = occurredAtTimeText;
    seeded.fileIds = pendingFileIds.join(",");
  }

  /*
   * The fields are re-seeded from the record whenever the window opens on a different note, and
   * never while it is being edited: a re-seed mid-edit would silently discard what somebody typed.
   */
  let seededFor = $state<string | null>(null);
  $effect(() => {
    const identity = note === null ? "new" : note.id;
    if (!open) {
      seededFor = null;
      return;
    }
    if (seededFor === identity) return;
    seededFor = identity;
    saveFailure = null;
    writtenPreview = new Date().toISOString();
    bodyText = note?.body ?? "";
    occurredOnText = note?.occurredOn ?? "";
    occurredAtTimeText = note?.occurredAtTime ?? "";
    pendingFileIds = [];
    rememberWhatIsInTheFields();
  });

  const unsavedChanges = $derived(
    bodyText !== seeded.body ||
      occurredOnText !== seeded.occurredOn ||
      occurredAtTimeText !== seeded.occurredAtTime ||
      pendingFileIds.join(",") !== seeded.fileIds,
  );

  function forgetChanges(): void {
    bodyText = seeded.body;
    occurredOnText = seeded.occurredOn;
    occurredAtTimeText = seeded.occurredAtTime;
    pendingFileIds = seeded.fileIds === "" ? [] : seeded.fileIds.split(",");
    saveFailure = null;
    // A note being written from nothing has no earlier state to fall back to, so leaving its fields
    // and leaving the window are the same act.
    if (note === null) open = false;
  }

  const heading = $derived(creating ? "New Note" : editing ? "Edit Note" : "Note");

  const attachments = $derived<readonly RecordAttachment[]>(
    note === null
      ? pendingAttachmentsOf(pendingFileIds, matterFiles)
      : recordAttachmentsOf(note.documents, nameOf),
  );

  const offerable = $derived(unattachedDocumentFolders(attachableFolders, attachments));

  const happened = $derived(note === null ? null : occurrenceLine(note, formatDate));

  const sheet = $derived(
    note === null
      ? null
      : noteSheet(note, {
          matterTitle,
          authorName: nameOf(note.authorUserId),
          lastEditedByName: note.lastEditedBy === null ? null : nameOf(note.lastEditedBy),
          instant: (at) => formatInstant(at),
          ...printSheetDates(),
          attachedNames: note.documents.map((document) => document.fileName),
          printedAt: formatInstant(new Date()),
        }),
  );

  const editRefusal = $derived(
    canWrite ? undefined : "Your account cannot change this matter's notes.",
  );
  const saveRefusal = $derived(
    !canWrite
      ? "Your account cannot change this matter's notes."
      : bodyText.trim().length === 0
        ? "A note needs something written in it."
        : saving
          ? "Saving."
          : undefined,
  );

  /*
   * The occurrence as the server takes it: all three together, the date alone, or none at all. A
   * time with no date is refused server-side, and a wall-clock time with no zone is meaningless, so
   * the window simply never sends either shape.
   */
  function occurrence(): {
    occurredOn: string | null;
    occurredAtTime: string | null;
    timeZone: string | null;
  } {
    if (occurredOnText.trim().length === 0) {
      return { occurredOn: null, occurredAtTime: null, timeZone: null };
    }
    if (occurredAtTimeText.trim().length === 0) {
      return { occurredOn: occurredOnText, occurredAtTime: null, timeZone: null };
    }
    return {
      occurredOn: occurredOnText,
      occurredAtTime: occurredAtTimeText,
      timeZone: viewerTimeZone(),
    };
  }

  async function save(): Promise<void> {
    if (saveRefusal !== undefined) return;
    saving = true;
    saveFailure = null;

    if (note !== null) {
      const outcome = await editMatterNote(
        fetch,
        note.id,
        { body: bodyText.trim(), ...occurrence() },
        newWriteKey(),
      );
      saving = false;
      if (outcome.kind !== "ok") {
        saveFailure = stated(outcome.failure, "The note was not changed.");
        return;
      }
      rememberWhatIsInTheFields();
      editing = false;
      onSaved(note.id);
      return;
    }

    const written = await createMatterNote(
      fetch,
      matterId,
      { body: bodyText.trim(), ...occurrence() },
      newWriteKey(),
    );
    if (written.kind !== "ok") {
      saving = false;
      saveFailure = stated(written.failure, "The note was not written.");
      return;
    }

    /*
     * The note exists now, so a failure from here is a DIFFERENT failure: the note is written and
     * one of its documents is not attached. Saying so exactly is the whole point — a reader told
     * only "not saved" would write the note a second time.
     */
    const unattached: string[] = [];
    for (const fileId of pendingFileIds) {
      const attached = await attachNoteDocument(fetch, written.value.id, fileId, newWriteKey());
      if (attached.kind !== "ok") unattached.push(fileId);
    }
    saving = false;
    pendingFileIds = [];
    rememberWhatIsInTheFields();
    editing = false;
    open = false;
    onSaved(written.value.id);
    if (unattached.length > 0) onAttachmentsUnwritten(unattached.map(nameOfFile));
  }

  /** A chosen document's name, for saying which ones did not make it onto the note. */
  function nameOfFile(fileId: string): string {
    return matterFiles.find((file) => file.id === fileId)?.name ?? fileId;
  }

  async function attachExisting(document: AttachableDocument): Promise<void> {
    if (!canWrite || saving) return;
    if (note === null) {
      pendingFileIds = [...pendingFileIds, document.identifier];
      return;
    }
    saving = true;
    saveFailure = null;
    const outcome = await attachNoteDocument(fetch, note.id, document.identifier, newWriteKey());
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure = stated(outcome.failure, "The document was not attached.");
      return;
    }
    onSaved(note.id);
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
    saving = true;
    saveFailure = null;
    const outcome = await detachNoteDocument(fetch, attachment.identifier, newWriteKey());
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure = stated(outcome.failure, "The document was not detached.");
      return;
    }
    if (note !== null) onSaved(note.id);
  }
</script>

{#snippet subtitle()}
  <span>{matterTitle}</span>
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
      What the note carries without anybody typing it. Stated in both modes and editable in neither:
      the writer is the author, the matter is the one they are standing on, and the instant is the
      server's. Showing them is what stops a note being stored with facts nobody was shown.
    -->
    <dl class="grid gap-x-24 gap-y-8 @md:grid-cols-3">
      <div class="flex flex-col gap-4">
        <dt class="text-xs text-text-muted">Matter</dt>
        <dd class="text-sm">{matterTitle}</dd>
      </div>
      <div class="flex flex-col gap-4">
        <dt class="text-xs text-text-muted">Written By</dt>
        <dd class="text-sm">{note === null ? authorName : nameOf(note.authorUserId)}</dd>
      </div>
      <div class="flex flex-col gap-4">
        <dt class="text-xs text-text-muted">Written</dt>
        <dd class="text-sm">
          {#if note === null}
            <time datetime={instantAttribute(writtenPreview)}>{formatInstant(writtenPreview)}</time>
          {:else}
            <time datetime={instantAttribute(note.createdAt)}>{formatInstant(note.createdAt)}</time>
          {/if}
        </dd>
      </div>
    </dl>

    <!--
      Date and time are ONE fact about ONE moment, so they sit on one line. The time is refused
      until there is a date to hang it on, which is the same rule the record itself enforces.
    -->
    {#if fieldsOpen}
      <div class="grid grid-cols-2 gap-12 @md:grid-cols-4">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="Date"
            value={civilDateValue(occurredOnText)}
            onValueChange={(next) => (occurredOnText = civilDateTextOrEmpty(next))}
            disabled={saving}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="note-occurred-at">Time</Label>
          <Input
            id="note-occurred-at"
            type="time"
            disabled={saving || occurredOnText.trim().length === 0}
            bind:value={occurredAtTimeText}
          />
        </div>
        {#if occurredAtTimeText.trim().length > 0}
          <p class="col-span-2 self-end pb-8 text-xs text-text-muted">
            Read in {viewerTimeZone()}.
          </p>
        {/if}
      </div>
    {:else}
      <dl class="flex flex-col gap-4">
        <dt class="text-xs text-text-muted">Date</dt>
        <dd class="text-sm">{happened ?? "Not recorded"}</dd>
      </dl>
    {/if}

    <div class="flex flex-col gap-4">
      <Label for="note-body">Note</Label>
      <Textarea
        id="note-body"
        rows={8}
        title="Note"
        disabled={!fieldsOpen || saving}
        bind:value={bodyText}
      />
    </div>

    {#if note !== null && note.lastEditedBy !== null}
      <p class="text-xs text-text-muted">
        Edited by {nameOf(note.lastEditedBy)},
        <time datetime={instantAttribute(note.updatedAt)}>{formatInstant(note.updatedAt)}</time>.
      </p>
    {/if}
  </div>
{/snippet}

{#snippet attachmentsTab()}
  <RecordAttachments
    {attachments}
    canEdit={canWrite}
    attachDisabledReason={canWrite
      ? undefined
      : "Your account cannot change this matter's notes."}
    documentSource={offerable}
    documentSourceDisabledReason={attachableFolders.length === 0
      ? "This matter holds no files to point at yet."
      : undefined}
    onAttachExisting={(document) => void attachExisting(document)}
    onDetach={(attachment) => void detach(attachment)}
  />
{/snippet}

{#snippet actions()}
  {#if note !== null && canWrite}
    <Button
      variant="destructive"
      disabled={saving}
      title="Remove this note and its text"
      onclick={() => onDelete(note)}
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
    { key: ATTACHMENTS_TAB_KEY, label: "Attachments", content: attachmentsTab },
  ] satisfies RecordWindowTab[]}
  defaultTab={ATTACHMENTS_TAB_KEY}
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  {unsavedChanges}
  onSave={() => void save()}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
