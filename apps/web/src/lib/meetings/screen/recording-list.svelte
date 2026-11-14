<script lang="ts">
  /*
   * What has been recorded in one meeting: a reading panel over the product's one grid, opened from
   * the room's header and from an ended meeting's row on the Meetings page.
   *
   * IT IS ONE COMPONENT FOR BOTH PLACES, because a recording read in the room and the same recording
   * read a week later on the Meetings page are one record, and two lists would be two spellings of
   * what happened to it. The words live in `recording-list.ts`; this draws them.
   *
   * WHAT A RECORDING BECAME IS THE DOCUMENT ITSELF. Once it is added to the matter and the scan has
   * let it through, the row opens the document through the file's own route, beside the reader's
   * work, and the browser plays it. There is no player here: the file on the matter is the record,
   * and it is scanned and listed like any upload. A document still being checked, or held, says so
   * in the same place and offers nothing to open; a recording that failed says its Error ID there.
   *
   * IT READS WHEN IT OPENS, and pages on from there. In the room it is also handed what the room last
   * announced about its recording, and reads again when that changes while it is open: the list is a
   * record of exactly those transitions, so a panel that kept its first answer would show a recording
   * as still running after everybody heard it stop.
   *
   * A RECORDING ON THE MATTER HAS A TRANSCRIPT, and its column says where it stands. Pressing it
   * opens the transcript panel over this one, the way a row's own gesture opens who was told: a ready
   * transcript is read there, one still being made is watched there until it settles (and this list
   * is read again the moment it does), and a failed one states its Error ID there.
   *
   * A READY TRANSCRIPT HAS A SUMMARY, and its column says where that stands on the same terms: pressing
   * it opens the summary panel over this one. Whether the reader may write it again, and whose name a
   * task made of an action item may carry, are read from the shared session here rather than handed
   * down, because this panel is opened from two screens and the answer is the session's, not theirs.
   *
   * THE TABLE STANDS BEFORE THE ROWS DO. Loading draws the grid's own placeholder rows, and a meeting
   * with nothing recorded says "No Results" inside the frame it would have filled; only a read that
   * failed replaces the table, because an empty frame over a failure says nothing was recorded when
   * nobody could tell.
   */
  import { untrack } from "svelte";
  import { createInfiniteQuery } from "@tanstack/svelte-query";
  import { meetingsListRecordingsInfiniteOptions } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import FileVolume from "@lucide/svelte/icons/file-volume";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import NotebookText from "@lucide/svelte/icons/notebook-text";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { failureOf } from "$lib/api/api-client.ts";
  import { paged } from "$lib/api/screen-data.ts";
  import {
    RECORDING_STATE_WORDS,
    recordingDocumentAddress,
    recordingDocumentText,
    recordingStateWord,
    recordingStopText,
    recordingSummaryOpens,
    recordingSummaryText,
    recordingTranscriptOpens,
    recordingTranscriptText,
  } from "./recording-list.ts";
  import SummaryPanel from "./summary-panel.svelte";
  import TranscriptPanel from "./transcript-panel.svelte";
  import type { MeetingRecordingListView, MeetingRecordingView } from "../meetings-api.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";

  let {
    open = $bindable(false),
    meetingId,
    subject,
    announced,
    insideRoom = false,
    onWhoWasTold,
  }: {
    open?: boolean;
    /** Whether the list is drawn inside a meeting room, where leaving the page hangs up the call. */
    insideRoom?: boolean;
    /** The meeting whose recordings these are. */
    meetingId: string;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /**
     * What the room last announced about its recording, where the panel is drawn inside the room. A
     * change while the panel is open reads the list again. Left out on a screen with no room behind
     * it.
     */
    announced?: unknown;
    /**
     * Open the record of who was told about one recording. Offered by a screen whose reader may see
     * it — it names everybody who was in the room — and reached by the row's own gesture.
     */
    onWhoWasTold?: (recording: MeetingRecordingView) => void;
  } = $props();

  const recordingsRead = createInfiniteQuery(() => ({
    ...paged(meetingsListRecordingsInfiniteOptions({ path: { meetingId } })),
    enabled: open && meetingId !== "",
    // Every opening reads afresh: a recording moves from being put together to being on the matter
    // while nobody is looking, and an answer kept from the last opening would say it had not.
    staleTime: 0,
  }));

  /*
   * Read again when the room announces a transition while the panel is open. Not on opening: the
   * query reads then on its own, and a second read in the same instant is the same answer twice.
   */
  let lastAnnounced: unknown = untrack(() => announced);
  $effect(() => {
    const now = announced;
    if (now === lastAnnounced) return;
    lastAnnounced = now;
    if (!untrack(() => open)) return;
    untrack(() => {
      void recordingsRead.refetch();
    });
  });

  // The session answers who may write a summary again and whose name a task may carry. Read once
  // the panel opens, and shared with every other surface that asks.
  $effect(() => {
    if (open) void sessionPermissions.load(fetch);
  });
  const canHost = $derived(sessionPermissions.holds("meetings:host"));
  const canAssign = $derived(sessionPermissions.holds("tasks:assign"));
  const viewerUserId = $derived(sessionPermissions.session?.user.id ?? null);

  /** The recording whose transcript is open over this panel, if any. */
  let transcriptOf = $state<MeetingRecordingListView | null>(null);
  let transcriptOpen = $state(false);

  function openTranscript(recording: MeetingRecordingListView): void {
    transcriptOf = recording;
    transcriptOpen = true;
  }

  /** The recording whose summary is open over this panel, if any. */
  let summaryOf = $state<MeetingRecordingListView | null>(null);
  let summaryOpen = $state(false);

  function openSummary(recording: MeetingRecordingListView): void {
    summaryOf = recording;
    summaryOpen = true;
  }

  /** The recording a panel over this one is about: this panel's subject, and when it started. */
  function recordingSubject(recording: MeetingRecordingListView | null): RecordSubject {
    return recording === null
      ? subject
      : { ...subject, facts: [...(subject.facts ?? []), formatInstant(recording.startedAt)] };
  }

  const transcriptSubject = $derived<RecordSubject>(recordingSubject(transcriptOf));
  const summarySubject = $derived<RecordSubject>(recordingSubject(summaryOf));

  const rows = $derived<MeetingRecordingListView[]>(
    (recordingsRead.data?.pages ?? []).flatMap((page) => page.data),
  );

  const grid = DataTable.createDataTableGrid<MeetingRecordingListView>({
    columns: () => [
      {
        id: "state",
        label: "State",
        type: "text",
        anchored: true,
        // A declared vocabulary, so the filter offers every state whether or not a row is in it.
        filterValues: Object.values(RECORDING_STATE_WORDS),
        value: (row) => recordingStateWord(row),
      },
      {
        id: "document",
        label: "Document",
        type: "text",
        filter: "none",
        value: (row) => recordingDocumentText(row),
      },
      {
        id: "transcript",
        label: "Transcript",
        type: "text",
        filter: "none",
        value: (row) => recordingTranscriptText(row),
      },
      {
        id: "summary",
        label: "Summary",
        type: "text",
        filter: "none",
        value: (row) => recordingSummaryText(row),
      },
      {
        id: "started",
        label: "Started",
        type: "date",
        value: (row) => row.startedAt,
        text: (row) => formatInstant(row.startedAt),
      },
      {
        id: "startedBy",
        label: "Started By",
        type: "text",
        value: (row) => row.startedBy.displayName,
      },
      {
        id: "stopped",
        label: "Stopped",
        type: "date",
        value: (row) => row.stoppedAt,
        text: (row) => (row.stoppedAt === null ? "" : formatInstant(row.stoppedAt)),
      },
      {
        id: "howItStopped",
        label: "How It Stopped",
        type: "text",
        value: (row) => recordingStopText(row),
      },
    ],
    rows: () => rows,
    rowKey: (row) => row.id,
    // Read once: the newest recording first, which is the one somebody opening the panel asks about.
    initialSort: untrack(() => ({ columnId: "started", direction: "descending" as const })),
    itemNoun: { singular: "recording", plural: "recordings" },
    onActivate: (row) => onWhoWasTold?.(row),
  });
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<MeetingRecordingListView>)}
  {@const address = column.id === "document" ? recordingDocumentAddress(row) : null}
  {#if column.id === "transcript" && recordingTranscriptOpens(row)}
    <!-- The transcript, in a panel over this one. The row's own gesture opens who was told, so this
         stops the press reaching it, as the document's control does. -->
    <Button
      variant="ghost"
      size="sm"
      aria-label={`${text}: the transcript of the recording started ${formatInstant(row.startedAt)}`}
      onclick={(event: MouseEvent) => {
        event.stopPropagation();
        openTranscript(row);
      }}
      ondblclick={(event: MouseEvent) => event.stopPropagation()}
    >
      <ScrollText class="size-16" aria-hidden="true" />
      {text}
    </Button>
  {:else if column.id === "summary" && recordingSummaryOpens(row)}
    <!-- The summary, in a panel over this one, on the transcript's terms: the press is the summary's
         and never reaches the row's own gesture. -->
    <Button
      variant="ghost"
      size="sm"
      aria-label={`${text}: the summary of the recording started ${formatInstant(row.startedAt)}`}
      onclick={(event: MouseEvent) => {
        event.stopPropagation();
        openSummary(row);
      }}
      ondblclick={(event: MouseEvent) => event.stopPropagation()}
    >
      <NotebookText class="size-16" aria-hidden="true" />
      {text}
    </Button>
  {:else if address !== null}
    <!-- The document on the matter, through the file's own route and beside the reader's work: the
         browser plays it, and what it plays is the file the matter holds rather than a copy. The
         row's own gesture opens who was told, so this stops the press reaching it. -->
    <Button
      variant="ghost"
      size="sm"
      href={address}
      {...opensBeside("file")}
      aria-label={`Open the recording started ${formatInstant(row.startedAt)}`}
      onclick={(event: MouseEvent) => event.stopPropagation()}
      ondblclick={(event: MouseEvent) => event.stopPropagation()}
    >
      <FileVolume class="size-16" aria-hidden="true" />
      {text}
    </Button>
  {:else}
    {text}
  {/if}
{/snippet}

<ActionDialog bind:open kind="reading" heading="Recordings" subtitle={subject} width="wide">
  {#snippet fields()}
    {#if recordingsRead.isError}
      <FailureNotice
        failure={failureOf(recordingsRead.error)}
        subject="This meeting"
        fallback="Couldn't load this meeting's recordings."
        whenSilent="Couldn't connect. Couldn't load this meeting's recordings. Try again."
        onRetry={() => void recordingsRead.refetch()}
      />
    {:else}
      <div class="flex flex-col gap-8">
        <DataTable.Grid
          {grid}
          {cell}
          caption="What has been recorded in this meeting"
          loading={recordingsRead.isPending}
          placeholderCount={2}
        />
        <DataTable.GridFooter {grid}>
          {#snippet end()}
            <DataTable.LoadMore
              noun="recordings"
              more={recordingsRead.hasNextPage}
              loading={recordingsRead.isFetchingNextPage}
              onLoad={() => void recordingsRead.fetchNextPage()}
            />
          {/snippet}
        </DataTable.GridFooter>
      </div>
    {/if}
  {/snippet}
</ActionDialog>

<TranscriptPanel
  bind:open={transcriptOpen}
  {meetingId}
  recordingId={transcriptOf?.id ?? ""}
  subject={transcriptSubject}
  onSettled={() => void recordingsRead.refetch()}
/>

<SummaryPanel
  bind:open={summaryOpen}
  {meetingId}
  recordingId={summaryOf?.id ?? ""}
  subject={summarySubject}
  {canHost}
  {canAssign}
  {viewerUserId}
  {insideRoom}
  onChanged={() => void recordingsRead.refetch()}
/>
