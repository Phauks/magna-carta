<script lang="ts">
  /*
   * The matter's calendar — the settings recorded against it and the dates it is held to.
   *
   * Two records, kept apart because they answer different questions. Deadlines lead: they are the
   * only thing here a person may still have to act on, and an overdue one is the reason somebody
   * opened this screen. Events follow, furthest ahead first, so what is still coming reads before
   * what has already happened.
   *
   * Neither list is narrowed. A deadline already satisfied or vacated is part of the matter's
   * record and appears with the rest; a cancelled event is shown as cancelled rather than hidden,
   * because a setting that was called off and one that never existed are different facts.
   *
   * Nothing here calculates a date. Every date on this screen is one a person recorded, and whether
   * a deadline is overdue is worked out by the server when the page is read, in the deadline's own
   * time zone -- there is no stored flag anywhere saying the firm missed something.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has
   * no firm behind it and therefore nothing to read; it says so rather than showing empty tables,
   * because "nothing recorded" and "not a real matter" are different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Plus from "@lucide/svelte/icons/plus";
  import {
    deadlineStateLabel,
    deadlineTone,
    eventStatusLabel,
    eventStatusTone,
    formatWallClock,
    listMatterDeadlines,
    listMatterEvents,
    overdueCount,
    type CalendarDeadline,
    type CalendarEvent,
  } from "$lib/matters/calendar-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  let deadlines = $state<readonly CalendarDeadline[] | null>(null);
  let deadlinesTruncated = $state(false);
  let deadlineFailure = $state<string | null>(null);

  let events = $state<readonly CalendarEvent[] | null>(null);
  let eventsTruncated = $state(false);
  let eventFailure = $state<string | null>(null);

  // The two reads are independent, and one failing must not blank the other: a firm whose deadline
  // read errored still needs to see its hearings.
  $effect(() => {
    const matterId = matter.id;
    // Every read of the previous matter is discarded before the next one is asked for. A failure
    // left standing would be attributed to the matter now on screen, and a list left standing would
    // be read as that matter's own.
    deadlines = null;
    events = null;
    deadlinesTruncated = false;
    eventsTruncated = false;
    deadlineFailure = null;
    eventFailure = null;
    if (isSample) {
      deadlines = [];
      events = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await listMatterDeadlines(fetch, matterId);
      if (cancelled) return;
      if (result.kind === "ok") {
        deadlines = result.value.data;
        deadlinesTruncated = result.value.nextCursor !== null;
        deadlineFailure = null;
      } else {
        deadlines = [];
        deadlineFailure =
          result.kind === "transport"
            ? "Nothing answered. The deadlines on this matter could not be read."
            : (result.problem.detail ?? "The deadlines on this matter could not be read.");
      }
    })();
    void (async () => {
      const result = await listMatterEvents(fetch, matterId);
      if (cancelled) return;
      if (result.kind === "ok") {
        events = result.value.data;
        eventsTruncated = result.value.nextCursor !== null;
        eventFailure = null;
      } else {
        events = [];
        eventFailure =
          result.kind === "transport"
            ? "Nothing answered. The events on this matter could not be read."
            : (result.problem.detail ?? "The events on this matter could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const overdue = $derived(overdueCount(deadlines ?? []));

  function whenOf(dateOn: string, time: string | null, timeZone: string): string {
    const clock = formatWallClock(time, timeZone);
    return clock === null ? DataTable.formatDate(dateOn) : `${DataTable.formatDate(dateOn)}, ${clock}`;
  }
</script>

<svelte:head>
  <title>Calendar · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8 border-b border-border-strong pb-8">
    <div class="flex items-center justify-between gap-16">
      <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Calendar
      </h2>
      <div class="flex items-center gap-8">
        <Badge variant="neutral">Soon</Badge>
        <Button variant="secondary" disabled>
          <Plus aria-hidden="true" />
          Record a deadline
        </Button>
        <Button variant="secondary" disabled>
          <Plus aria-hidden="true" />
          Record an event
        </Button>
      </div>
    </div>
    <p class="text-xs text-text-muted">
      Recording from this screen waits on the participant picker, so a judge, a court, or a witness
      is chosen from the firm's directory rather than typed twice. What has already been recorded
      against this matter is read here now, in every state.
    </p>
  </div>

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
    <h3 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Deadlines
    </h3>

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
                  {deadline.overdue && deadline.state === "open"
                    ? "Past due"
                    : deadlineStateLabel(deadline.state)}
                </Badge>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>

      {#if deadlinesTruncated}
        <p class="text-xs text-text-muted">
          The soonest {deadlines.length} deadlines are shown. This matter has more recorded than fit
          on one page, and reaching the rest waits on paging this screen.
        </p>
      {/if}
    {/if}
  </div>

  <div class="flex flex-col gap-8">
    <h3 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Events
    </h3>

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

      {#if eventsTruncated}
        <p class="text-xs text-text-muted">
          The {events.length} events furthest ahead are shown. This matter has more recorded than fit
          on one page, and reaching the rest waits on paging this screen.
        </p>
      {/if}
    {/if}
  </div>
</section>
