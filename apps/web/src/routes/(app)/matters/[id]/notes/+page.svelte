<script lang="ts">
  /*
   * The matter's notes: what the firm wrote down about this case that no other record holds.
   *
   * A note is a chain rather than a field, and the whole screen follows from that. Correcting one
   * adds a version and keeps the earlier one, so a corrected note says how many versions it has and
   * offers them; nothing here overwrites anything, and there is no delete control because the server
   * has no delete route.
   *
   * Withdrawing is the one consequential act, and it is the answer to text that should never have
   * been typed. A withdrawn note keeps its place in the list as a tombstone carrying who wrote it,
   * who withdrew it, and why: the firm can see that something came down and by whose hand, which is
   * what makes withdrawal a correction rather than a quiet erasure. Its body never arrives at this
   * screen at all, because the server nulls it rather than trusting the client to hide it.
   *
   * Attribution is resolved against the firm roster, and a note whose author has left says so. A
   * colleague reading a name needs to know they cannot go and ask that person.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no
   * firm behind it and therefore nothing to read; it says so rather than showing an empty list.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { Failure } from "$lib/api/request.ts";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Textarea from "@magna-carta/design-system/textarea";
  import Input from "@magna-carta/design-system/input";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import Plus from "@lucide/svelte/icons/plus";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import History from "@lucide/svelte/icons/history";
  import Ban from "@lucide/svelte/icons/ban";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import NoteRetractDialog from "$lib/matters/note-retract-dialog.svelte";
  import {
    createMatterNote,
    listMatterNotes,
    listNoteRevisions,
    newWriteKey,
    reviseMatterNote,
    type MatterNote,
    type MatterNoteRevision,
  } from "$lib/matters/notes-api.ts";
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

  // Composing a new note. The composer exists only while it is in use: its absence is what the
  // primary action is for.
  let composing = $state(false);
  let draft = $state("");
  let saving = $state(false);
  let writeFailure = $state<StatedFailure | null>(null);

  // Correcting an existing one, keyed by note so only the note being corrected turns into a field.
  let revisingNoteId = $state<string | null>(null);
  let revisionDraft = $state("");

  // Expanded histories, and the revisions read for them. A history is fetched once per note.
  let openHistory = $state<string | null>(null);
  let revisions = $state<Record<string, { entries: MatterNoteRevision[]; capped: boolean }>>({});
  let historyFailure = $state<StatedFailure | null>(null);

  let retracting = $state<MatterNote | null>(null);
  let retractOpen = $state(false);

  // Finding a note again on this matter. The term is applied by the server against the notes'
  // current text; it is held here so the list can be re-read when it settles.
  let searchTerm = $state("");
  let appliedSearch = $state("");
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

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

  $effect(() => {
    const matterId = matter.id;
    if (noteList.showing(matterId)) return;
    noteList.reset(matterId);
    composing = false;
    draft = "";
    searchTerm = "";
    appliedSearch = "";
    revisingNoteId = null;
    openHistory = null;
    revisions = {};
    writeFailure = null;
    if (isSample) {
      noteList.settleEmpty();
      return;
    }
    void noteList.load((cursor) => listMatterNotes(fetch, matterId, cursor));
    void roster.load(fetch);
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

  function refresh(): void {
    const matterId = matter.id;
    const term = appliedSearch;
    noteList.reset(matterId);
    void noteList.load((cursor) => listMatterNotes(fetch, matterId, cursor, term));
  }

  function refusalText(
    outcome: { kind: "transport"; failure: Failure } | { kind: "problem"; failure: Failure },
    whenSilent: string,
  ): StatedFailure {
    return stated(outcome.failure, whenSilent);
  }

  async function saveNote(): Promise<void> {
    if (draft.trim().length === 0 || saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await createMatterNote(fetch, matter.id, draft.trim(), newWriteKey());
    saving = false;
    if (outcome.kind === "ok") {
      draft = "";
      composing = false;
      refresh();
      return;
    }
    writeFailure = refusalText(outcome, "The note was not written.");
  }

  async function saveRevision(noteId: string): Promise<void> {
    if (revisionDraft.trim().length === 0 || saving) return;
    saving = true;
    writeFailure = null;
    const outcome = await reviseMatterNote(fetch, noteId, revisionDraft.trim(), newWriteKey());
    saving = false;
    if (outcome.kind === "ok") {
      revisingNoteId = null;
      revisionDraft = "";
      // The chain moved, so a history already on screen is stale.
      revisions = Object.fromEntries(
        Object.entries(revisions).filter(([key]) => key !== noteId),
      );
      refresh();
      return;
    }
    writeFailure = refusalText(outcome, "The note was not revised and is unchanged.");
  }

  async function toggleHistory(noteId: string): Promise<void> {
    if (openHistory === noteId) {
      openHistory = null;
      return;
    }
    openHistory = noteId;
    historyFailure = null;
    if (revisions[noteId] !== undefined) return;
    const outcome = await listNoteRevisions(fetch, noteId);
    if (outcome.kind === "ok") {
      revisions = {
        ...revisions,
        [noteId]: { entries: outcome.value.data, capped: outcome.value.capped },
      };
      return;
    }
    historyFailure = refusalText(outcome, "The earlier versions could not be read.");
  }

  function beginRevision(note: MatterNote): void {
    revisingNoteId = note.id;
    revisionDraft = note.body ?? "";
    writeFailure = null;
  }

  function beginRetraction(note: MatterNote): void {
    retracting = note;
    retractOpen = true;
  }
</script>

<svelte:head>
  <title>Notes · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex min-h-0 flex-1 flex-col gap-16">
  <div class="flex items-center justify-between gap-16 border-b border-border-strong pb-8">
    <div class="flex items-center gap-16">
      <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Notes
      </h2>
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
    {#if composing}
      <Button variant="secondary" disabled={saving} onclick={() => { composing = false; draft = ""; }}>
        Cancel
      </Button>
    {:else}
      <Button variant="secondary" disabled={isSample} onclick={() => { composing = true; }}>
        <Plus aria-hidden="true" />
        Write Note
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
    <div class="flex flex-col gap-8">
      <Textarea bind:value={draft} rows={5} disabled={saving} aria-label="Note" />
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
      fallback={noteList.failureMessage ?? undefined}
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
        <article class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
          <div class="flex flex-wrap items-center justify-between gap-8">
            <div class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
              <span class="text-text-default">{nameOf(note.authorUserId)}</span>
              {#if hasLeft(note.authorUserId)}
                <Badge variant="neutral">No Longer With The Firm</Badge>
              {/if}
              <time datetime={instantAttribute(note.createdAt)}>{formatInstant(note.createdAt)}</time>
              {#if note.state === "active" && note.revisionCount > 1}
                <span>Version {note.revisionCount}</span>
              {/if}
            </div>

            {#if note.state === "active"}
              <div class="flex items-center gap-8">
                {#if note.revisionCount > 1}
                  <Button variant="ghost" onclick={() => void toggleHistory(note.id)}>
                    <History aria-hidden="true" />
                    {openHistory === note.id ? "Hide History" : "History"}
                  </Button>
                {/if}
                <Button variant="ghost" disabled={saving} onclick={() => beginRevision(note)}>
                  <PencilLine aria-hidden="true" />
                  Correct
                </Button>
                <Button variant="ghost" onclick={() => beginRetraction(note)}>
                  <Ban aria-hidden="true" />
                  Withdraw
                </Button>
              </div>
            {/if}
          </div>

          {#if note.state === "retracted"}
            <div class="flex flex-col gap-4 text-sm">
              <p class="text-text-muted">
                Withdrawn by {nameOf(note.retractedBy)}{note.retractedAt === null
                  ? ""
                  : `, ${formatInstant(note.retractedAt)}`}.
              </p>
              {#if note.retractionReason !== null}
                <p>{note.retractionReason}</p>
              {/if}
            </div>
          {:else if revisingNoteId === note.id}
            <div class="flex flex-col gap-8">
              <Textarea bind:value={revisionDraft} rows={5} disabled={saving} aria-label="Note" />
              <div class="flex justify-end gap-8">
                <Button
                  variant="secondary"
                  disabled={saving}
                  onclick={() => { revisingNoteId = null; revisionDraft = ""; }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={revisionDraft.trim().length === 0 || saving}
                  onclick={() => void saveRevision(note.id)}
                >
                  Save Correction
                </Button>
              </div>
            </div>
          {:else}
            <p class="text-sm whitespace-pre-wrap">{note.body}</p>
            {#if note.currentRevisionAuthorUserId !== null && note.currentRevisionAuthorUserId !== note.authorUserId}
              <p class="text-xs text-text-muted">
                Last corrected by {nameOf(note.currentRevisionAuthorUserId)}{note.currentRevisionCreatedAt ===
                null
                  ? ""
                  : `, ${formatInstant(note.currentRevisionCreatedAt)}`}.
              </p>
            {/if}
          {/if}

          {#if openHistory === note.id && note.state === "active"}
            {@const history = revisions[note.id]}
            {#if historyFailure !== null}
              <FailureNotice
                failure={historyFailure.failure}
                title="History Unavailable"
                fallback={historyFailure.fallback}
              />
            {:else if history === undefined}
              <Skeleton class="h-16 w-full" />
            {:else}
              <ol class="flex flex-col gap-8 border-t border-border-strong pt-8">
                {#if history.capped}
                  <li class="text-xs text-text-muted">
                    This note has more versions than are shown here.
                  </li>
                {/if}
                {#each history.entries as revision (revision.id)}
                  <li class="flex flex-col gap-4">
                    <p class="text-xs text-text-muted">
                      Version {revision.ordinal}, {nameOf(revision.authorUserId)},
                      <time datetime={instantAttribute(revision.createdAt)}>
                        {formatInstant(revision.createdAt)}
                      </time>
                    </p>
                    <p class="text-sm whitespace-pre-wrap">{revision.body}</p>
                  </li>
                {/each}
              </ol>
            {/if}
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

<NoteRetractDialog
  bind:open={retractOpen}
  note={retracting}
  authorName={retracting === null ? "" : nameOf(retracting.authorUserId)}
  onRetracted={refresh}
/>
