<script lang="ts">
  /*
   * Who was in a meeting that has ended, and for how long — the part of a meeting the file keeps.
   *
   * IT IS A READING PANEL over the product's one grid. It is opened to answer "was she there" or
   * "when did the client drop off", and it asks for nothing: the record is what happened, and no
   * act here could change it.
   *
   * GUESTS ARE ON IT BESIDE MEMBERS, in the order the stays began, each named by the name they gave
   * at the door with the Directory name their link was minted for beside it. A reader months later
   * must be able to see at a glance that the person who attended is not the record the invitation
   * named, which is the one trace a forwarded link leaves.
   *
   * IT READS WHEN IT OPENS, and pages on from there: a hearing with a long gallery is a long record,
   * and the Meetings page is not the place to read every one of them on arrival.
   */
  import { untrack } from "svelte";
  import { createInfiniteQuery } from "@tanstack/svelte-query";
  import { meetingsAttendanceInfiniteOptions } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { paged } from "$lib/api/screen-data.ts";
  import { attendeeLabel, readAttendanceEntry, type MeetingAttendanceRow } from "./meeting-attendance.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";

  let {
    open = $bindable(false),
    meetingId,
    subject,
  }: {
    open?: boolean;
    /** The meeting whose record this is. */
    meetingId: string;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
  } = $props();

  const attendanceRead = createInfiniteQuery(() => ({
    ...paged(meetingsAttendanceInfiniteOptions({ path: { meetingId } })),
    enabled: open && meetingId !== "",
  }));

  const rows = $derived<MeetingAttendanceRow[]>(
    (attendanceRead.data?.pages ?? []).flatMap((page) => page.data.map(readAttendanceEntry)),
  );

  const grid = DataTable.createDataTableGrid<MeetingAttendanceRow>({
    columns: () => [
      {
        id: "attendee",
        label: "Who",
        type: "text",
        anchored: true,
        filter: "text",
        value: (row) => attendeeLabel(row),
      },
      {
        id: "joined",
        label: "Joined",
        type: "date",
        value: (row) => row.joinedAt,
        text: (row) => formatInstant(row.joinedAt),
      },
      {
        id: "left",
        label: "Left",
        type: "date",
        value: (row) => row.leftAt,
        text: (row) => (row.leftAt === null ? "" : formatInstant(row.leftAt)),
      },
    ],
    rows: () => rows,
    rowKey: (row) => row.id,
    // Read once: the record opens in the order the stays began, which is the server's own order.
    initialSort: untrack(() => ({ columnId: "joined", direction: "ascending" as const })),
    itemNoun: { singular: "stay", plural: "stays" },
  });
</script>

<ActionDialog bind:open kind="reading" heading="Attendance" subtitle={subject} width="wide">
  {#snippet fields()}
    {#if attendanceRead.isError}
      <FailureNotice
        failure={failureOf(attendanceRead.error)}
        subject="This meeting"
        fallback="Who was in this meeting could not be read."
        whenSilent="Nothing answered. Who was in this meeting could not be read."
        onRetry={() => void attendanceRead.refetch()}
      />
    {:else}
      <div class="flex flex-col gap-8">
        <DataTable.Grid
          {grid}
          caption="Who was in this meeting, and when"
          loading={attendanceRead.isPending}
          placeholderCount={3}
        />
        <DataTable.GridFooter {grid}>
          {#snippet end()}
            <DataTable.LoadMore
              noun="stays"
              more={attendanceRead.hasNextPage}
              loading={attendanceRead.isFetchingNextPage}
              onLoad={() => void attendanceRead.fetchNextPage()}
            />
          {/snippet}
        </DataTable.GridFooter>
      </div>
    {/if}
  {/snippet}
</ActionDialog>
