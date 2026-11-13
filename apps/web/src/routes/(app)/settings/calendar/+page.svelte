<script lang="ts">
  /*
   * Settings · Calendar — what the firm decides once about how it reads its own calendar, under
   * Practice. One setting today: the day the week begins on. A FIRM setting rather than a personal
   * preference, by the owner's ruling: the week is the unit a firm plans in, and two members
   * looking at the same week must see the same grid.
   *
   * The first settings page with a server behind it, rendered through the standard page
   * (settings-page.svelte): the draft reads and writes GET/PATCH /api/v1/calendar/settings
   * (calendar-settings-draft), so nothing here stages into local storage; the edit right is the
   * calendar's own `calendar:manage`, read from the session, because the settings permission seam
   * is still a mock. A member without it sees the firm's answer engraved as a fact. History is
   * withheld: the record of a change is the audit row the server writes, and a per-browser ledger
   * would misstate a firm-wide fact.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import { mayManageCalendar } from "$lib/calendar/calendar-permission.ts";
  import {
    createCalendarSettingsDraft,
    CALENDAR_SETTINGS_SECTION_ID,
    WEEK_STARTS_ON_DEFINITION,
  } from "$lib/calendar/calendar-settings-draft.svelte.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const draft = createCalendarSettingsDraft(fetch);

  let session = $state<SessionBootstrap | null>(null);
  // Read-only until the session says otherwise: a control that appears and then vanishes when
  // the permission turns out to be missing reads as a broken page.
  const canEdit = $derived(mayManageCalendar(session));

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>Calendar · Settings · Magna Carta</title>
</svelte:head>

<SettingsPage
  sectionId={CALENDAR_SETTINGS_SECTION_ID}
  title="Calendar"
  meta="How every calendar in the firm is read."
  {draft}
  definitions={[WEEK_STARTS_ON_DEFINITION]}
  {canEdit}
  readLabel="Reading the firm's calendar settings"
  readFailureTitle="The Calendar Settings Could Not Be Read"
  readFailureFallback="The firm's calendar settings were not read."
  saveFailureFallback="The first day of the week was not changed. What you chose is still staged."
  saveFailureWhenSilent="Couldn't connect. The first day of the week is unchanged, and your choice is still here."
/>
