<script lang="ts">
  /*
   * The note window, hosted by a screen that is not the Notes section.
   *
   * WHAT THE WINDOW NEEDS, GATHERED ONCE, HERE. NoteRecordWindow takes the matter's files and
   * folders for its attachments tab, the firm roster to name people, and the session for the
   * writer's name and permission — the Notes section loads all four for its own list and hands them
   * over. A second screen that wants the window must not repeat that plumbing, so this component
   * carries it: give it a matter and bind `open`, and it reads what the window needs the first time
   * it opens. That is what lets the Activity section offer "+ New Note" and open a note in place
   * without knowing anything about notes beyond the fact that they have a window.
   *
   * A NOTE IS READ BY ITS ID, NEVER FOUND ON A PAGE. Handed a `noteId`, the host reads that one note
   * through its own route and the matter's visibility; a note that cannot be read is a stated
   * failure in the window, not a blank one. The first cut of the Activity section named rows by
   * scanning a first page, and this is the exact shape that replaced it.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/request.ts";
  import NoteDeleteDialog from "$lib/matters/note-delete-dialog.svelte";
  import { attachableFoldersFor } from "$lib/matters/note-attachable-documents.ts";
  import NoteRecordWindow from "$lib/matters/note-record-window.svelte";
  import { readMatterNote, type MatterNote } from "$lib/matters/notes-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { listMatterFolders, type FolderSummary } from "$lib/file-manager/folder-api.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";

  let {
    open = $bindable(false),
    noteId = null,
    matterId,
    matterTitle,
    onSaved,
    onDeleted,
    onAttachmentsUnwritten,
  }: {
    open?: boolean;
    /** The note to open, or null to write a new one. */
    noteId?: string | null;
    matterId: string;
    matterTitle: string;
    /** A note landed. The host re-reads whatever it shows notes in. */
    onSaved: (savedNoteId: string) => void;
    /** The note opened here was deleted. */
    onDeleted?: () => void;
    /** The note landed but these documents did not attach; the host says so where it can. */
    onAttachmentsUnwritten?: (names: readonly string[]) => void;
  } = $props();

  const roster = new FirmRoster();
  let session = $state<SessionBootstrap | null>(null);
  let matterFiles = $state<readonly MatterFile[]>([]);
  let matterFolders = $state<readonly FolderSummary[]>([]);
  let editing = $state(true);
  /** Which matter the window's supporting reads belong to, so a change of matter re-reads. */
  let loadedFor = $state<string | null>(null);

  // The note on screen, read by its id. Null while writing a new one, or while the read is out.
  let note = $state<MatterNote | null>(null);
  let readFailure = $state<Failure | null>(null);
  let readGeneration = 0;

  let deleting = $state<MatterNote | null>(null);
  let deleteOpen = $state(false);

  // Read what the window needs the first time it opens for a matter, never before: a screen that
  // never opens the window never pays for it.
  $effect(() => {
    if (!open || loadedFor === matterId) return;
    loadedFor = matterId;
    matterFiles = [];
    matterFolders = [];
    void roster.load(fetch);
    void readSession(fetch).then((outcome) => {
      session = outcome.kind === "ok" ? outcome.value : null;
    });
    void listMatterFiles(fetch, matterId).then((outcome) => {
      matterFiles = outcome.kind === "ok" ? outcome.value.data : [];
    });
    void listMatterFolders(fetch, matterId).then((outcome) => {
      matterFolders = outcome.kind === "ok" ? outcome.value.data : [];
    });
  });

  // Each opening decides what the window holds: a new note's empty fields, or the one note asked
  // for, read afresh so what it shows is what the server holds now.
  $effect(() => {
    if (!open) return;
    const wanted = noteId;
    readGeneration += 1;
    const generation = readGeneration;
    readFailure = null;
    if (wanted === null) {
      note = null;
      editing = true;
      return;
    }
    editing = false;
    void readMatterNote(fetch, wanted).then((outcome) => {
      if (generation !== readGeneration) return;
      if (outcome.kind === "ok") note = outcome.value;
      else readFailure = outcome.failure;
    });
  });

  const attachableFolders = $derived(attachableFoldersFor(matterFiles, matterFolders));
  const myName = $derived(session?.user.name ?? "You");
  const canWrite = $derived(session === null || session.permissions.includes("notes:write"));

  function nameOf(userId: string | null): string {
    if (userId === null) return "Not recorded";
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? "Not recorded";
  }

  /*
   * A write landed on the note that is open: re-read it so the window shows the row the server now
   * holds, then tell the host.
   */
  function afterWrite(savedNoteId: string): void {
    onSaved(savedNoteId);
    if (noteId === null) return;
    void readMatterNote(fetch, savedNoteId).then((outcome) => {
      if (outcome.kind === "ok") note = outcome.value;
    });
  }
</script>

{#if readFailure !== null && open}
  <FailureNotice
    failure={readFailure}
    title="Note Unavailable"
    fallback="This note could not be read."
  />
{/if}

<NoteRecordWindow
  bind:open
  bind:editing
  {note}
  {matterId}
  {matterTitle}
  authorName={myName}
  {nameOf}
  {attachableFolders}
  {matterFiles}
  {canWrite}
  onSaved={afterWrite}
  onAttachmentsUnwritten={(names) => onAttachmentsUnwritten?.(names)}
  onDelete={(subject) => {
    deleting = subject;
    deleteOpen = true;
  }}
/>

<NoteDeleteDialog
  bind:open={deleteOpen}
  note={deleting}
  authorName={deleting === null ? "" : nameOf(deleting.authorUserId)}
  onDeleted={() => {
    open = false;
    note = null;
    onDeleted?.();
  }}
/>
