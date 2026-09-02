<script lang="ts">
  /*
   * The note window, hosted by a screen that is not the Notes section.
   *
   * WHAT THE WINDOW NEEDS, GATHERED ONCE, HERE. NoteRecordWindow takes the matter's files and
   * folders for its attachments tab, the firm roster to name people, and the session for the
   * writer's name and permission — the Notes section loads all four for its own list and hands them
   * over. A second screen that wants the window must not repeat that plumbing, so this component
   * carries it: give it a matter and bind `open`, and it reads what the window needs the first time
   * it opens. That is what lets the Activity section offer "+ New Note" without knowing anything
   * about notes beyond the fact that they have a window.
   *
   * WRITING ONLY, FOR NOW. It opens a NEW note. Opening an existing one from here waits on the notes
   * API reading a note by its id — the window must not be handed a note found by scanning a first
   * page, which is the exact defect the Activity section was rebuilt to remove.
   */
  import { attachableFoldersFor } from "$lib/matters/note-attachable-documents.ts";
  import NoteRecordWindow from "$lib/matters/note-record-window.svelte";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { listMatterFolders, type FolderSummary } from "$lib/file-manager/folder-api.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";

  let {
    open = $bindable(false),
    matterId,
    matterTitle,
    onSaved,
    onAttachmentsUnwritten,
  }: {
    open?: boolean;
    matterId: string;
    matterTitle: string;
    /** A note landed. The host re-reads whatever it shows notes in. */
    onSaved: (savedNoteId: string) => void;
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

  // A new note every time it opens: the fields must not carry the last draft into the next.
  $effect(() => {
    if (open) editing = true;
  });

  const attachableFolders = $derived(attachableFoldersFor(matterFiles, matterFolders));
  const myName = $derived(session?.user.name ?? "You");
  const canWrite = $derived(session === null || session.permissions.includes("notes:write"));

  function nameOf(userId: string | null): string {
    if (userId === null) return "Not recorded";
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? "Not recorded";
  }
</script>

<NoteRecordWindow
  bind:open
  bind:editing
  note={null}
  {matterId}
  {matterTitle}
  authorName={myName}
  {nameOf}
  {attachableFolders}
  {matterFiles}
  {canWrite}
  {onSaved}
  onAttachmentsUnwritten={(names) => onAttachmentsUnwritten?.(names)}
  onDelete={() => undefined}
/>
