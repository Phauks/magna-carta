<script lang="ts">
  /*
   * The window one of the reader's own Outlook or Google events opens in, over fixtures.
   *
   * An own event exists only for a member who connected a calendar account and chose a calendar to
   * be shown, which no local database has. This is the real window (own-event-window.svelte) over
   * one invented event, a short list of matters and three types, so the screen can be reviewed
   * without an account. Add to Matter sends the real request and is refused here, because the
   * matter and the event are not real.
   *
   * Dev builds only, like the developer console itself, behind the import.meta.env.DEV gate.
   */
  import type { ComponentProps } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import OwnEventWindow from "$lib/calendar/own-event-window.svelte";
  import type { OwnAccountEvent } from "$lib/calendar/own-account-events.ts";

  const EVENT: OwnAccountEvent = {
    id: "fixture-own-event",
    provider: "microsoft",
    calendarRemoteId: "fixture-calendar",
    calendarName: "Calendar",
    title: "Call with R. Alvarez",
    location: "Phone",
    wholeDay: false,
    startsOn: null,
    endsOn: null,
    startsAt: "2026-12-03T19:00:00.000Z",
    endsAt: "2026-12-03T19:30:00.000Z",
  };

  const context: ComponentProps<typeof OwnEventWindow>["context"] = {
    sessionSettled: true,
    session: {},
    mayManage: true,
    eventTypes: [
      { id: "fixture-type-call", name: "Client Call", code: null, category: "other", origin: "firm", active: true },
      { id: "fixture-type-meeting", name: "Client Meeting", code: null, category: "other", origin: "firm", active: true },
      { id: "fixture-type-hearing", name: "Hearing", code: "HEARING", category: "litigation", origin: "platform", active: true },
    ],
    matters: [
      { id: "fixture-matter-1", matterNumber: "2026-0412", title: "Alvarez v. Dunmore" },
      { id: "fixture-matter-2", matterNumber: "2026-0388", title: "Estate of Whitcombe" },
      { id: "fixture-matter-3", matterNumber: "2026-0297", title: "Okafor lease review" },
    ],
    mattersCapped: false,
    mattersReading: false,
    readerTimeZone: "America/Los_Angeles",
    memberId: null,
  };

  let open = $state(true);
</script>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default sm:p-24">
    <ScreenHeader title="Own Calendar Event" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
    <div>
      <Button onclick={() => (open = true)}>Open the Window</Button>
    </div>
    <OwnEventWindow bind:open event={EVENT} {context} onAdded={() => undefined} />
  </div>
{/if}
