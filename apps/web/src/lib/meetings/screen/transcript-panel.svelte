<script lang="ts">
  /*
   * The transcript of one recording: a reading panel opened from the recording's row in the
   * Recordings panel, over it, the way who was told is opened from the same row.
   *
   * A TRANSCRIPT IS A CONVERSATION, drawn as the product draws every transcript: a speaker label over
   * the words, hairline-separated, no bubbles and no avatars, on a work surface where identity
   * recedes. Every turn is a person in the room, so there is one speaker kind; who is speaking is the
   * label. A GAP is a turn that will never get its words, and says whose audio is missing and for
   * how long in the warning register's subtle note, so a silence in the record is never taken for a
   * silence in the room. The words live in `transcript-panel.ts`.
   *
   * IT READS WHEN IT OPENS, in pages of two hundred lines, and pages on from the last line read.
   * While the transcript is still being made it says so, and asks again on a slow interval so the
   * panel a reader left open turns into the transcript without being closed; the moment it settles
   * the screen that opened it is told, so the row beneath agrees with the panel.
   *
   * THE STATES. Loading draws the transcript's own shape over sample words; a transcript still being
   * made, one that could not be made, and one whose lines the read withholds because the document it
   * became can no longer be read are facts about this recording rather than an absence of lines, so
   * each is the design system's empty state with its own title, the failure carrying its Error ID,
   * all decided by `transcriptBody`; a ready transcript with no lines says "No Results" inside its own frame; and a read
   * that failed (no transcript, a walled matter, nothing answering) is the failure notice with Retry.
   *
   * THE DOCUMENT ON THE MATTER. A ready transcript is also a WebVTT document filed beside the audio,
   * and the panel opens it beside the reader through the file's own route, on the one gate that may
   * open a new page. The file is the record the matter holds; this panel is a way of reading it.
   *
   * THE WORDS ARE PRIVILEGED. They reach the screen and nothing else: the read's address carries
   * the meeting, the recording and an ordinal cursor, a failure is reported from the response's
   * problem record, and nothing here writes to a log.
   */
  import { untrack } from "svelte";
  import { createInfiniteQuery } from "@tanstack/svelte-query";
  import { meetingsRecordingTranscriptInfiniteOptions } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import * as Conversation from "@magna-carta/design-system/conversation";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import NoResults from "@magna-carta/design-system/no-results";
  import { SAMPLE_SENTENCE, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import FileText from "@lucide/svelte/icons/file-text";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { failureOf } from "$lib/api/api-client.ts";
  import { paged } from "$lib/api/screen-data.ts";
  import {
    PENDING_TRANSCRIPT_REREAD_MILLISECONDS,
    transcriptBody,
    transcriptGapSentence,
    transcriptLines,
    transcriptOffset,
    transcriptOffsetAttribute,
    transcriptSettled,
    transcriptSpeakerLabel,
    type TranscriptBody,
  } from "./transcript-panel.ts";
  import type {
    MeetingTranscriptHeaderView,
    MeetingTranscriptLineView,
    MeetingTranscriptStateView,
  } from "../meetings-api.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";

  let {
    open = $bindable(false),
    meetingId,
    recordingId,
    subject,
    onSettled,
  }: {
    open?: boolean;
    /** The meeting the recording was made in. */
    meetingId: string;
    /** The recording whose transcript this is. Empty while no row has been chosen. */
    recordingId: string;
    /** Which recording this is about, named once. */
    subject: RecordSubject;
    /**
     * Told once when a transcript this panel watched being made becomes ready or fails, so the
     * screen that opened it can read its own list again.
     */
    onSettled?: () => void;
  } = $props();

  const transcriptRead = createInfiniteQuery(() => ({
    ...paged(meetingsRecordingTranscriptInfiniteOptions({ path: { meetingId, recordingId } })),
    enabled: open && meetingId !== "" && recordingId !== "",
    // Every opening reads afresh: a transcript settles while nobody is looking.
    staleTime: 0,
    // Only while it is being made, and only while the panel is open: a ready or failed transcript
    // does not change, and a closed panel has nobody to tell.
    refetchInterval: (query) =>
      open && query.state.data?.pages[0]?.transcript.state === "pending"
        ? PENDING_TRANSCRIPT_REREAD_MILLISECONDS
        : false,
  }));

  /** The header the read answered with. Every page carries it; the first is enough. */
  const header = $derived<MeetingTranscriptHeaderView | null>(
    transcriptRead.data?.pages[0]?.transcript ?? null,
  );

  const lines = $derived<readonly MeetingTranscriptLineView[]>(
    transcriptLines(transcriptRead.data?.pages ?? []),
  );

  /** The document a ready transcript became on the matter, opened through the file's own route. */
  const documentAddress = $derived(
    header !== null && header.state === "ready" && header.fileId !== null
      ? fileDownloadUrl(header.fileId)
      : null,
  );

  /*
   * What the body shows, from the one function that decides it: where the transcript stands, and
   * why the read withheld a ready transcript's lines where it did. With no header yet, the read is in
   * flight or failed, and the region's own fixture and failure stand instead of this body.
   */
  const body = $derived<TranscriptBody>(
    header === null
      ? { kind: "lines" }
      : transcriptBody(header, transcriptRead.data?.pages[0]?.linesWithheld ?? null),
  );

  /*
   * Tell the opener once when a transcript this panel watched being made settles. A different
   * recording starts the watch again, so one recording's settle is never reported as another's.
   */
  let watchedRecording = untrack(() => recordingId);
  let lastState: MeetingTranscriptStateView | null = null;
  $effect(() => {
    const now = header?.state ?? null;
    const forRecording = recordingId;
    if (forRecording !== watchedRecording) {
      watchedRecording = forRecording;
      lastState = now;
      return;
    }
    if (now === null) return;
    const before = lastState;
    lastState = now;
    if (transcriptSettled(before, now)) untrack(() => onSettled?.());
  });

  /** The transcript's shape over words that are plainly invented, for the read in flight. */
  const FIXTURE: readonly MeetingTranscriptLineView[] = [0, 1, 2].map((index) => ({
    id: `fixture-line-${String(index)}`,
    ordinal: index,
    kind: "speech" as const,
    startedMs: index * 14_000,
    endedMs: index * 14_000 + 12_000,
    text: SAMPLE_SENTENCE,
    speaker: {
      participantKind: "member" as const,
      participantId: `fixture-stay-${String(index)}`,
      userId: null,
      displayName: samplePerson(index).name,
    },
  }));
</script>

{#snippet fixture()}
  {@render transcript(FIXTURE)}
{/snippet}

{#snippet transcript(shown: readonly MeetingTranscriptLineView[])}
  <!-- Not a live region: a page of two hundred lines arriving on Load More is read where the reader
       goes to it, never aloud all at once. -->
  <Conversation.Transcript class="px-0" label="The transcript of this recording" aria-live="off">
    {#each shown as line (line.id)}
      {@const offset = transcriptOffset(line.startedMs)}
      {#if line.kind === "gap"}
        <!-- A gap names nobody in its label: the sentence beneath says whose audio is missing, once. -->
        <Conversation.Turn speaker="member" state="failed">
          <span class="text-xs text-text-muted tabular-nums">
            <time datetime={transcriptOffsetAttribute(line.startedMs)}>{offset}</time>
          </span>
          <Conversation.TurnNote tone="warning">{transcriptGapSentence(line)}</Conversation.TurnNote>
        </Conversation.Turn>
      {:else}
        <Conversation.Turn speaker="member">
          <div class="flex items-baseline gap-8">
            <Conversation.TurnSpeaker class="min-w-0 flex-1 truncate">
              {transcriptSpeakerLabel(line.speaker)}
            </Conversation.TurnSpeaker>
            <span class="text-xs text-text-muted tabular-nums">
              <time datetime={transcriptOffsetAttribute(line.startedMs)}>{offset}</time>
            </span>
          </div>
          <Conversation.TurnBody>{line.text}</Conversation.TurnBody>
        </Conversation.Turn>
      {/if}
    {:else}
      <NoResults />
    {/each}
    {#if transcriptRead.hasNextPage}
      <!-- At the end of the lines read so far, where a reader arrives wanting the rest. -->
      <div class="flex justify-center pt-8">
        <DataTable.LoadMore
          noun="lines"
          more
          loading={transcriptRead.isFetchingNextPage}
          onLoad={() => void transcriptRead.fetchNextPage()}
        />
      </div>
    {/if}
  </Conversation.Transcript>
{/snippet}

<ActionDialog bind:open kind="reading" heading="Transcript" subtitle={subject} width="wide">
  {#snippet fields()}
    <LoadingRegion
      loading={transcriptRead.isPending}
      failed={transcriptRead.isError}
      label="Reading this recording's transcript"
      {fixture}
      onRetry={() => void transcriptRead.refetch()}
    >
      {#snippet failure()}
        <FailureNotice
          failure={failureOf(transcriptRead.error)}
          subject="This recording"
          fallback="This recording's transcript could not be read."
          whenSilent="Nothing answered. This recording's transcript could not be read."
          onRetry={() => void transcriptRead.refetch()}
        />
      {/snippet}
      {#if body.kind !== "lines" && body.detail}
        <EmptyState title={body.title}>{body.detail}</EmptyState>
      {:else if body.kind !== "lines"}
        <EmptyState title={body.title} />
      {:else}
        <div class="flex flex-col gap-8">
          {#if documentAddress !== null}
            <!-- The WebVTT document the transcript was filed as, beside the audio on the matter: the
                 file the matter holds, through the file's own route, beside the reader's work. -->
            <div class="flex justify-end">
              <Button variant="secondary" size="sm" href={documentAddress} {...opensBeside("file")}>
                <FileText class="size-16" aria-hidden="true" />
                Open Document
              </Button>
            </div>
          {/if}
          {@render transcript(lines)}
        </div>
      {/if}
    </LoadingRegion>
  {/snippet}
</ActionDialog>
