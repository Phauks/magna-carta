<script lang="ts">
  /*
   * One section of the Meetings screen: a named table of meetings, and the way into each one.
   *
   * IT TAKES ITS MEETINGS AND READS NOTHING. The screen owns the three reads, so this renders from
   * what it is given — which is what lets a test drive all three sections from fixed pages with no
   * transport anywhere near them, and what keeps one component serving three questions rather than
   * three components differing by a query.
   *
   * NULL IS "NOT YET", AND EMPTY IS AN ANSWER. A section whose rows have not arrived hands the grid
   * its own placeholder rows; a section that came back with nothing lets the grid say "No Results"
   * inside the table it would have filled, which is the standing rule for where an emptiness is
   * stated. A failed read replaces the table with the notice, because a table standing empty over a
   * failure says the firm has no meetings when nobody asked it.
   */
  import { untrack } from "svelte";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Lock from "@lucide/svelte/icons/lock";
  import Phone from "@lucide/svelte/icons/phone";
  import Video from "@lucide/svelte/icons/video";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { eventAddress } from "./meetings-api.ts";
  import {
    matterAddress,
    meetingAddress,
    meetingColumns,
    meetingInitialSort,
    MEETING_COLUMN_IDENTIFIERS,
    MEETING_SECTIONS,
    type MeetingScope,
  } from "./meeting-list.ts";
  import type { Failure } from "$lib/api/problem.ts";
  import type { MeetingSummary } from "@magna-carta/api-client";

  let {
    scope,
    meetings,
    failure = null,
    onRetry,
    more = false,
    loadingMore = false,
    onLoadMore,
    onAttendance,
  }: {
    /** Which of the three questions this section answers. */
    scope: MeetingScope;
    /** The meetings read for this section, or null while the read is in flight. */
    meetings: readonly MeetingSummary[] | null;
    /** The read's refusal, where reading is what failed. */
    failure?: Failure | null;
    onRetry?: () => void;
    /** Whether the listing carries on past what is on screen. */
    more?: boolean;
    loadingMore?: boolean;
    onLoadMore?: () => void;
    /**
     * Open the record of who was in an ended meeting. The screen holds the panel and its read, so
     * this section stays a component that reads nothing.
     */
    onAttendance?: (meeting: MeetingSummary) => void;
  } = $props();

  const section = $derived(MEETING_SECTIONS[scope]);
  const rows = $derived(meetings === null ? [] : [...meetings]);

  const grid = DataTable.createDataTableGrid<MeetingSummary>({
    columns: () => meetingColumns(scope),
    rows: () => rows,
    rowKey: (meeting) => meeting.id,
    // Read once, on purpose: which column a table OPENS on is a starting position, and a section
    // keeps the one scope for as long as it is mounted. Reading it reactively would also re-sort a
    // table under a reader who had sorted it themselves.
    initialSort: untrack(() => meetingInitialSort(scope)),
    itemNoun: { singular: "meeting", plural: "meetings" },
  });

  /** A meeting that has ended has no room to walk into; its row goes back to the event instead. */
  const over = $derived(scope === "recent");

</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<MeetingSummary>)}
  {#if column.id === MEETING_COLUMN_IDENTIFIERS.title}
    <!-- The glyph rides in the row's anchored column, beside the name of the event: what KIND of
         room this is decides what walking into it does to your camera, so it is read at a glance
         rather than found by opening it. The label is what a screen reader hears in its place. -->
    <span class="flex min-w-0 items-center gap-8">
      {#if row.medium === "audio"}
        <Phone class="mc-table-grid-row-glyph shrink-0" aria-label="Call" />
      {:else}
        <Video class="mc-table-grid-row-glyph shrink-0" aria-label="Video meeting" />
      {/if}
      <span class="truncate" title={row.title}>{text}</span>
    </span>
  {:else if column.id === MEETING_COLUMN_IDENTIFIERS.where}
    {@const address = matterAddress(row)}
    {#if address === null}
      {text}
    {:else}
      <a href={address} class="underline underline-offset-2">Matter</a>
    {/if}
  {:else if column.id === MEETING_COLUMN_IDENTIFIERS.actions}
    {#if over}
      <span class="flex items-center justify-end gap-8">
        {#if onAttendance !== undefined}
          <!-- The record of who was there, one press from an ended row: it is the part of a
               meeting the file keeps, and what somebody looking at what has just finished is
               usually asking. -->
          <Button variant="ghost" size="sm" onclick={() => onAttendance(row)}>Attendance</Button>
        {/if}
        <Button variant="ghost" size="sm" href={eventAddress(row.eventKind, row.eventId, row.matterId)}>
          Open the Event
        </Button>
      </span>
    {:else if row.locked}
      <!-- A host has shut the door. The row says so before the click rather than after it: the
           summary carries the fact, so walking a reader through the room screen to be refused there
           would be two screens spent saying what one word says. Disabled and not absent — the door
           opens again the moment a host unlocks it. -->
      <Button variant="secondary" size="sm" disabled title="A host has locked this room, so nobody else can come in.">
        <Lock class="size-16" aria-hidden="true" />
        Locked
      </Button>
    {:else}
      <Button variant="secondary" size="sm" href={meetingAddress(row)}>
        {#if row.medium === "audio"}
          <Phone class="size-16" aria-hidden="true" />
        {:else}
          <Video class="size-16" aria-hidden="true" />
        {/if}
        {row.medium === "audio" ? "Join Call" : "Join Meeting"}
      </Button>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

<section class="flex flex-col gap-8">
  <FieldLabel as="h2">{section.heading}</FieldLabel>

  {#if failure !== null}
    <FailureNotice
      failure={failure}
      subject="These meetings"
      fallback="This part of the list could not be read."
      whenSilent="Nothing answered. This part of the list could not be read."
      {onRetry}
    />
  {:else}
    <DataTable.Grid {grid} {cell} caption={section.caption} loading={meetings === null} placeholderCount={3} />

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun={section.noun}
          {more}
          loading={loadingMore}
          onLoad={() => onLoadMore?.()}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</section>
