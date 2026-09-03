<script lang="ts">
  /*
   * The firm calendar screen: the body the two routes share.
   *
   * `/calendar` opens on the month and `/calendar/firm-events` on the agenda; the latter is the
   * deep link the federated read emits for a firm event, and it is the same screen with the same
   * scope rather than a second one. The masthead reads the screen's name and nothing under it; its
   * inline-end half carries ONE primary action, Record, as a menu over the three kinds of record —
   * one action with a menu rather than a button per kind (docs/conventions/design-corrections.md).
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
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { calendarContext } from "./calendar-context.svelte.ts";
  import type { CalendarScope } from "./calendar-scope.ts";
  import CalendarView from "./calendar-view.svelte";
  import { todayCivil, type CalendarView as CalendarViewKind } from "./calendar-window.ts";
  import RecordDeadlineDialog from "./record-deadline-dialog.svelte";
  import RecordEventDialog from "./record-event-dialog.svelte";
  import RecordFirmEventDialog from "./record-firm-event-dialog.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let {
    title,
    openEntry,
    initialView,
  }: {
    /** The masthead's word: "Calendar" or "Firm Events". */
    title: string;
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
   * Why Record refuses, if it does. A member without the permission is refused server-side
   * whatever this screen does; the control says so where it stands rather than disappearing.
   */
  const recordRefusal = $derived.by((): string | undefined => {
    if (!context.sessionSettled) return "Reading your session.";
    if (context.session === null) return "Your session could not be read, so nothing can be recorded.";
    if (!context.mayManage) {
      return permissionRefusal("Recording on the calendar", "calendar:manage");
    }
    return undefined;
  });

  const preferredTimeZones = [context.readerTimeZone];

  let eventOpen = $state(false);
  let deadlineOpen = $state(false);
  let firmEventOpen = $state(false);

  function recorded(): void {
    refreshToken += 1;
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-16">
  <Masthead.Root>
    <Masthead.Heading>
      <Masthead.Title>{title}</Masthead.Title>
    </Masthead.Heading>
    <Masthead.Actions>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonClasses({ variant: "primary", size: "default" })}
          disabled={recordRefusal !== undefined}
          title={recordRefusal}
        >
          <Plus class="size-16" aria-hidden="true" />
          Record
          <ChevronDown class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          <DropdownMenu.Item onSelect={() => (eventOpen = true)}>Event on a Matter</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => (deadlineOpen = true)}>
            Deadline on a Matter
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => (firmEventOpen = true)}>Firm Event</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Masthead.Actions>
  </Masthead.Root>

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
