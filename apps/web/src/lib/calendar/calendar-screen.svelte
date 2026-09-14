<script lang="ts">
  /*
   * The firm calendar screen: the body the two routes share.
   *
   * `/calendar` opens on the month and `/calendar/firm-events` on the agenda; the latter is the
   * deep link the federated read emits for a firm event, and it is the same screen with the same
   * scope rather than a second one. The header reads the screen's name and nothing under it; its
   * inline-end half carries ONE primary action, the design system's CreateControl, as a menu over
   * the three kinds of record — one action with a menu rather than a button per kind
   * (docs/conventions/design-corrections.md).
   *
   * IT READS THE BARE "NEW", and its menu names the kinds. The control offers three things, so a
   * label naming one of them would be wrong about the other two; the noun goes on the menu items,
   * which is the grammar CreateControl already speaks. It was a hand-built dropdown reading
   * "Record" until 2026-09-06 — the create verb this product uses is New, and the one control that
   * says it is the design system's, never a button a screen assembles for itself.
   *
   * `back` is the caller's, because only the route knows whether it is the calendar or a screen
   * under it: /calendar is a main screen and names nothing, /calendar/firm-events names the
   * calendar it was opened from.
   *
   * THE SCOPE COMES FROM THE ADDRESS. `scope=mine` opens the reader's own calendar once the session
   * says who they are; anything else opens on Everyone, because a calendar's first job is the
   * firm's day and a screen that opened narrow would teach a reader that the rest is elsewhere.
   * From there the component's own toggle moves it and the address remembers.
   *
   * Recording lands in the same window the grid reads, so a recorded entry is painted by bumping
   * the component's refresh token rather than by this screen reading anything of its own.
   *
   * DOUBLE-CLICKING AN EMPTY DAY OR HOUR OPENS THE EVENT FORM ON IT (owner ruling, 2026-09-14). The
   * grid reports the gesture and this screen decides what it means, because only a screen knows
   * which form it owns; the day and the hour are handed to the form as its opening answers, so the
   * gesture is a shortcut to a filled-in date rather than a second way to record something.
   */
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import CreateControl from "@magna-carta/design-system/create-control";
  import { MINUTES_IN_HOUR } from "@magna-carta/design-system/calendar-grid";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import Building2 from "@lucide/svelte/icons/building-2";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { BackTarget } from "$lib/screen/screen-header.ts";
  import { calendarContext } from "./calendar-context.svelte.ts";
  import type { CalendarScope } from "./calendar-scope.ts";
  import CalendarView from "./calendar-view.svelte";
  import { todayCivil, type CalendarView as CalendarViewKind } from "./calendar-window.ts";
  import RecordDeadlineDialog from "./record-deadline-dialog.svelte";
  import RecordEventDialog from "./record-event-dialog.svelte";
  import RecordFirmEventDialog from "./record-firm-event-dialog.svelte";
  import { calendarManageRefusal } from "./calendar-permission.ts";

  let {
    title,
    back,
    openEntry,
    initialView,
  }: {
    /** The header's word: "Calendar" or "Firm Events". */
    title: string;
    /** The screen this one was entered from, on the route that sits under another. */
    back?: BackTarget;
    /** The entry the address asks to open on arrival, or null. */
    openEntry: string | null;
    /** The view the route opens on. */
    initialView: CalendarViewKind;
  } = $props();

  const context = calendarContext;
  $effect(() => {
    void context.load(fetch);
  });

  let view = $state<CalendarViewKind>(untrack(() => initialView));
  let anchor = $state(todayCivil());
  let refreshToken = $state(0);

  // Read once, on arrival: from here the component's toggle owns the choice and mirrors it back.
  const wantsMine = untrack(() => page.url.searchParams.get("scope") === "mine");
  const scope = $derived.by((): CalendarScope => {
    const memberId = context.memberId;
    return wantsMine && memberId !== null ? { kind: "mine", memberId } : { kind: "firm" };
  });

  /*
   * Why the control refuses, if it does. A member without the permission is refused server-side
   * whatever this screen does; the control says so where it stands rather than disappearing.
   */
  const recordRefusal = $derived(calendarManageRefusal("Recording on the calendar", context));

  const preferredTimeZones = [context.readerTimeZone];

  let eventOpen = $state(false);
  let deadlineOpen = $state(false);
  let firmEventOpen = $state(false);
  /**
   * The day and hour a double-click landed on, which the form opens with. Null until one does, and
   * left as it was afterwards: reopening the form from the menu on the same day is the same answer.
   */
  let startOn = $state<string | null>(null);
  let startAt = $state<string | null>(null);

  /** The day the forms open on: the one somebody pointed at, else the window's own anchor. */
  const formDate = $derived(startOn ?? anchor);

  function recorded(): void {
    refreshToken += 1;
  }

  /**
   * A double-click on an empty day or hour. It opens the EVENT form, which is the record a person
   * pointing at a Tuesday afternoon means; the other two kinds stay on the menu, where choosing
   * between them is a decision somebody is already making.
   */
  function startOnDay(date: string, minuteOfDay?: number): void {
    if (recordRefusal !== undefined) return;
    startOn = date;
    startAt = minuteOfDay === undefined ? null : wallClockOf(minuteOfDay);
    eventOpen = true;
  }

  /**
   * The menu's own path in. It clears the day a double-click left behind: choosing New Event from
   * the header means the window on screen, not the Tuesday somebody pointed at ten minutes ago.
   */
  function openFrom(kind: "event" | "deadline" | "firmEvent"): void {
    startOn = null;
    startAt = null;
    eventOpen = kind === "event";
    deadlineOpen = kind === "deadline";
    firmEventOpen = kind === "firmEvent";
  }

  /** A minute past midnight as the `HH:MM` a time field holds. */
  function wallClockOf(minuteOfDay: number): string {
    const hour = Math.floor(minuteOfDay / MINUTES_IN_HOUR);
    const minute = minuteOfDay % MINUTES_IN_HOUR;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader {title} {back}>
    {#snippet actions()}
      <!-- The glyphs are the ones each kind already wears wherever it is named
           (calendar-activity-contribution.ts): one kind, one glyph, across the product. -->
      <CreateControl
        title="Record an event, a deadline or a firm event."
        refusal={recordRefusal}
        choices={[
          { label: "New Event", icon: CalendarDays, onselect: () => openFrom("event") },
          { label: "New Deadline", icon: CalendarClock, onselect: () => openFrom("deadline") },
          { label: "New Firm Event", icon: Building2, onselect: () => openFrom("firmEvent") },
        ]}
      />
    {/snippet}
  </ScreenHeader>

  {#if context.sessionFailure !== null}
    <FailureNotice
      failure={context.sessionFailure}
      title="Your Session Could Not Be Read"
      fallback="Who is asking could not be read, so the calendar opens on everyone and nothing can be recorded."
    />
  {/if}

  <CalendarView
    {scope}
    bind:view
    bind:anchor
    address={true}
    rail={true}
    onCreate={startOnDay}
    {openEntry}
    {refreshToken}
    class="min-h-0 flex-1"
  />
</div>

<RecordEventDialog
  bind:open={eventOpen}
  matterId={null}
  matters={context.matters}
  mattersCapped={context.mattersCapped}
  eventTypes={context.eventTypes}
  members={context.members}
  locations={context.locations}
  resources={context.resources}
  {preferredTimeZones}
  initialDate={formDate}
  initialTime={startAt}
  onRecorded={recorded}
/>

<RecordDeadlineDialog
  bind:open={deadlineOpen}
  matterId={null}
  matters={context.matters}
  mattersCapped={context.mattersCapped}
  {preferredTimeZones}
  initialDate={formDate}
  supersedes={null}
  onRecorded={recorded}
/>

<RecordFirmEventDialog
  bind:open={firmEventOpen}
  eventTypes={context.eventTypes}
  members={context.members}
  locations={context.locations}
  resources={context.resources}
  {preferredTimeZones}
  initialDate={formDate}
  initialTime={startAt}
  onRecorded={recorded}
/>
