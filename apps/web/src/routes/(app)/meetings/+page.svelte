<script lang="ts">
  /*
   * Meetings — what is running, what is coming, and what has just finished.
   *
   * WHY THE SCREEN EXISTS AT ALL, when every meeting is started from its own calendar entry. Two
   * questions the calendar cannot answer without being searched: is anything running right now, and
   * what have I just missed. A member who knows there is a meeting and does not remember which
   * hearing it hangs on would otherwise have to find the entry first, which is a search for
   * something they can see the whole of on one screen.
   *
   * THREE READS, NOT ONE. Each section is its own scope on the server — the rooms in progress, the
   * meetings on events from the reader's own day onward, and the last thirty days of endings — and
   * each is paged on its own, because they grow at completely different rates. The reads are fired
   * from the cache rather than awaited, so the screen draws its shape immediately; `+page.ts` says
   * why only the first is warmed.
   *
   * THE READER'S OWN DAY IS THE READER'S. The upcoming scope is measured from a civil date, and the
   * server has no zone to derive one in, so the browser states its own — through the calendar's
   * helper, which resolves the zone once and falls back to UTC where a runtime cannot say.
   *
   * SCHEDULING FROM HERE OPENS THE CALENDAR'S OWN EVENT FORM, preset to a video meeting. A meeting
   * is a calendar event with a medium on it — there is no second record and there must be no second
   * form — so this screen contributes the way IN and nothing else: the context it hands the form is
   * the one `calendarContext` already holds, because a second assembly of the roster, the type
   * catalog and the firm's rooms would be a second answer to what the form is offering.
   *
   * THE CONTROL READS "NEW MEETING" RATHER THAN "SCHEDULE". Every screen that makes a record draws
   * the design system's CreateControl and nothing else, and its label is New plus a noun. The verb
   * the owner asked for lives in the tooltip, which is also where this screen says the one thing a
   * reader arriving here needs to know: a meeting is recorded on the calendar as an event.
   */
  import { createInfiniteQuery } from "@tanstack/svelte-query";
  import { meetingsListInfiniteOptions } from "@magna-carta/api-client";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { paged } from "$lib/api/screen-data.ts";
  import { todayCivil } from "$lib/calendar/calendar-window.ts";
  import { calendarContext } from "$lib/calendar/calendar-context.svelte.ts";
  import { calendarManageRefusal } from "$lib/calendar/calendar-permission.ts";
  import RecordEventDialog from "$lib/calendar/record-event-dialog.svelte";
  import MeetingsScreen from "$lib/meetings/meetings-screen.svelte";
  import MeetingAttendancePanel from "$lib/meetings/meeting-attendance-panel.svelte";
  import RecordingList from "$lib/meetings/screen/recording-list.svelte";
  import type { MeetingScope, MeetingSectionState } from "$lib/meetings/meeting-list.ts";
  import type { MeetingSummary } from "@magna-carta/api-client";

  /*
   * Read once, at mount. The reader's day is what the upcoming scope is measured from, and a value
   * that re-derived itself would change the query key at midnight under somebody looking at the
   * screen — which reads as the list emptying itself for no reason.
   */
  const today = todayCivil();

  const live = createInfiniteQuery(() =>
    paged(meetingsListInfiniteOptions({ query: { scope: "live" } })),
  );
  const upcoming = createInfiniteQuery(() =>
    paged(meetingsListInfiniteOptions({ query: { scope: "upcoming", today } })),
  );
  const recent = createInfiniteQuery(() =>
    paged(meetingsListInfiniteOptions({ query: { scope: "recent" } })),
  );

  type MeetingsRead = typeof live;

  /** Every page in hand, as one listing. Null while nothing has arrived, which is not an empty list. */
  function meetingsOf(read: MeetingsRead): readonly MeetingSummary[] | null {
    const pages = read.data?.pages;
    if (pages === undefined) return null;
    return pages.flatMap((page) => page.data);
  }

  /** What one section's table renders from: its rows, its refusal, and its way to the next page. */
  function sectionOf(read: MeetingsRead): MeetingSectionState {
    return {
      meetings: read.isError ? null : meetingsOf(read),
      failure: read.isError ? failureOf(read.error) : null,
      more: read.hasNextPage,
      loadingMore: read.isFetchingNextPage,
      onRetry: () => void read.refetch(),
      onLoadMore: () => void read.fetchNextPage(),
    };
  }

  const sections = $derived<Record<MeetingScope, MeetingSectionState>>({
    live: sectionOf(live),
    upcoming: sectionOf(upcoming),
    recent: sectionOf(recent),
  });

  /*
   * Whether this deployment carries meetings at all, as the summaries themselves state it: the flag
   * rides on every meeting the server hands back. Nothing in hand says nothing either way, so the
   * screen assumes yes and shows its three sections — a firm with meetings turned on and none in any
   * scope has an empty list, which is a different fact from a firm that cannot hold one.
   */
  const configured = $derived(
    [sections.live, sections.upcoming, sections.recent]
      .flatMap((section) => section.meetings ?? [])
      .every((meeting) => meeting.configured),
  );

  /*
   * The form's own context — the session, the roster, the type catalog, the firm's offices and its
   * bookable rooms — read once and shared with every other calendar surface.
   */
  const context = calendarContext;
  $effect(() => {
    void context.load(fetch);
  });

  const scheduleRefusal = $derived(calendarManageRefusal("Scheduling a meeting", context));
  let scheduleOpen = $state(false);

  /*
   * A scheduled meeting lands on the calendar, and the three lists here are reads of the server's
   * own scopes — so the upcoming list is refetched rather than patched. Nothing is assumed about
   * where the new row sorts.
   */
  function scheduled(): void {
    void upcoming.refetch();
  }

  /*
   * WHO WAS THERE, for an ended row. One panel for the screen, pointed at whichever row asked, and
   * read only when it opens: the record of a long hearing is long, and nobody arriving here has
   * asked for every meeting's record at once.
   */
  let attendanceOf = $state<MeetingSummary | null>(null);
  let attendanceOpen = $state(false);

  function openAttendance(meeting: MeetingSummary): void {
    attendanceOf = meeting;
    attendanceOpen = true;
  }

  /*
   * WHAT WAS RECORDED, for an ended row whose meeting was recorded: the same list the room's header
   * opens, pointed at whichever row asked. Who was told is the room's to open, where a host reads it
   * beside the meeting it is about.
   */
  let recordingsOf = $state<MeetingSummary | null>(null);
  let recordingsOpen = $state(false);

  function openRecordings(meeting: MeetingSummary): void {
    recordingsOf = meeting;
    recordingsOpen = true;
  }
</script>

<svelte:head><title>Meetings · Magna Carta</title></svelte:head>

<div class="flex flex-col gap-24">
  <ScreenHeader title="Meetings">
    {#snippet actions()}
      <CreateControl
        noun="Meeting"
        title="Schedule a meeting or a call. It is recorded on the calendar as an event."
        refusal={scheduleRefusal}
        onpress={() => (scheduleOpen = true)}
      />
    {/snippet}
  </ScreenHeader>
  <MeetingsScreen
    {sections}
    {configured}
    onAttendance={openAttendance}
    onRecordings={openRecordings}
  />
</div>

<MeetingAttendancePanel
  bind:open={attendanceOpen}
  meetingId={attendanceOf?.id ?? ""}
  subject={{ facts: attendanceOf === null ? [] : [attendanceOf.title] }}
/>

<RecordingList
  bind:open={recordingsOpen}
  meetingId={recordingsOf?.id ?? ""}
  subject={{ facts: recordingsOf === null ? [] : [recordingsOf.title] }}
/>

<RecordEventDialog
  bind:open={scheduleOpen}
  matterId={null}
  matters={context.matters}
  mattersCapped={context.mattersCapped}
  mattersReading={context.mattersReading}
  eventTypes={context.eventTypes}
  members={context.members}
  locations={context.locations}
  resources={context.resources}
  preferredTimeZones={[context.readerTimeZone]}
  initialDate={today}
  initialMeeting="video"
  onRecorded={scheduled}
/>
