<script lang="ts">
  /*
   * Settings · Deleted Files: how long a deleted file waits in its matter's Trash, and whether it
   * then moves to archive storage. Under Documents, beside File Safety. Neither setting destroys
   * anything; destruction is a separate act the firm has not been given, and the description says
   * so rather than leaving a switch that does nothing.
   *
   * Server-backed over GET/PATCH /api/v1/firm/deleted-file-policy. Every member may read the policy,
   * because each matter's Trash says when a file leaves it; the edit right is
   * `matters:manageRetention`, the same right as the paper file's minimum retention, read from the
   * session.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import {
    AFTER_TRASH_DEFINITION,
    DELETED_FILES_SETTINGS_SECTION_ID,
    TRASH_DAYS_DEFINITION,
    createDeletedFilePolicyDraft,
  } from "$lib/file-manager/deleted-file-policy-draft.svelte.ts";
  import {
    MANAGE_RETENTION_PERMISSION,
    readSession,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";

  const draft = createDeletedFilePolicyDraft();

  let session = $state<SessionBootstrap | null>(null);
  const canEdit = $derived(session?.permissions.includes(MANAGE_RETENTION_PERMISSION) ?? false);

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>Deleted Files · Settings · Magna Carta</title>
</svelte:head>

<SettingsPage
  sectionId={DELETED_FILES_SETTINGS_SECTION_ID}
  title="Deleted Files"
  meta="How long deleted files wait in Trash, and where they go after."
  {draft}
  definitions={[TRASH_DAYS_DEFINITION, AFTER_TRASH_DEFINITION]}
  {canEdit}
  readLabel="Reading the firm's deleted-file policy"
  readFailureTitle="The Deleted-File Policy Could Not Be Read"
  readFailureFallback="The firm's deleted-file policy was not read."
  saveFailureFallback="The deleted-file policy was not changed. What you chose is still staged."
  saveFailureWhenSilent="Couldn't connect. The deleted-file policy is unchanged, and your choice is still here."
/>
