<script lang="ts">
  /*
   * Home — the Dashboard archetype's stage-1 form: the masthead over the first widget and an
   * honest empty state for the rest. The widget grid (my tasks / today / needs attention)
   * assembles here as its slices ship; nothing is faked meanwhile.
   *
   * THE MASTHEAD STATES THE SCREEN'S NAME, like every other main screen — it does not greet. The
   * daypart greeting that stood here was the one main-page title that was not the destination's
   * own name, which cost the sidebar and the screen a shared vocabulary for nothing a reader
   * gains. The date stays: it is a fact the dashboard is read against, not a description of the
   * screen.
   *
   * THE TODAY CARD IS THE CALENDAR, NARROWED. It is the one calendar component with the reader's
   * own scope, the agenda over today and tomorrow, headless, capped at six rows with a line to the
   * rest. Home writes no calendar read of its own: the card cannot disagree with the screen it
   * points at, because it is the same component over the same reads. While the session is still
   * being read the card is a LoadingRegion over the same agenda with sample entries in it, so the
   * placeholder is the card itself.
   */
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import * as CalendarGrid from "@magna-carta/design-system/calendar-grid";
  import type { CalendarGridEntry } from "@magna-carta/design-system/calendar-grid";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { calendarContext } from "$lib/calendar/calendar-context.svelte.ts";
  import { CalendarView } from "$lib/calendar/index.ts";
  import { shiftAnchor, todayCivil } from "$lib/calendar/calendar-window.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { sampleMatter, sampleOrganization } from "@magna-carta/design-system/loading-fixtures";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";

  const now = new Date();
  const today = formatInstantDate(now, { length: "full" });

  /** Today and tomorrow: the span a person checks before the day starts. */
  const TODAY_CARD_DAYS = 2;
  /** Six rows: a card, not a screen. The rest is one press away. */
  const TODAY_CARD_ROWS = 6;

  // The loading fixture: three invented entries across today and tomorrow, in the agenda the card
  // really draws. The matters and the organization come from the sample vocabulary, never a
  // reader's own calendar; the kinds of entry are this card's own words.
  const fixtureToday = todayCivil();
  const fixtureTomorrow = shiftAnchor("agenda", fixtureToday, 1, 1);
  const TODAY_CARD_FIXTURE: readonly CalendarGridEntry[] = [
    {
      id: "fixture-conference",
      date: fixtureToday,
      time: "9:30 AM",
      label: "Status conference",
      detail: sampleMatter(3).title,
      tone: "info",
    },
    {
      id: "fixture-response",
      date: fixtureToday,
      time: "5:00 PM",
      label: "Response due",
      detail: sampleMatter(1).title,
      tone: "warning",
    },
    {
      id: "fixture-meeting",
      date: fixtureTomorrow,
      time: "11:00 AM",
      label: "Client meeting",
      detail: sampleOrganization(1).name,
      tone: "neutral",
    },
  ];

  const context = calendarContext;
  $effect(() => {
    void context.load(fetch);
  });

  /** The same re-ask the failure notice offers, so the region's stalled line asks the same way. */
  function retrySession(): void {
    void context.reload(fetch);
  }
</script>

<svelte:head>
  <title>Home · Magna Carta</title>
</svelte:head>

<ScreenHeader
  title="Home"
  class="mb-24"
>
  {#snippet meta()}
    <span>{today}</span>
  {/snippet}
</ScreenHeader>

<div class="mb-24 grid grid-cols-1 gap-16 lg:grid-cols-3">
  <Card.Root>
    <Card.Header class="flex flex-row items-baseline justify-between gap-8">
      <Card.Title>Today</Card.Title>
      <Button variant="ghost" size="sm" href="/calendar?scope=mine&view=agenda">Open calendar</Button>
    </Card.Header>
    <Card.Content class="flex flex-col gap-12">
      <!-- The region holds the session read's state set: a failed read settles the card to the
           notice with Retry, and a session that already landed keeps its calendar even if a later
           re-read fails. -->
      <LoadingRegion
        loading={context.memberId === null}
        failed={context.memberId === null && context.sessionFailure !== null}
        label="Reading your calendar"
        onRetry={retrySession}
        class="flex flex-col gap-12"
      >
        {#snippet failure()}
          {#if context.sessionFailure !== null}
            <FailureNotice
              failure={context.sessionFailure}
              title="Your Day Could Not Be Read"
              fallback="Who is asking could not be read, so what is on your calendar today cannot be shown."
              onRetry={retrySession}
            />
          {/if}
        {/snippet}
        {#snippet fixture()}
          <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto">
            <CalendarGrid.Agenda
              class="h-full"
              entries={TODAY_CARD_FIXTURE}
              label="Today and tomorrow"
              from={fixtureToday}
              to={fixtureTomorrow}
            />
          </div>
        {/snippet}
        {#if context.memberId !== null}
          <CalendarView
            scope={{ kind: "mine", memberId: context.memberId }}
            view="agenda"
            anchor={todayCivil()}
            toolbar={false}
            agendaDays={TODAY_CARD_DAYS}
            limit={TODAY_CARD_ROWS}
          />
        {/if}
      </LoadingRegion>
    </Card.Content>
  </Card.Root>
</div>

<EmptyState title="The rest of your day assembles here">
  Your tasks and matters will appear here. Open your first matter to start.
  {#snippet actions()}
    <Button variant="primary" href="/matters">Go to matters</Button>
  {/snippet}
</EmptyState>

<!-- Quote of the day — the dashboard's heritage colophon (placement owner-approved as an option;
     rotation + accurate-citation set arrives with the dashboard proper).

     THE ARCHIVE LINK CONTRACT (owner, 2026-07-03): the quote itself is the door to the Quote
     Archive site — the public record of every day's quote with its source and associated
     documents. Plain text today (never a dead link); when that site exists, the quote wraps in
     an anchor to the day's entry (the archive's base URL — a constant introduced here when the
     site ships, deliberately NOT an ecosystem-sites row: the archive is reached only through
     the quote — plus a date path). -->
<footer
  class="mt-40 flex items-baseline justify-center gap-8 border-t border-border-default pt-12 text-sm"
>
  <!-- The display face has no utility on purpose (it enters through Masthead); a heritage quote
       is the other sanctioned door, so it reads the token directly. -->
  <span class="italic text-text-muted" style="font-family: var(--mc-font-display)">
    "We will sell to no man, we will not deny or defer to any man either Justice or Right."
  </span>
  <cite class="text-xs whitespace-nowrap text-subtle not-italic">Magna Carta, 1297 · ch. XXIX</cite>
</footer>
