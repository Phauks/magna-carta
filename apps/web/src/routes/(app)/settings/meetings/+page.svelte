<script lang="ts">
  /*
   * Settings · Meetings — whether the firm's meetings may be recorded, summarized and captioned,
   * and how many people one recording hears at once, under Practice.
   *
   * LIVE, over GET/PATCH /api/v1/firm/meetings/settings, through the standard page
   * (settings-page.svelte) over the shared server-backed draft. The recording start route, the
   * recorder and the summary consumer read the same four settings, so a save here reaches the next
   * meeting anybody records; the edit right is `meetings:manageSettings`, read from the session.
   *
   * TWO THINGS BENEATH TWO ROWS, BOTH READ AND NEITHER WRITTEN HERE. A switch alone would let a firm
   * believe something untrue, so the page states the two facts the read carries where they bear:
   * beneath Record Meetings, that this deployment's recording service is not configured yet (only
   * while it is not, because a recording cannot start until it is, whatever the switch says); and
   * beneath the summary switch, that a summary also needs third-party AI processing, whether that is
   * on, and the way to the page that sets it.
   *
   * THE CEILING'S ROW IS COMPOSED FROM THE READ, so the maximum it states is the server's.
   *
   * HISTORY IS WITHHELD, for the reason the calendar page withholds it: the record of a change is
   * the audit row the server writes, and a per-browser ledger would be one browser's recollection
   * of a firm-wide fact.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { MANAGE_MEETING_SETTINGS_PERMISSION } from "$lib/settings/meeting-settings-api.ts";
  import {
    createMeetingSettingsDraft,
    meetingSettingsDefinitions,
    MEETINGS_SECTION_ID,
    RECORDING_ENABLED_DEFINITION,
    SUMMARIES_ENABLED_DEFINITION,
  } from "$lib/settings/meeting-settings-draft.svelte.ts";

  const draft = createMeetingSettingsDraft(fetch);

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_MEETING_SETTINGS_PERMISSION));

  const definitions = $derived(
    meetingSettingsDefinitions(draft.committed?.recordedTrackCeilingMaximum),
  );

  $effect(() => {
    void sessionPermissions.load(fetch);
  });
</script>

<svelte:head>
  <title>Meetings · Settings · Magna Carta</title>
</svelte:head>

{#snippet afterRow(definition: SettingDefinition)}
  {#if draft.committed !== null}
    {#if definition.id === RECORDING_ENABLED_DEFINITION.id && !draft.committed.recordingServiceConfigured}
      <SettingsPlateNote>
        The platform's recording service is not configured yet, so no meeting can start a
        recording until it is, whatever this switch says.
      </SettingsPlateNote>
    {:else if definition.id === SUMMARIES_ENABLED_DEFINITION.id}
      <SettingsPlateNote>
        {#if draft.committed.aiProcessingEligible}
          A summary also needs third-party AI processing, which is on in
          <a class="underline underline-offset-2" href="/settings/ai">AI and the Assistant</a>.
        {:else}
          A summary also needs third-party AI processing, which is off in
          <a class="underline underline-offset-2" href="/settings/ai">AI and the Assistant</a>, so no
          summary is written until it is switched on there.
        {/if}
      </SettingsPlateNote>
    {/if}
  {/if}
{/snippet}

<SettingsPage
  sectionId={MEETINGS_SECTION_ID}
  title="Meetings"
  meta="Whether the firm's meetings may be recorded, summarized and captioned, and how many people one recording hears. Each switch is off until the firm turns it on."
  {draft}
  {definitions}
  {canEdit}
  readLabel="Reading the firm's meeting settings"
  readFailureTitle="The Meeting Settings Could Not Be Read"
  readFailureFallback="The firm's meeting settings were not read."
  saveFailureFallback="The meeting settings are unchanged. What you chose is still staged."
  saveFailureWhenSilent="Nothing answered, so the meeting settings are unchanged. What you chose is still staged."
  {afterRow}
/>
