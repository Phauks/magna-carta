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
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { BackTarget } from "$lib/screen/screen-header.ts";
  import { calendarContext } from "./calendar-context.svelte.ts";
  import type { CalendarScope } from "./calendar-scope.ts";
  import CalendarView from "./calendar-view.svelte";
  import { todayCivil, type CalendarView as CalendarViewKind } from "./calendar-window.ts";
  import RecordDeadlineDialog from "./record-deadline-dialog.svelte";
  import RecordEventDialog from "./record-event-dialog.svelte";
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

  /*
   * What the reader is looking for in the window on screen. It narrows the entries the read plan
   * already walked into the browser, so it answers as fast as they type and makes no request.
   *
   * The window is the scope, deliberately: the three reads behind this screen each cap their
   * horizon server-side and REFUSE a wider one rather than clamping it, so "search the whole
   * record" is not a request that can be made today. The view says which window the count belongs
   * to rather than reporting a bare number, so the control never implies the reach it does not have.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  let eventOpen = $state(false);
  let deadlineOpen = $state(false);
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
   * pointing at a Tuesday afternoon means; the deadline stays on the menu, where choosing it is a
   * decision somebody is already making.
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
  function openFrom(kind: "event" | "deadline"): void {
    startOn = null;
    startAt = null;
    eventOpen = kind === "event";
    deadlineOpen = kind === "deadline";
  }

  /** A minute past midnight as the `HH:MM` a time field holds. */
  function wallClockOf(minuteOfDay: number): string {
    const hour = Math.floor(minuteOfDay / MINUTES_IN_HOUR);
    const minute = minuteOfDay % MINUTES_IN_HOUR;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
</script>

<!--
  THE SCREEN IS THE COMPONENT'S TWO SIDES, and this file frames nothing. The rail of calendars is the
  navigation column of the design system's NavigationLayout, which takes the full height under the
  top bar and cancels the work canvas inset itself — so the masthead goes DOWN into the component
  rather than standing above the whole canvas. The Magnus workspace hands its own header down for
  the same reason.

  It is drawn as a band ACROSS both columns (owner, 2026-09-16), so the screen's name stands over the
  screen rather than over one column of it. The view switch and the window navigation are no longer
  seated beside New: they moved into the content column, over the grid they move, which is where the
  title used to be and where every calendar without a rail has always drawn them.
-->
<CalendarView
  {scope}
  bind:view
  bind:anchor
  address={true}
  rail={true}
  onCreate={startOnDay}
  {openEntry}
  {refreshToken}
  search={appliedSearch}
>
  {#snippet header()}
    <ScreenHeader {title} {back}>
      {#snippet actions()}
        <!-- The search leads the row and grows toward the inline start, so nothing after it moves
             when it opens — the same order as every other Workspace screen. Keystroke, not pause:
             the window's entries are already here, so there is nothing to wait for. -->
        <ScreenSearch
          bind:value={searchText}
          label="Search this calendar"
          fieldClass="w-2xs sm:w-xs"
          onsearch={(next) => {
            appliedSearch = next;
          }}
        />
        <!-- The glyphs are the ones each kind already wears wherever it is named
             (calendar-activity-contribution.ts): one kind, one glyph, across the product. -->
        <!-- Two kinds, not three. A firm event is not a different FORM any more — the event form
             asks who the event belongs to as its first question (owner, 2026-09-16) — so a third
             menu item would be a second way to open the same panel, and the reader would still have
             to decide before they opened anything. -->
        <CreateControl
          title="Record an event or a deadline."
          refusal={recordRefusal}
          choices={[
            { label: "New Event", icon: CalendarDays, onselect: () => openFrom("event") },
            { label: "New Deadline", icon: CalendarClock, onselect: () => openFrom("deadline") },
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
  {/snippet}
</CalendarView>

<RecordEventDialog
  bind:open={eventOpen}
  matterId={null}
  matters={context.matters}
  mattersCapped={context.mattersCapped}
  mattersReading={context.mattersReading}
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
  mattersReading={context.mattersReading}
  {preferredTimeZones}
  initialDate={formDate}
  supersedes={null}
  onRecorded={recorded}
/>


