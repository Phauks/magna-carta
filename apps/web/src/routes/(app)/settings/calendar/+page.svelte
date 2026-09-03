<script lang="ts">
  /*
   * Settings · Calendar — what the firm decides once about how it reads its own calendar, under
   * Practice. One setting today: the day the week begins on. A FIRM setting rather than a personal
   * preference, by the owner's ruling: the week is the unit a firm plans in, and two members
   * looking at the same week must see the same grid.
   *
   * The first settings page with a server behind it. The draft it renders through the shared row
   * and footer reads and writes GET/PATCH /api/v1/calendar/settings (calendar-settings-draft), so
   * nothing here stages into local storage; the edit right is the calendar's own `calendar:manage`,
   * read from the session, because the settings permission seam is still a mock. A member without
   * it sees the firm's answer engraved as a fact. History is withheld: the record of a change is
   * the audit row the server writes, and a per-browser ledger would misstate a firm-wide fact.
   */
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { MANAGE_CALENDAR_PERMISSION } from "$lib/calendar/calendar-api.ts";
  import {
    CalendarSettingsDraft,
    CALENDAR_SETTINGS_SECTION_ID,
    WEEK_STARTS_ON_DEFINITION,
  } from "$lib/calendar/calendar-settings-draft.svelte.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const draft = new CalendarSettingsDraft(fetch);

  let session = $state<SessionBootstrap | null>(null);
  // Read-only until the session says otherwise: a control that appears and then vanishes when
  // the permission turns out to be missing reads as a broken page.
  const canEdit = $derived(session?.permissions.includes(MANAGE_CALENDAR_PERMISSION) ?? false);

  $effect(() => {
    void draft.load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>Calendar · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId={CALENDAR_SETTINGS_SECTION_ID}
  title="Calendar"
  meta="How every calendar in the firm is read."
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
  showHistory={false}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    {#if draft.readFailure !== null && !draft.loaded}
      <FailureNotice
        failure={draft.readFailure}
        title="The Calendar Settings Could Not Be Read"
        fallback="The firm's calendar settings were not read."
        onRetry={() => void draft.load()}
      />
    {/if}

    {#if draft.saveFailure !== null}
      <FailureNotice
        failure={draft.saveFailure}
        title="The Change Was Not Saved"
        fallback="The first day of the week was not changed. What you chose is still staged."
        whenSilent="Nothing answered, so the first day of the week was not changed. What you chose is still staged."
        onRetry={() => void draft.commit()}
      />
    {/if}

    <SettingsPlate heading="The Week">
      {#if draft.loaded}
        {#if canEdit}
          <SettingsRow definition={WEEK_STARTS_ON_DEFINITION} {draft} />
        {:else}
          <SettingsRow
            definition={WEEK_STARTS_ON_DEFINITION}
            value={draft.value(WEEK_STARTS_ON_DEFINITION)}
          />
        {/if}
      {:else if draft.readFailure === null}
        <p class="py-12 text-sm text-text-muted" aria-busy="true">Reading the firm's settings.</p>
      {/if}
    </SettingsPlate>
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
