<script lang="ts">
  /*
   * A matter's calendar as two tables: the deadlines it is held to, then the settings recorded on
   * it. Deadlines lead because they are the only thing here a person may still have to act on, and
   * an overdue one is the reason somebody opened this screen; events follow, furthest ahead first.
   *
   * THIS IS THE ONE LISTING READ ON THE MATTER CALENDAR, AND IT LIVES IN THE MODULE. The grid views
   * are a window over the record; the tables are the record walked to its end. Folding one into the
   * other would make the list depend on the calendar's window, so the two reads stay separate, but
   * both belong to the calendar module: a page embeds this component with a matter the way it embeds
   * `CalendarView` with a scope, and writes no calendar read of its own.
   *
   * Neither list is narrowed. A deadline already satisfied or vacated is part of the matter's
   * record and appears with the rest; a cancelled event is shown as cancelled rather than hidden,
   * because a setting that was called off and one that never existed are different facts.
   *
   * Nothing here calculates a date. Every date on this screen is one a person recorded, and whether
   * a deadline is overdue is worked out by the server when the list is read, in the deadline's own
   * time zone; the badge word is decided once in calendar-api.ts so no surface re-derives it.
   *
   * The two lists read independently, so one failing does not blank the other: a firm whose
   * deadline read errored still needs to see its hearings.
   *
   * BOTH TABLES STAND WHETHER OR NOT THEY HOLD ANYTHING. The header row renders from the first
   * paint and the empty body carries the one line, so a matter with nothing on its calendar shows
   * the shape its dates will arrive in. A SAMPLE matter (the in-repo fixtures the chrome's
   * lifecycle states are reviewed against) has no firm behind it and therefore nothing to read, and
   * its empty body says so in its own words, because "nothing recorded" and "not a real matter" are
   * different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { sampleCivilDate, sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import {
    deadlineStateBadgeLabel,
    deadlineTone,
    eventStatusLabel,
    eventStatusTone,
    formatWallClock,
    listMatterDeadlines,
    listMatterEvents,
    overdueCount,
    type CalendarDeadline,
    type CalendarEvent,
  } from "./calendar-api.ts";

  let {
    matterId,
    isSample,
    refreshToken,
  }: {
    /** The matter whose record is listed. */
    matterId: string;
    /** Whether the matter is one of the in-repo samples, which has no firm to read from. */
    isSample: boolean;
    /** Bumped by the host after a write lands, so both tables show the new row without a reload. */
    refreshToken: number;
  } = $props();

  const deadlineList = new PagedList<CalendarDeadline>(
    "The deadlines on this matter could not be read.",
  );
  const eventList = new PagedList<CalendarEvent>("The events on this matter could not be read.");

  const deadlines = $derived(deadlineList.items);
  const events = $derived(eventList.items);

  // A failed FIRST read settles the region to the notice with Retry, so the shape never stands
  // over nothing. A failed further page keeps the rows already read and says so above them: those
  // rows were read successfully and are still true.
  const deadlineFirstReadFailed = $derived(
    deadlineList.failure !== null && (deadlines?.length ?? 0) === 0,
  );
  const eventFirstReadFailed = $derived(eventList.failure !== null && (events?.length ?? 0) === 0);

  function readDeadlines(subject: string): void {
    deadlineList.reset(subject);
    if (isSample) {
      deadlineList.settleEmpty();
      return;
    }
    void deadlineList.load((cursor) => listMatterDeadlines(fetch, subject, cursor));
  }

  function readEvents(subject: string): void {
    eventList.reset(subject);
    if (isSample) {
      eventList.settleEmpty();
      return;
    }
    void eventList.load((cursor) => listMatterEvents(fetch, subject, cursor));
  }

  function readBoth(subject: string): void {
    readDeadlines(subject);
    readEvents(subject);
  }

  /** The refresh token the tables were last read against, so a bump is told from a re-run. */
  let readAgainstToken: number | null = null;

  // A read happens when the subject changes or the host reports a write; nothing else re-reads,
  // so a second run of this effect over the same matter and token leaves the rows alone.
  $effect(() => {
    const subject = matterId;
    const token = refreshToken;
    if (deadlineList.showing(subject) && token === readAgainstToken) return;
    readAgainstToken = token;
    readBoth(subject);
  });

  function loadMoreDeadlines(): void {
    void deadlineList.loadMore((cursor) => listMatterDeadlines(fetch, matterId, cursor));
  }

  function loadMoreEvents(): void {
    void eventList.loadMore((cursor) => listMatterEvents(fetch, matterId, cursor));
  }

  const overdue = $derived(overdueCount(deadlines ?? []));

  function whenOf(dateOn: string, time: string | null, timeZone: string): string {
    const clock = formatWallClock(time, timeZone);
    return clock === null ? DataTable.formatDate(dateOn) : `${DataTable.formatDate(dateOn)}, ${clock}`;
  }

  // ---- the shapes drawn while a read is in flight -----------------------------------------------
  //
  // Representative rows in the record's own shape, so each table is ONE snippet serving both the
  // rows and the shape they take while they are read; the loading region greys them. Sample words
  // only, never a matter's own. The titles, authorities and places are field-specific words the
  // sample vocabulary does not carry, and the dates stay in the wire shape the row formatter
  // takes, which the vocabulary does not carry either.

  const DEADLINE_FIXTURE: readonly CalendarDeadline[] = [
    {
      id: "fixture-deadline-responses",
      matterId: "fixture-matter",
      title: "Responses to the first set of interrogatories",
      dueOn: sampleCivilDate(3),
      dueAtTime: "17:00",
      timeZone: "America/Chicago",
      source: "member",
      authorityText: "Fed. R. Civ. P. 33(b)(2)",
      triggerEventId: null,
      state: "open",
      satisfiedAt: null,
      satisfiedBy: null,
      satisfyingEventId: null,
      stateReason: null,
      priority: 2,
      overdue: false,
    },
    {
      id: "fixture-deadline-summary-judgment",
      matterId: "fixture-matter",
      title: "Motion for summary judgment",
      dueOn: sampleCivilDate(4),
      dueAtTime: null,
      timeZone: "America/Chicago",
      source: "court_order",
      authorityText: "Scheduling order of 14 March",
      triggerEventId: null,
      state: "open",
      satisfiedAt: null,
      satisfiedBy: null,
      satisfyingEventId: null,
      stateReason: null,
      priority: null,
      overdue: false,
    },
  ];

  const EVENT_FIXTURE: readonly CalendarEvent[] = [
    {
      id: "fixture-event-hearing",
      matterId: "fixture-matter",
      eventTypeId: null,
      eventTypeName: "Hearing",
      title: "Hearing on the motion to compel",
      description: null,
      status: "scheduled",
      statusReason: null,
      startsOn: sampleCivilDate(3),
      startsAtTime: "09:30",
      endsOn: null,
      endsAtTime: null,
      timeZone: "America/Chicago",
      locationText: "Department 12",
      conferenceUrl: null,
      courtReference: null,
      recurrenceRule: null,
      recordedAt: sampleInstant(0),
      recordedBy: null,
      continuedFromEventId: null,
      continuedToEventId: null,
    },
    {
      id: "fixture-event-deposition",
      matterId: "fixture-matter",
      eventTypeId: null,
      eventTypeName: "Deposition",
      title: "Deposition of the custodian of records",
      description: null,
      status: "scheduled",
      statusReason: null,
      startsOn: sampleCivilDate(4),
      startsAtTime: "13:00",
      endsOn: null,
      endsAtTime: null,
      timeZone: "America/Chicago",
      locationText: "Conference Room A",
      conferenceUrl: null,
      courtReference: null,
      recurrenceRule: null,
      recordedAt: sampleInstant(1),
      recordedBy: null,
      continuedFromEventId: null,
      continuedToEventId: null,
    },
  ];
</script>

{#snippet deadlineTable(rows: readonly CalendarDeadline[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">Deadlines recorded for this matter</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Due</DataTable.Head>
        <DataTable.Head>Deadline</DataTable.Head>
        <DataTable.Head>Authority</DataTable.Head>
        <DataTable.Head>State</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as deadline (deadline.id)}
        <DataTable.Row>
          <DataTable.Cell>
            {whenOf(deadline.dueOn, deadline.dueAtTime, deadline.timeZone)}
          </DataTable.Cell>
          <DataTable.Cell>{deadline.title}</DataTable.Cell>
          <DataTable.Cell>
            {#if deadline.authorityText === null}
              <span class="text-text-muted">Not recorded</span>
            {:else}
              {deadline.authorityText}
            {/if}
          </DataTable.Cell>
          <DataTable.Cell>
            <Badge variant={deadlineTone(deadline)}>
              {deadlineStateBadgeLabel(deadline)}
            </Badge>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow
          columns={4}
          title={isSample ? "No Deadlines On A Sample Matter" : "No Deadlines Yet"}
        />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

{#snippet eventTable(rows: readonly CalendarEvent[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">Events recorded for this matter</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>When</DataTable.Head>
        <DataTable.Head>Event</DataTable.Head>
        <DataTable.Head>Type</DataTable.Head>
        <DataTable.Head>Where</DataTable.Head>
        <DataTable.Head>Status</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as event (event.id)}
        <DataTable.Row>
          <DataTable.Cell>
            {whenOf(event.startsOn, event.startsAtTime, event.timeZone)}
          </DataTable.Cell>
          <DataTable.Cell>
            {event.title}
            {#if event.continuedFromEventId !== null}
              <span class="text-text-muted"> (continued from an earlier setting)</span>
            {:else if event.continuedToEventId !== null}
              <span class="text-text-muted"> (continued to a later setting)</span>
            {/if}
          </DataTable.Cell>
          <DataTable.Cell>
            {#if event.eventTypeName === null}
              <span class="text-text-muted">Unclassified</span>
            {:else}
              {event.eventTypeName}
            {/if}
          </DataTable.Cell>
          <DataTable.Cell>
            {#if event.locationText !== null}
              {event.locationText}
            {:else if event.courtReference !== null}
              {event.courtReference}
            {:else}
              <span class="text-text-muted">Not recorded</span>
            {/if}
          </DataTable.Cell>
          <DataTable.Cell>
            <Badge variant={eventStatusTone(event.status)}>
              {eventStatusLabel(event.status)}
            </Badge>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow
          columns={5}
          title={isSample ? "No Events On A Sample Matter" : "No Events Yet"}
        />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

<div class="flex flex-col gap-16">
  {#if overdue > 0}
    <Alert.Root variant="warning">
      <Alert.Title>
        {overdue === 1 ? "One Deadline Is Past Due" : `${overdue} Deadlines Are Past Due`}
      </Alert.Title>
      <Alert.Description>
        Past due is worked out against each deadline's own time zone, at the moment this page was
        read. A deadline that has been met is marked satisfied and stops counting here.
      </Alert.Description>
    </Alert.Root>
  {/if}

  <div class="flex flex-col gap-8">
    <FieldLabel as="h3">
      Deadlines
    </FieldLabel>

    <LoadingRegion
      loading={deadlines === null}
      failed={deadlineFirstReadFailed}
      label="Reading the matter's deadlines"
      onRetry={() => readDeadlines(matterId)}
      class="flex flex-col gap-8"
    >
      {#snippet failure()}
        {#if deadlineList.failure !== null}
          <FailureNotice
            failure={deadlineList.failure}
            title="Deadlines Could Not Be Read"
            fallback="The deadlines on this matter could not be read."
            onRetry={() => readDeadlines(matterId)}
          />
        {/if}
      {/snippet}
      {#snippet fixture()}
        {@render deadlineTable(DEADLINE_FIXTURE)}
      {/snippet}
      {@const shown = deadlines ?? []}
      {#if deadlineList.failure !== null}
        <FailureNotice
          failure={deadlineList.failure}
          title="The Rest Of The Deadlines Could Not Be Read"
          fallback="The next page of deadlines could not be read. What is shown was read and stands."
          onRetry={loadMoreDeadlines}
        />
      {/if}
      {@render deadlineTable(shown)}

      {#if deadlineList.nextCursor !== null}
        <div class="flex flex-col items-start gap-8">
          <Button
            variant="secondary"
            onclick={loadMoreDeadlines}
            disabled={deadlineList.loadingMore}
          >
            {deadlineList.loadingMore ? "Loading" : "Load more deadlines"}
          </Button>
          <p class="text-xs text-text-muted">
            Showing the {shown.length} soonest. The past-due count above covers only what is
            on screen.
          </p>
        </div>
      {/if}
    </LoadingRegion>
  </div>

  <div class="flex flex-col gap-8">
    <FieldLabel as="h3">
      Events
    </FieldLabel>

    <LoadingRegion
      loading={events === null}
      failed={eventFirstReadFailed}
      label="Reading the matter's events"
      onRetry={() => readEvents(matterId)}
      class="flex flex-col gap-8"
    >
      {#snippet failure()}
        {#if eventList.failure !== null}
          <FailureNotice
            failure={eventList.failure}
            title="Events Could Not Be Read"
            fallback="The events on this matter could not be read."
            onRetry={() => readEvents(matterId)}
          />
        {/if}
      {/snippet}
      {#snippet fixture()}
        {@render eventTable(EVENT_FIXTURE)}
      {/snippet}
      {@const shown = events ?? []}
      {#if eventList.failure !== null}
        <FailureNotice
          failure={eventList.failure}
          title="The Rest Of The Events Could Not Be Read"
          fallback="The next page of events could not be read. What is shown was read and stands."
          onRetry={loadMoreEvents}
        />
      {/if}
      {@render eventTable(shown)}

      {#if eventList.nextCursor !== null}
        <div class="flex flex-col items-start gap-8">
          <Button variant="secondary" onclick={loadMoreEvents} disabled={eventList.loadingMore}>
            {eventList.loadingMore ? "Loading" : "Load more events"}
          </Button>
          <p class="text-xs text-text-muted">
            Showing the {shown.length} furthest ahead.
          </p>
        </div>
      {/if}
    </LoadingRegion>
  </div>
</div>
