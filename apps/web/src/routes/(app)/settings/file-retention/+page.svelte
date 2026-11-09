<script lang="ts">
  /*
   * Settings · File Retention — the firm's minimum retention for a closed matter's paper file,
   * under Practice. Closing a matter asks for the date its paper file may be destroyed after: at
   * least this many years after the close, a later date, or none (owner ruling, 2026-11-09). The
   * period is the firm's jurisdiction's and policy's, so the platform holds none of its own: 0, the
   * value of a firm that has never opened this page, is "no minimum". Nothing is destroyed when a
   * date arrives; the dates are reminders on the calendar.
   *
   * Rendered through the standard page on the Calendar page's pattern: the draft reads and writes
   * GET/PATCH /api/v1/matters/settings and stages nothing locally, and the edit right is
   * `matters:manageRetention`, read from the session. A member without it sees the firm's answer as
   * a fact; every member may read it, because every close is measured against it.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import {
    createFileRetentionSettingsDraft,
    FILE_RETENTION_MINIMUM_YEARS_DEFINITION,
    FILE_RETENTION_SETTINGS_SECTION_ID,
  } from "$lib/matters/file-retention-settings-draft.svelte.ts";
  import {
    MANAGE_RETENTION_PERMISSION,
    readSession,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";

  const draft = createFileRetentionSettingsDraft(fetch);

  let session = $state<SessionBootstrap | null>(null);
  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(session?.permissions.includes(MANAGE_RETENTION_PERMISSION) ?? false);

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>File Retention · Settings · Magna Carta</title>
</svelte:head>

<SettingsPage
  sectionId={FILE_RETENTION_SETTINGS_SECTION_ID}
  title="File Retention"
  meta="How long the firm keeps a closed matter's paper file."
  {draft}
  definitions={[FILE_RETENTION_MINIMUM_YEARS_DEFINITION]}
  {canEdit}
  readLabel="Reading the firm's retention setting"
  readFailureTitle="The Retention Setting Could Not Be Read"
  readFailureFallback="The firm's minimum retention was not read."
  saveFailureFallback="The minimum retention was not changed. What you chose is still staged."
  saveFailureWhenSilent="Nothing answered, so the minimum retention was not changed. What you chose is still staged."
/>
