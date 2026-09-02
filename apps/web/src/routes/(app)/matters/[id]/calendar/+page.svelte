<script lang="ts">
  /*
   * The matter's calendar — the settings recorded against it and the dates it is held to.
   *
   * THREE WAYS TO READ ONE RECORD. The List is the two tables: deadlines lead, because they are the
   * only thing here a person may still have to act on and an overdue one is the reason somebody
   * opened this screen; events follow, furthest ahead first. Month and Agenda are the one calendar
   * component with this matter's scope. The section's own read and the component's are two reads
   * of the same record on purpose: the tables are a listing walked to the end, the grid is a
   * window, and folding one into the other would make the list depend on the calendar's window.
   *
   * Neither list is narrowed. A deadline already satisfied or vacated is part of the matter's
   * record and appears with the rest; a cancelled event is shown as cancelled rather than hidden,
   * because a setting that was called off and one that never existed are different facts.
   *
   * Nothing here calculates a date. Every date on this screen is one a person recorded, and whether
   * a deadline is overdue is worked out by the server when the page is read, in the deadline's own
   * time zone -- there is no stored flag anywhere saying the firm missed something.
   *
   * RECORDING HAPPENS HERE, with the matter fixed. The two controls open the record forms; they are
   * disabled only where the session cannot record on the calendar or the matter is a sample, and
   * the reason is on the control. After a write lands the tables are read again and the component
   * is told to re-read its window, so both views show the new row without a reload.
   *
   * THE ADDRESS CARRIES THE VIEW. `view` is `list`, `month` or `agenda` (the component mirrors its
   * own views and the anchor date; this page mirrors `list`, which the component does not know);
   * `entry` is the deep link the federated read emits for a matter event, and arriving on it with
   * the section on List opens the Agenda, because the entry window belongs to the component.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has
   * no firm behind it and therefore nothing to read; it says so rather than showing empty tables,
   * because "nothing recorded" and "not a real matter" are different facts.
   */
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import List from "@lucide/svelte/icons/list";
  import Plus from "@lucide/svelte/icons/plus";
  import Table from "@lucide/svelte/icons/table";
  import { CalendarView } from "$lib/calendar/index.ts";
  import {
    deadlineStateLabel,
    deadlineTone,
    eventStatusLabel,
    eventStatusTone,
    formatWallClock,
    listEventTypes,
    listMatterDeadlines,
    listMatterEvents,
    MANAGE_CALENDAR_PERMISSION,
    overdueCount,
    readerTimeZone,
    type CalendarDeadline,
    type CalendarEvent,
    type EventType,
  } from "$lib/calendar/calendar-api.ts";
  import { isCalendarView, type CalendarView as CalendarViewName } from "$lib/calendar/calendar-window.ts";
  import RecordDeadlineDialog from "$lib/calendar/record-deadline-dialog.svelte";
  import RecordEventDialog from "$lib/calendar/record-event-dialog.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { listFirmMembers, type FirmMemberSummary } from "$lib/members/members-api.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  // ---- the section's view ----------------------------------------------------------------------

  /** Which of the section's three views is showing; `calendar` is the component in one of its views. */
  type SectionView = "list" | "calendar";

  const arrivalView = page.url.searchParams.get("view");
  const arrivalEntry = page.url.searchParams.get("entry");

  let sectionView = $state<SectionView>(
    isCalendarView(arrivalView) || arrivalEntry !== null ? "calendar" : "list",
  );
  /** The component's own view while the section is on it; agenda for a deep-linked entry. */
  let calendarView = $state<CalendarViewName>(isCalendarView(arrivalView) ? arrivalView : "agenda");

  const openEntry = $derived(page.url.searchParams.get("entry"));

  // A deep-linked entry opens in the component's window, so a section on List goes to the Agenda.
  $effect(() => {
    if (openEntry !== null && sectionView === "list") {
      sectionView = "calendar";
      calendarView = "agenda";
    }
  });

  function showCalendar(view: CalendarViewName): void {
    sectionView = "calendar";
    calendarView = view;
  }

  /** The component mirrors its own views; List is this page's, so this page mirrors it. */
  function showList(): void {
    sectionView = "list";
    const url = new URL(page.url);
    url.searchParams.set("view", "list");
    replaceState(url, page.state);
  }

  // ---- the section's own reads -----------------------------------------------------------------

  // Two independent lists, so one failing does not blank the other: a firm whose deadline read
  // errored still needs to see its hearings.
  const deadlineList = new PagedList<CalendarDeadline>(
    "The deadlines on this matter could not be read.",
  );
  const eventList = new PagedList<CalendarEvent>("The events on this matter could not be read.");

  const deadlines = $derived(deadlineList.items);
  const deadlineFailure = $derived(deadlineList.failureMessage);
  const events = $derived(eventList.items);
  const eventFailure = $derived(eventList.failureMessage);

  function readBoth(matterId: string): void {
    deadlineList.reset(matterId);
    eventList.reset(matterId);
    if (isSample) {
      deadlineList.settleEmpty();
      eventList.settleEmpty();
      return;
    }
    void deadlineList.load((cursor) => listMatterDeadlines(fetch, matterId, cursor));
    void eventList.load((cursor) => listMatterEvents(fetch, matterId, cursor));
  }

  $effect(() => {
    const matterId = matter.id;
    if (deadlineList.showing(matterId)) return;
    readBoth(matterId);
  });

  function loadMoreDeadlines(): void {
    void deadlineList.loadMore((cursor) => listMatterDeadlines(fetch, matter.id, cursor));
  }

  function loadMoreEvents(): void {
    void eventList.loadMore((cursor) => listMatterEvents(fetch, matter.id, cursor));
  }

  const overdue = $derived(overdueCount(deadlines ?? []));

  function whenOf(dateOn: string, time: string | null, timeZone: string): string {
    const clock = formatWallClock(time, timeZone);
    return clock === null ? DataTable.formatDate(dateOn) : `${DataTable.formatDate(dateOn)}, ${clock}`;
  }

  // ---- recording -------------------------------------------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let members = $state<readonly FirmMemberSummary[]>([]);
  let eventTypes = $state<readonly EventType[]>([]);

  // The roster, the catalog and the session are read once: they change at the pace of a firm, not
  // of a form, and a form that read them on every open would swap its lists under the reader.
  onMount(() => {
    if (isSample) return;
    void (async () => {
      const [sessionRead, membersRead, typesRead] = await Promise.all([
        readSession(fetch),
        listFirmMembers(fetch),
        listEventTypes(fetch),
      ]);
      if (sessionRead.kind === "ok") session = sessionRead.value;
      if (membersRead.kind === "ok") members = membersRead.value.data;
      if (typesRead.kind === "ok") eventTypes = typesRead.value.data;
    })();
  });

  const preferredTimeZones = $derived.by(() => {
    const own = readerTimeZone();
    return own === "" ? [] : [own];
  });

  /** Why recording is unavailable, or undefined when it is. On the control, so the reader is told. */
  const recordRefusal = $derived.by(() => {
    if (isSample) return "A sample matter has no firm to record against";
    if (session !== null && !session.permissions.includes(MANAGE_CALENDAR_PERMISSION)) {
      return "Your account cannot record on the calendar";
    }
    return undefined;
  });

  let eventDialogOpen = $state(false);
  let deadlineDialogOpen = $state(false);
  /** Bumped after a write lands, so the component re-reads its window. */
  let refreshToken = $state(0);

  function recorded(): void {
    refreshToken += 1;
    readBoth(matter.id);
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
        <div class="flex items-center gap-4" role="group" aria-label="Calendar view">
          <Button
            variant={sectionView === "calendar" && calendarView === "month" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Month"
            aria-pressed={sectionView === "calendar" && calendarView === "month"}
            onclick={() => showCalendar("month")}
          >
            <CalendarDays class="size-16" aria-hidden="true" />
          </Button>
          <Button
            variant={sectionView === "calendar" && calendarView === "agenda" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Agenda"
            aria-pressed={sectionView === "calendar" && calendarView === "agenda"}
            onclick={() => showCalendar("agenda")}
          >
            <List class="size-16" aria-hidden="true" />
          </Button>
          <Button
            variant={sectionView === "list" ? "secondary" : "ghost"}
            size="icon"
            aria-label="List"
            aria-pressed={sectionView === "list"}
            onclick={showList}
          >
            <Table class="size-16" aria-hidden="true" />
          </Button>
        </div>
        <Button
          variant="secondary"
          disabled={recordRefusal !== undefined}
          title={recordRefusal}
          onclick={() => (deadlineDialogOpen = true)}
        >
          <Plus aria-hidden="true" />
          Record a deadline
        </Button>
        <Button
          variant="secondary"
          disabled={recordRefusal !== undefined}
          title={recordRefusal}
          onclick={() => (eventDialogOpen = true)}
        >
          <Plus aria-hidden="true" />
          Record an event
        </Button>
      </div>
    </div>
  </div>

  {#if sectionView === "calendar"}
    {#if isSample}
      <EmptyState title="Nothing On A Sample Matter's Calendar">
        This is one of the sample matters the interface is reviewed against. It has no firm behind
        it, so there is nothing on its calendar.
      </EmptyState>
    {:else}
      <CalendarView
        scope={{ kind: "matter", matterId: matter.id }}
        bind:view={calendarView}
        toolbar={true}
        viewSwitch={false}
        address={true}
        {openEntry}
        {refreshToken}
      />
    {/if}
  {:else}
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
  {/if}
</section>

<RecordEventDialog
  bind:open={eventDialogOpen}
  matterId={matter.id}
  matters={[]}
  mattersCapped={false}
  {eventTypes}
  {members}
  {preferredTimeZones}
  initialDate={null}
  onRecorded={recorded}
/>

<RecordDeadlineDialog
  bind:open={deadlineDialogOpen}
  matterId={matter.id}
  matters={[]}
  mattersCapped={false}
  {preferredTimeZones}
  initialDate={null}
  supersedes={null}
  onRecorded={recorded}
/>
