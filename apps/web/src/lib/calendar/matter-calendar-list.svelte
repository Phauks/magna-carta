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
   * deadline read errored still needs to see its hearings. A SAMPLE matter (the in-repo fixtures
   * the chrome's lifecycle states are reviewed against) has no firm behind it and therefore nothing
   * to read; it says so rather than showing empty tables, because "nothing recorded" and "not a
   * real matter" are different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Skeleton from "@magna-carta/design-system/skeleton";
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
  const deadlineFailure = $derived(deadlineList.failureMessage);
  const events = $derived(eventList.items);
  const eventFailure = $derived(eventList.failureMessage);

  function readBoth(subject: string): void {
    deadlineList.reset(subject);
    eventList.reset(subject);
    if (isSample) {
      deadlineList.settleEmpty();
      eventList.settleEmpty();
      return;
    }
    void deadlineList.load((cursor) => listMatterDeadlines(fetch, subject, cursor));
    void eventList.load((cursor) => listMatterEvents(fetch, subject, cursor));
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
</script>

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

    {#if deadlineFailure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Deadlines Could Not Be Read</Alert.Title>
        <Alert.Description>{deadlineFailure}</Alert.Description>
      </Alert.Root>
    {:else if deadlines === null}
      <div class="flex flex-col gap-8" aria-busy="true" aria-label="Loading the matter's deadlines">
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-32 w-full" />
      </div>
    {:else if isSample}
      <EmptyState title="No Deadlines On A Sample Matter">
        This is one of the sample matters the interface is reviewed against. It has no firm behind
        it, so there is nothing on its calendar.
      </EmptyState>
    {:else if deadlines.length === 0}
      <EmptyState title="No Deadlines Yet">
        Responses, filings, statutes of limitation. Every date this matter is held to is recorded
        here with the authority it comes from, and reports whether it has passed.
      </EmptyState>
    {:else}
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
          {#each deadlines as deadline (deadline.id)}
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
          {/each}
        </DataTable.Body>
      </DataTable.Root>

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
            Showing the {deadlines.length} soonest. The past-due count above covers only what is
            on screen.
          </p>
        </div>
      {/if}
    {/if}
  </div>

  <div class="flex flex-col gap-8">
    <FieldLabel as="h3">
      Events
    </FieldLabel>

    {#if eventFailure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Events Could Not Be Read</Alert.Title>
        <Alert.Description>{eventFailure}</Alert.Description>
      </Alert.Root>
    {:else if events === null}
      <div class="flex flex-col gap-8" aria-busy="true" aria-label="Loading the matter's events">
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-32 w-full" />
      </div>
    {:else if isSample}
      <EmptyState title="No Events On A Sample Matter">
        This is one of the sample matters the interface is reviewed against. It has no firm behind
        it, so there is nothing on its calendar.
      </EmptyState>
    {:else if events.length === 0}
      <EmptyState title="No Events Yet">
        Hearings, depositions, closings, client meetings. Every setting recorded for this matter
        appears here with where it is and the time zone that time is read in.
      </EmptyState>
    {:else}
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
          {#each events as event (event.id)}
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
          {/each}
        </DataTable.Body>
      </DataTable.Root>

      {#if eventList.nextCursor !== null}
        <div class="flex flex-col items-start gap-8">
          <Button variant="secondary" onclick={loadMoreEvents} disabled={eventList.loadingMore}>
            {eventList.loadingMore ? "Loading" : "Load more events"}
          </Button>
          <p class="text-xs text-text-muted">
            Showing the {events.length} furthest ahead.
          </p>
        </div>
      {/if}
    {/if}
  </div>
</div>
