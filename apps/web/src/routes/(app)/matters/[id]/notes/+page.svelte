<script lang="ts">
  /*
   * The matter's notes: what the firm wrote down about this case that no other record holds.
   *
   * A note is edited in place and deleted outright. There is no version history and no withdrawal
   * tombstone: an edit replaces the words, and a delete removes the note.
   *
   * TWO TIMES, KEPT APART. `createdAt` is when somebody typed the note. The occurrence is when the
   * thing it describes happened, which is frequently an earlier day, and it is what the list and the
   * matter's activity history order by. A note about Tuesday's call belongs beside Tuesday.
   *
   * THE COMPOSER SHOWS EVERYTHING THE NOTE WILL CARRY, generated fields included: which matter it
   * lands on, whose name goes on it, and the instant it will be stamped with. A person writing a
   * record that may be read years later should not have to guess what is being stored alongside
   * their words.
   *
   * Attaching a document points at a file the matter already holds. Nothing is uploaded here and
   * nothing is copied: the document stays in the matter's files with everything that follows from
   * being there, and detaching ends the association without touching it.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no
   * firm behind it and therefore nothing to read; it says so rather than showing an empty list.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Textarea from "@magna-carta/design-system/textarea";
  import * as Select from "@magna-carta/design-system/select";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import NoteDeleteDialog from "$lib/matters/note-delete-dialog.svelte";
  import {
    attachNoteDocument,
    createMatterNote,
    detachNoteDocument,
    editMatterNote,
    listMatterNotes,
    newWriteKey,
    viewerTimeZone,
    type MatterNote,
  } from "$lib/matters/notes-api.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const noteList = new PagedList<MatterNote>("The notes on this matter could not be read.");
  const roster = new FirmRoster();

  const notes = $derived(noteList.items);
  const failure = $derived(noteList.failure);

  // The matter's documents, for the attach picker. Read once when the section opens.
  let matterFiles = $state<MatterFile[] | null>(null);
  // Who is writing. The composer names them because the note will, and a person should not have to
  // guess whose name is going on a record that may be read years from now.
  let session = $state<SessionBootstrap | null>(null);

  // Composing. The composer exists only while it is in use: its absence is what the primary action
  // is for.
  let composing = $state(false);
  let draft = $state("");
  let draftOccurredOn = $state("");
  let draftOccurredAtTime = $state("");
  let saving = $state(false);
  let writeFailure = $state<StatedFailure | null>(null);
  // The instant the note will be stamped with, shown live so the composer is not describing a
  // moment that has already passed by the time somebody presses Save.
  let composerNow = $state(new Date().toISOString());

  $effect(() => {
    if (!composing) return;
    const tick = setInterval(() => {
      composerNow = new Date().toISOString();
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  });

  // Editing an existing note, keyed by note so only the one being edited turns into a field.
  let editingNoteId = $state<string | null>(null);
  let editDraft = $state("");
  let editOccurredOn = $state("");
  let editOccurredAtTime = $state("");

  let deleting = $state<MatterNote | null>(null);
  let deleteOpen = $state(false);

  // Which note's attach picker is open, and what it has selected.
  let attachingNoteId = $state<string | null>(null);

  // Finding a note again on this matter.
  let searchTerm = $state("");
  let appliedSearch = $state("");
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const matterId = matter.id;
    if (noteList.showing(matterId)) return;
    noteList.reset(matterId);
    composing = false;
    draft = "";
    draftOccurredOn = "";
    draftOccurredAtTime = "";
    editingNoteId = null;
    attachingNoteId = null;
    searchTerm = "";
    appliedSearch = "";
    writeFailure = null;
    matterFiles = null;
    if (isSample) {
      noteList.settleEmpty();
      matterFiles = [];
      return;
    }
    void readSession(fetch).then((outcome) => {
      session = outcome.kind === "ok" ? outcome.value : null;
    });
    void noteList.load((cursor) => listMatterNotes(fetch, matterId, cursor));
    void roster.load(fetch);
    void listMatterFiles(fetch, matterId).then((outcome) => {
      // A failed file read never fails the screen: notes still read, and the attach control says
      // what it cannot offer rather than disappearing.
      matterFiles = outcome.kind === "ok" ? outcome.value.data : [];
    });
  });

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

  // The name that will go on the note, as the note will carry it. Falls back to a plain word rather
  // than an account handle while the read is in flight: a handle is not a name and never reads as one.
  const myName = $derived(session?.user.name ?? "You");
  // Writing, editing, deleting and attaching are one permission. A member without it still reads the
  // matter's notes, so the controls are absent rather than present-and-refusing.
  const canWrite = $derived(session === null || session.permissions.includes("notes:write"));

  /*
   * The matter header's New Note opens the composer; this screen keeps no button for it. The
   * composer exists only while it is in use, so while one is open the control says so rather than
   * opening a second.
   */
  claimMatterCreate("notes", () => ({
    title: "Write a note on this matter. It is stamped with your name and the moment it is saved.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : !canWrite
        ? "Writing a note needs the notes:write permission, which this account does not hold."
        : composing
          ? "A note is being written below. Save it or cancel it first."
          : undefined,
    run: () => {
      composerNow = new Date().toISOString();
      composing = true;
    },
  }));

  function refresh(): void {
    const matterId = matter.id;
    const term = appliedSearch;
    noteList.reset(matterId);
    void noteList.load((cursor) => listMatterNotes(fetch, matterId, cursor, term));
  }

  // The occurrence as the server takes it: all three together or none at all. A time with no date is
  // refused server-side, so the composer simply does not send one.
  function occurrenceOf(
    occurredOn: string,
    occurredAtTime: string,
  ): { occurredOn: string | null; occurredAtTime: string | null; timeZone: string | null } {
    if (occurredOn.trim().length === 0) return { occurredOn: null, occurredAtTime: null, timeZone: null };
    if (occurredAtTime.trim().length === 0) {
      return { occurredOn: occurredOn, occurredAtTime: null, timeZone: null };
    }
    return { occurredOn, occurredAtTime, timeZone: viewerTimeZone() };
  }

  async function saveNote(): Promise<void> {
    if (draft.trim().length === 0 || saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await createMatterNote(
      fetch,
      matter.id,
      { body: draft.trim(), ...occurrenceOf(draftOccurredOn, draftOccurredAtTime) },
      newWriteKey(),
    );
    saving = false;
    if (outcome.kind === "ok") {
      draft = "";
      draftOccurredOn = "";
      draftOccurredAtTime = "";
      composing = false;
      refresh();
      return;
    }
    writeFailure = stated(outcome.failure, "The note was not written.");
  }

  async function saveEdit(noteId: string): Promise<void> {
    if (editDraft.trim().length === 0 || saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await editMatterNote(
      fetch,
      noteId,
      { body: editDraft.trim(), ...occurrenceOf(editOccurredOn, editOccurredAtTime) },
      newWriteKey(),
    );
    saving = false;
    if (outcome.kind === "ok") {
      editingNoteId = null;
      refresh();
      return;
    }
    writeFailure = stated(outcome.failure, "The note was not changed.");
  }

  function beginEdit(note: MatterNote): void {
    editingNoteId = note.id;
    editDraft = note.body;
    editOccurredOn = note.occurredOn ?? "";
    editOccurredAtTime = note.occurredAtTime ?? "";
    writeFailure = null;
  }

  async function attach(noteId: string, fileId: string): Promise<void> {
    if (saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await attachNoteDocument(fetch, noteId, fileId, newWriteKey());
    saving = false;
    attachingNoteId = null;
    if (outcome.kind === "ok") {
      refresh();
      return;
    }
    writeFailure = stated(outcome.failure, "The document was not attached.");
  }

  async function detach(attachmentId: string): Promise<void> {
    if (saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await detachNoteDocument(fetch, attachmentId, newWriteKey());
    saving = false;
    if (outcome.kind === "ok") {
      refresh();
      return;
    }
    writeFailure = stated(outcome.failure, "The document was not detached.");
  }

  function applySearch(term: string): void {
    appliedSearch = term;
    const matterId = matter.id;
    noteList.reset(matterId);
    void noteList.load((cursor) => listMatterNotes(fetch, matterId, cursor, term));
  }

  // Debounced, so a term typed a character at a time is one read rather than eight.
  function onSearchInput(): void {
    clearTimeout(searchTimer);
    const term = searchTerm;
    searchTimer = setTimeout(() => {
      if (term.trim() !== appliedSearch.trim()) applySearch(term.trim());
    }, 250);
  }

  function clearSearch(): void {
    clearTimeout(searchTimer);
    searchTerm = "";
    applySearch("");
  }

  // What the attach picker may offer: the matter's files, minus the ones this note already carries.
  function attachableFor(note: MatterNote): MatterFile[] {
    const already = new Set(note.documents.map((document) => document.fileId));
    return (matterFiles ?? []).filter((file) => !already.has(file.id));
  }

  // When the thing happened, as one line. Null where the note names no moment.
  function occurrenceText(note: MatterNote): string | null {
    if (note.occurredOn === null) return null;
    if (note.occurredAtTime === null) return formatDate(note.occurredOn);
    return `${formatDate(note.occurredOn)}, ${note.occurredAtTime}${
      note.timeZone === null ? "" : ` (${note.timeZone})`
    }`;
  }
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
      <div class="flex items-center gap-4">
        <Search aria-hidden="true" class="size-16 text-text-muted" />
        <Input
          bind:value={searchTerm}
          oninput={onSearchInput}
          disabled={isSample}
          aria-label="Search this matter's notes"
          class="w-192"
        />
        <!-- Present only while something is narrowing the list, so its absence answers "is
             anything hidden". -->
        {#if appliedSearch !== ""}
          <Button variant="ghost" onclick={clearSearch} title="Clear the search">
            <X aria-hidden="true" />
          </Button>
        {/if}
      </div>
    </div>
    <!-- Opening the composer is the matter header's New Note; only the way out of it lives here. -->
    {#if composing}
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          composing = false;
          draft = "";
          draftOccurredOn = "";
          draftOccurredAtTime = "";
        }}
      >
        Cancel
      </Button>
    {/if}
  </div>

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      title="Nothing Changed"
      fallback={writeFailure.fallback}
    />
  {/if}

  {#if composing}
    <!-- Everything the note will carry, generated fields included, so nothing is stored that the
         writer was not shown. -->
    <div class="flex flex-col gap-12 rounded-md border border-border-strong p-16">
      <dl class="flex flex-wrap gap-x-24 gap-y-4 text-xs">
        <div class="flex gap-4">
          <dt class="text-text-muted">Matter</dt>
          <dd>{matter.title}</dd>
        </div>
        <div class="flex gap-4">
          <dt class="text-text-muted">Written by</dt>
          <dd>{myName}</dd>
        </div>
        <div class="flex gap-4">
          <dt class="text-text-muted">Written</dt>
          <dd>
            <time datetime={instantAttribute(composerNow)}>{formatInstant(composerNow)}</time>
          </dd>
        </div>
      </dl>

      <div class="flex flex-col gap-4">
        <Label for="note-body">Note</Label>
        <Textarea id="note-body" bind:value={draft} rows={5} disabled={saving} />
      </div>

      <div class="flex flex-wrap items-end gap-16">
        <div class="flex flex-col gap-4">
          <Label for="note-occurred-on">When It Happened</Label>
          <Input
            id="note-occurred-on"
            type="date"
            bind:value={draftOccurredOn}
            disabled={saving}
            class="w-160"
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="note-occurred-at">Time</Label>
          <Input
            id="note-occurred-at"
            type="time"
            bind:value={draftOccurredAtTime}
            disabled={saving || draftOccurredOn.trim().length === 0}
            class="w-128"
          />
        </div>
        {#if draftOccurredAtTime.trim().length > 0}
          <p class="text-xs text-text-muted">Read in {viewerTimeZone()}.</p>
        {/if}
      </div>

      <div class="flex justify-end">
        <Button
          variant="primary"
          disabled={draft.trim().length === 0 || saving}
          onclick={() => void saveNote()}
        >
          Save Note
        </Button>
      </div>
    </div>
  {/if}

  {#if failure !== null}
    <FailureNotice
      {failure}
      title="Notes Unavailable"
      fallback="The notes on this matter could not be read."
      onRetry={refresh}
    />
  {/if}

  <div class="flex min-h-0 flex-1 flex-col gap-8">
    {#if isSample}
      <EmptyState title="This is a sample matter, so it has no notes." />
    {:else if notes === null}
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-full" />
    {:else if notes.length === 0 && appliedSearch !== ""}
      <EmptyState title="No notes on this matter match that search." />
    {:else if notes.length === 0}
      <EmptyState title="No notes on this matter yet." />
    {:else}
      {#each notes as note (note.id)}
        {@const happened = occurrenceText(note)}
        <article class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
          <div class="flex flex-wrap items-center justify-between gap-8">
            <div class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
              <span class="text-text-default">{nameOf(note.authorUserId)}</span>
              {#if hasLeft(note.authorUserId)}
                <Badge variant="neutral">No Longer With The Firm</Badge>
              {/if}
              {#if happened !== null}
                <span class="text-text-default">{happened}</span>
                <span>written <time datetime={instantAttribute(note.createdAt)}>{formatInstant(note.createdAt)}</time></span>
              {:else}
                <time datetime={instantAttribute(note.createdAt)}>{formatInstant(note.createdAt)}</time>
              {/if}
            </div>

            {#if canWrite}
            <div class="flex items-center gap-8">
              <Button
                variant="ghost"
                disabled={saving || attachableFor(note).length === 0}
                onclick={() => {
                  attachingNoteId = attachingNoteId === note.id ? null : note.id;
                }}
              >
                <Paperclip aria-hidden="true" />
                Attach
              </Button>
              <Button variant="ghost" disabled={saving} onclick={() => beginEdit(note)}>
                <PencilLine aria-hidden="true" />
                Edit
              </Button>
              <Button
                variant="ghost"
                onclick={() => {
                  deleting = note;
                  deleteOpen = true;
                }}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </div>
            {/if}
          </div>

          {#if editingNoteId === note.id}
            <div class="flex flex-col gap-12">
              <Textarea bind:value={editDraft} rows={5} disabled={saving} aria-label="Note" />
              <div class="flex flex-wrap items-end gap-16">
                <div class="flex flex-col gap-4">
                  <Label for="note-edit-occurred-on">When It Happened</Label>
                  <Input
                    id="note-edit-occurred-on"
                    type="date"
                    bind:value={editOccurredOn}
                    disabled={saving}
                    class="w-160"
                  />
                </div>
                <div class="flex flex-col gap-4">
                  <Label for="note-edit-occurred-at">Time</Label>
                  <Input
                    id="note-edit-occurred-at"
                    type="time"
                    bind:value={editOccurredAtTime}
                    disabled={saving || editOccurredOn.trim().length === 0}
                    class="w-128"
                  />
                </div>
              </div>
              <div class="flex justify-end gap-8">
                <Button
                  variant="secondary"
                  disabled={saving}
                  onclick={() => {
                    editingNoteId = null;
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={editDraft.trim().length === 0 || saving}
                  onclick={() => void saveEdit(note.id)}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          {:else}
            <p class="text-sm whitespace-pre-wrap">{note.body}</p>
            {#if note.lastEditedBy !== null}
              <p class="text-xs text-text-muted">
                Edited by {nameOf(note.lastEditedBy)},
                <time datetime={instantAttribute(note.updatedAt)}>{formatInstant(note.updatedAt)}</time>.
              </p>
            {/if}
          {/if}

          {#if note.documents.length > 0}
            <ul class="flex flex-wrap gap-8 border-t border-border-strong pt-8">
              {#each note.documents as document (document.id)}
                <li class="flex items-center gap-4 text-xs">
                  <Paperclip aria-hidden="true" class="size-12 text-text-muted" />
                  <span>{document.fileName}</span>
                  <Button
                    variant="ghost"
                    disabled={saving}
                    title="Stop this note pointing at {document.fileName}"
                    onclick={() => void detach(document.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              {/each}
            </ul>
          {/if}

          {#if attachingNoteId === note.id}
            <div class="flex flex-col gap-4 border-t border-border-strong pt-8">
              <Label for="note-attach-{note.id}">Attach A Document</Label>
              <Select.Root
                type="single"
                onValueChange={(value) => {
                  if (value !== undefined) void attach(note.id, value);
                }}
              >
                <Select.Trigger id="note-attach-{note.id}" class="w-320">
                  Choose a document on this matter
                </Select.Trigger>
                <Select.Content>
                  {#each attachableFor(note) as file (file.id)}
                    <Select.Item value={file.id} label={file.name}>{file.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
          {/if}
        </article>
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
  </div>
</section>

<NoteDeleteDialog
  bind:open={deleteOpen}
  note={deleting}
  authorName={deleting === null ? "" : nameOf(deleting.authorUserId)}
  onDeleted={refresh}
/>
