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
   */
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import Building2 from "@lucide/svelte/icons/building-2";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
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
  let firmEventOpen = $state(false);

  function recorded(): void {
    refreshToken += 1;
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader {title} {back}>
    {#snippet actions()}
      <!-- The search leads the row and grows toward the inline start, so the create control at the
           row's end never moves when it opens — the same order as every other Workspace screen.
           Keystroke, not pause: the window's entries are already here, so there is nothing to wait
           for. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search this calendar"
        placeholder={placeholderOf("Search this calendar")}
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <!-- The glyphs are the ones each kind already wears wherever it is named
           (calendar-activity-contribution.ts): one kind, one glyph, across the product. -->
      <CreateControl
        title="Record an event, a deadline or a firm event."
        refusal={recordRefusal}
        choices={[
          { label: "New Event", icon: CalendarDays, onselect: () => (eventOpen = true) },
          { label: "New Deadline", icon: CalendarClock, onselect: () => (deadlineOpen = true) },
          { label: "New Firm Event", icon: Building2, onselect: () => (firmEventOpen = true) },
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
    {openEntry}
    {refreshToken}
    search={appliedSearch}
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
  {preferredTimeZones}
  initialDate={anchor}
  onRecorded={recorded}
/>

<RecordDeadlineDialog
  bind:open={deadlineOpen}
  matterId={null}
  matters={context.matters}
  mattersCapped={context.mattersCapped}
  {preferredTimeZones}
  initialDate={anchor}
  supersedes={null}
  onRecorded={recorded}
/>

<RecordFirmEventDialog
  bind:open={firmEventOpen}
  eventTypes={context.eventTypes}
  members={context.members}
  locations={context.locations}
  {preferredTimeZones}
  initialDate={anchor}
  onRecorded={recorded}
/>
