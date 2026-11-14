<script lang="ts">
  /*
   * The matter's calendar — the settings recorded against it and the dates it is held to.
   *
   * THREE WAYS TO READ ONE RECORD, ALL OF THEM THE CALENDAR MODULE'S. The List is the module's own
   * list component with this matter: two tables, deadlines then events, walked to the end. Month
   * and Agenda are the one calendar component with this matter's scope: a window over the same
   * record. The page reads nothing itself: the shared context holds the session, the roster and
   * the catalog, and the list component owns its own reads.
   *
   * RECORDING HAPPENS HERE, with the matter fixed. The header's create control opens the record
   * forms; it is disabled only where the session cannot record on the calendar or the matter is a
   * sample, and the reason is on the control. After a write lands the refresh token is bumped, and
   * whichever view is showing reads its record again, so the new row appears without a reload.
   *
   * THE ADDRESS CARRIES THE VIEW. `view` is `list`, `month` or `agenda` (the component mirrors its
   * own views and the anchor date; this page mirrors `list`, which the component does not know);
   * `entry` is the deep link the federated read emits for a matter event, and arriving on it with
   * the section on List opens the Agenda, because the entry window belongs to the component.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has
   * no firm behind it and therefore nothing to read; it says so rather than showing an empty grid,
   * because "nothing recorded" and "not a real matter" are different facts.
   */
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import List from "@lucide/svelte/icons/list";
  import Table from "@lucide/svelte/icons/table";
  import { CalendarView, MatterCalendarList } from "$lib/calendar/index.ts";
  import { calendarContext } from "$lib/calendar/calendar-context.svelte.ts";
  import { calendarManageRefusal } from "$lib/calendar/calendar-permission.ts";
  import { isCalendarView, type CalendarView as CalendarViewName } from "$lib/calendar/calendar-window.ts";
  import RecordDeadlineDialog from "$lib/calendar/record-deadline-dialog.svelte";
  import RecordEventDialog from "$lib/calendar/record-event-dialog.svelte";
  import { claimMatterCreate } from "$lib/matters/create-action.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  // The session, the catalog and the roster are the page's shared context, read once for every
  // calendar surface on the page; the first surface to need them loads them.
  const context = calendarContext;
  $effect(() => {
    void context.load(fetch);
  });

  // ---- the section's view ----------------------------------------------------------------------

  /** Which of the section's views is showing; `calendar` is the component in one of its views. */
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

  // ---- recording -------------------------------------------------------------------------------

  /*
   * Recording goes through the matter header's one create control (the registry says this section
   * makes several kinds, so the control reads the bare "New"; this page claims it while it is
   * mounted): an event or a deadline, each opening its own form. Each item carries the verb — a
   * menu item is where the choice is actually made, so it names the whole thing being made. The
   * refusal is one line for the whole control (the session's permission, or the sample matter) and
   * the same line on each choice, because both record against the same matter.
   *
   * The glyphs are the ones each kind wears wherever it is named
   * (`$lib/matters/calendar-activity-contribution.ts`): one kind, one glyph, across the product.
   */
  claimMatterCreate("calendar", () => ({
    title: "Record an event or a deadline on this matter.",
    refusal: recordRefusal,
    choices: [
      {
        label: "New Event",
        icon: CalendarDays,
        run: () => (eventDialogOpen = true),
        refusal: recordRefusal,
      },
      {
        label: "New Deadline",
        icon: CalendarClock,
        run: () => (deadlineDialogOpen = true),
        refusal: recordRefusal,
      },
    ],
  }));

  /** Why recording is unavailable, or undefined when it is. On the control, so the reader is told. */
  const recordRefusal = $derived.by((): string | undefined => {
    if (isSample) return "A sample matter has no firm to record against";
    return calendarManageRefusal("Recording on the calendar", context);
  });

  const preferredTimeZones = [context.readerTimeZone];

  let eventDialogOpen = $state(false);
  let deadlineDialogOpen = $state(false);
  /** Bumped after a write lands, so whichever view is showing reads its record again. */
  let refreshToken = $state(0);

  function recorded(): void {
    refreshToken += 1;
  }
</script>

<svelte:head>
  <title>Calendar · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8 border-b border-border-strong pb-8">
    <div class="flex items-center justify-between gap-16">
      <FieldLabel as="h2">
        Calendar
      </FieldLabel>
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
      </div>
    </div>
  </div>

  {#if sectionView === "calendar"}
    {#if isSample}
      <EmptyState title="Nothing On A Sample Matter's Calendar">
        This is a sample matter for previewing screens. It has nothing on its calendar.
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
    <MatterCalendarList matterId={matter.id} {isSample} {refreshToken} />
  {/if}
</section>

<RecordEventDialog
  bind:open={eventDialogOpen}
  matterId={matter.id}
  matters={context.matters}
  mattersCapped={context.mattersCapped}
  eventTypes={context.eventTypes}
  members={context.members}
  {preferredTimeZones}
  initialDate={null}
  onRecorded={recorded}
/>

<RecordDeadlineDialog
  bind:open={deadlineDialogOpen}
  matterId={matter.id}
  matters={context.matters}
  mattersCapped={context.mattersCapped}
  {preferredTimeZones}
  initialDate={null}
  supersedes={null}
  onRecorded={recorded}
/>
