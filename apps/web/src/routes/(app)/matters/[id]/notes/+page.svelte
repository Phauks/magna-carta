<script lang="ts">
  /*
   * The matter's notes: what the firm wrote down about this case that no other record holds.
   *
   * This screen is the LIST. A note is written, read and changed in the product's one record window
   * (note-record-window.svelte) — the same window a time entry opens in — because a note is a record
   * and starting one is a modal act, not a form that unfolds inside the list. What stays here is
   * finding a note again: the search, the ordering, and one row per note.
   *
   * TWO TIMES, KEPT APART. `createdAt` is when somebody typed the note. The Date is when the thing
   * it describes happened, which is frequently an earlier day, and it is what the list and the
   * matter's activity history order by. A note about Tuesday's call belongs beside Tuesday.
   *
   * THE LIST ALWAYS SETTLES. The loading shape means one thing only — the first read is in flight —
   * so every path out of that read ends in rows, an empty state, or a failure with a way to try
   * again. A section left on its loading shape is indistinguishable from a firm whose record cannot
   * be read, which is why the notes read is an effect of its OWN: nothing else the screen wants
   * (who is signed in, the roster, the matter's files) can abort the effect before the read is even
   * asked for, and none of those failing takes the list down with it.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no
   * firm behind it and therefore nothing to read; it says so rather than showing an empty list.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    SAMPLE_SENTENCE,
    sampleDate,
    samplePerson,
  } from "@magna-carta/design-system/loading-fixtures";
  import {
    formatInstant,
    instantAttribute,
    placeholderOf,
  } from "@magna-carta/design-system/formatters";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import NoteDeleteDialog from "$lib/matters/note-delete-dialog.svelte";
  import NoteRecordWindow from "$lib/matters/note-record-window.svelte";
  import { attachableFoldersFor } from "$lib/matters/record-attachable-documents.ts";
  import { occurrenceLine } from "$lib/matters/note-print-sheet.ts";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import { listMatterNotes, readMatterNote, type MatterNote } from "$lib/matters/notes-api.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { listMatterFolders, type FolderSummary } from "$lib/file-manager/folder-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const noteList = new PagedList<MatterNote>("The notes on this matter could not be read.");
  const roster = new FirmRoster();

  const notes = $derived(noteList.items);
  const readFailure = $derived(noteList.failure);
  // A failed FIRST read settles the list to the notice with Retry and never leaves the shape
  // standing (owner ruling, docs/conventions/design-corrections.md, 2026-09-01). A failed further
  // page keeps the rows already read and says so above them.
  const firstReadFailed = $derived(readFailure !== null && (notes?.length ?? 0) === 0);

  // Bumped after a write, so the list re-reads what the server now holds rather than guessing.
  let reloadToken = $state(0);
  // What is narrowing the list, as the server was last asked for it. ScreenSearch owns the field,
  // the pause before a query leaves the machine, and the clear; this holds only what was asked.
  let appliedSearch = $state("");
  let searchTerm = $state("");

  // The matter's own documents, for the attach picker. A failed read never fails this screen: notes
  // still read, and the picker says it has nothing to offer rather than disappearing.
  let matterFiles = $state<readonly MatterFile[]>([]);
  let matterFolders = $state<readonly FolderSummary[]>([]);
  let session = $state<SessionBootstrap | null>(null);

  let windowOpen = $state(false);
  let windowEditing = $state(false);
  let opened = $state<MatterNote | null>(null);

  let deleting = $state<MatterNote | null>(null);
  let deleteOpen = $state(false);

  /*
   * A note that was written while one of its chosen documents was not attached. It is stated on the
   * LIST because by then the note exists and its window has closed: a person who believes the
   * document is attached, and a person who writes the note a second time, are both worse outcomes
   * than a sentence naming exactly what did not land.
   */
  let unattachedNames = $state<readonly string[]>([]);

  /*
   * The notes read, and nothing else. `reloadToken` and the applied search are part of the subject
   * so a write or a new term is a fresh read of a fresh subject, rather than a second read the list
   * would have to be told to accept.
   */
  $effect(() => {
    const matterId = matter.id;
    const term = appliedSearch;
    const subject = `${matterId}:${String(reloadToken)}:${term}`;
    if (noteList.showing(subject)) return;
    noteList.reset(subject);
    if (isSample) {
      noteList.settleEmpty();
      return;
    }
    void noteList.load((cursor) => listMatterNotes(fetch, matterId, cursor, term));
  });

  /*
   * Everything the screen wants BESIDE the notes. Separate on purpose: none of these is the
   * screen's subject, so none of them may keep the list from settling, and a failure in any of them
   * degrades one control rather than the page.
   */
  $effect(() => {
    const matterId = matter.id;
    searchTerm = "";
    appliedSearch = "";
    matterFiles = [];
    matterFolders = [];
    if (isSample) return;
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

  const attachableFolders = $derived(attachableFoldersFor(matterFiles, matterFolders));

  function nameOf(userId: string | null): string {
    if (userId === null) return "Not recorded";
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? "Not recorded";
  }

  function hasLeft(userId: string | null): boolean {
    if (userId === null) return false;
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.status === "deactivated";
  }

  // The name that will go on a note written here, as the note will carry it. A plain word while the
  // read is in flight rather than an account handle: a handle is not a name and never reads as one.
  const myName = $derived(session?.user.name ?? "You");
  // Writing, editing, deleting and attaching are one permission. A member without it still reads the
  // matter's notes, so the controls are refused rather than absent.
  const canWrite = $derived(session === null || session.permissions.includes("notes:write"));

  /*
   * The matter header's New Note opens the window; this screen keeps no button for it. The window
   * is one at a time, so while one is open the control says so rather than opening a second.
   */
  claimMatterCreate("notes", () => ({
    title: "Write a note on this matter. It is stamped with your name and the moment it is saved.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : !canWrite
        ? permissionRefusal("Writing a note", "notes:write")
        : windowOpen
          ? "A note is open in its window. Save it or close it first."
          : undefined,
    run: openNew,
  }));

  function refresh(): void {
    reloadToken += 1;
  }

  function openNew(): void {
    opened = null;
    windowEditing = true;
    windowOpen = true;
  }

  /*
   * The note this address names, opened the way any note opens — read by its id rather than found
   * on the page, so a note older than the first page opens all the same. Once per address.
   */
  let honouredEntry = $state<string | null>(null);
  $effect(() => {
    const entry = entryFromUrl();
    if (entry === null || isSample || honouredEntry === entry) return;
    honouredEntry = entry;
    void readMatterNote(fetch, entry).then((outcome) => {
      if (outcome.kind === "ok") openNote(outcome.value);
    });
  });

  function openNote(note: MatterNote): void {
    opened = note;
    windowEditing = false;
    windowOpen = true;
  }

  /*
   * A write landed. The list re-reads, and the window — which may still be open on the note that was
   * just changed — is re-pointed at the row the server now holds, so what it shows and what the list
   * shows cannot disagree.
   */
  function afterWrite(savedNoteId: string): void {
    unattachedNames = [];
    refresh();
    pendingReopenId = savedNoteId;
  }

  let pendingReopenId = $state<string | null>(null);
  $effect(() => {
    const rows = noteList.items;
    const wanted = pendingReopenId;
    if (rows === null || wanted === null) return;
    pendingReopenId = null;
    // Only a window already showing an existing note is re-pointed. A window still on a NEW note
    // must not be turned into one showing a saved record underneath the person writing it.
    if (!windowOpen || opened === null) return;
    const found = rows.find((row) => row.id === wanted);
    if (found !== undefined) opened = found;
  });

  // The shape drawn while the first page is read: three rows in the list's own anatomy — who wrote
  // it, when, and the words. Sample words only, never a matter's: the sample vocabulary's people,
  // dates and sentence.
  const NOTE_FIXTURE = [
    { id: "fixture-note-0", author: samplePerson(0).name, happened: sampleDate(0), body: SAMPLE_SENTENCE },
    { id: "fixture-note-1", author: samplePerson(1).name, happened: sampleDate(1), body: SAMPLE_SENTENCE },
    { id: "fixture-note-2", author: samplePerson(0).name, happened: sampleDate(2), body: SAMPLE_SENTENCE },
  ];
</script>

<svelte:head>
  <title>Notes · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex min-h-0 flex-1 flex-col gap-16">
  <div class="flex items-center justify-between gap-16 border-b border-border-strong pb-8">
    <div class="flex items-center gap-16">
      <FieldLabel as="h2">
        Notes
      </FieldLabel>
      <ScreenSearch
        bind:value={searchTerm}
        label="Search this matter's notes"
        searchOn="pause"
        disabled={isSample}
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next.trim();
        }}
      />
    </div>
  </div>

  {#if unattachedNames.length > 0}
    <Alert.Root variant="warning">
      <Alert.Title>Note Written, Documents Not Attached</Alert.Title>
      <Alert.Description>
        The note is on the matter. {unattachedNames.length === 1
          ? "This document was not attached to it"
          : "These documents were not attached to it"}: {unattachedNames.join(", ")}. Open the note
        and attach {unattachedNames.length === 1 ? "it" : "them"} again.
      </Alert.Description>
    </Alert.Root>
  {/if}

  <!-- The region holds the whole state set: a failed first read renders the notice with Retry
       first, and no shape is left waiting (owner ruling, docs/conventions/design-corrections.md,
       2026-09-01). -->
  <LoadingRegion
    loading={notes === null}
    failed={firstReadFailed}
    empty={notes !== null && notes.length === 0}
    label="Reading this matter's notes"
    onRetry={refresh}
    class="flex min-h-0 flex-1 flex-col gap-8"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="Notes Unavailable"
          fallback="The notes on this matter could not be read."
          onRetry={refresh}
        />
      {/if}
    {/snippet}
    {#snippet emptyState()}
      {#if isSample}
        <EmptyState title="This is a sample matter, so it has no notes." />
      {:else if appliedSearch !== ""}
        <EmptyState title="No notes on this matter match that search." />
      {:else}
        <EmptyState title="No notes on this matter yet." />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {#each NOTE_FIXTURE as note (note.id)}
        <div class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
          <div class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
            <span class="text-text-default">{note.author}</span>
            <span class="text-text-default">{note.happened}</span>
            <span>written {note.happened}</span>
          </div>
          <p class="text-sm">{note.body}</p>
        </div>
      {/each}
    {/snippet}
    {@const shown = notes ?? []}
    {#if readFailure !== null}
      <!-- A further page that did not land. The rows below were read and stand. -->
      <FailureNotice
        failure={readFailure}
        title="The Rest Of The Notes Could Not Be Read"
        fallback="The next page of notes could not be read. What is shown was read and stands."
        onRetry={refresh}
      />
    {/if}
    {#if shown.length > 0}
      {#each shown as note (note.id)}
        {@const happened = occurrenceLine(note, formatDate)}
        <!-- The whole row opens the note, because opening a record is what a row in a record list
             does. The window is where it is then read, changed or deleted. -->
        <button
          type="button"
          class="flex flex-col gap-8 rounded-md border border-border-strong p-16 text-left hover:border-border-emphasis"
          onclick={() => openNote(note)}
        >
          <div class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
            <span class="text-text-default">{nameOf(note.authorUserId)}</span>
            {#if hasLeft(note.authorUserId)}
              <Badge variant="neutral">No Longer With The Firm</Badge>
            {/if}
            {#if happened !== null}
              <span class="text-text-default">{happened}</span>
              <span>
                written
                <time datetime={instantAttribute(note.createdAt)}>
                  {formatInstant(note.createdAt)}
                </time>
              </span>
            {:else}
              <time datetime={instantAttribute(note.createdAt)}>
                {formatInstant(note.createdAt)}
              </time>
            {/if}
            {#if note.documents.length > 0}
              <span class="flex items-center gap-4">
                <Paperclip aria-hidden="true" class="size-12" />
                {note.documents.length}
              </span>
            {/if}
          </div>
          <p class="text-sm whitespace-pre-wrap">{note.body}</p>
        </button>
      {/each}

      {#if noteList.nextCursor !== null}
        <div class="flex justify-center">
          <Button
            variant="secondary"
            disabled={noteList.loadingMore}
            onclick={() =>
              void noteList.loadMore((cursor) =>
                listMatterNotes(fetch, matter.id, cursor, appliedSearch),
              )}
          >
            Load More
          </Button>
        </div>
      {/if}
    {/if}
  </LoadingRegion>
</section>

<NoteRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  note={opened}
  matterId={matter.id}
  matterTitle={matter.title}
  authorName={myName}
  {nameOf}
  {attachableFolders}
  {matterFiles}
  {canWrite}
  onSaved={afterWrite}
  onAttachmentsUnwritten={(names) => (unattachedNames = names)}
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
    windowOpen = false;
    opened = null;
    refresh();
  }}
/>
