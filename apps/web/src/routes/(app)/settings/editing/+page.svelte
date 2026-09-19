<script lang="ts">
  /*
   * Settings · Editing — what the firm decides once about the documents its members edit in the
   * browser, under Documents. One setting today: whether every document records its changes.
   *
   * LIVE, over GET/PATCH /api/v1/firm/editing-policy, through the standard page
   * (settings-page.svelte) over the shared server-backed draft. The WOPI host reads the same
   * policy on every open, so a save here reaches the next document anybody opens; the edit right
   * is `firm:manageEditingPolicy`, read from the session. A member without it sees the firm's
   * answer engraved as a fact.
   *
   * HISTORY IS WITHHELD, for the reason the calendar page withholds it: the record of a change is
   * the audit row the server writes, and a per-browser ledger would be one browser's recollection
   * of a firm-wide fact.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { MANAGE_EDITING_POLICY_PERMISSION } from "$lib/documents/editing-policy-api.ts";
  import {
    createEditingPolicyDraft,
    EDITING_DEFINITIONS,
    EDITING_SECTION_ID,
  } from "$lib/documents/editing-policy-draft.svelte.ts";

  const draft = createEditingPolicyDraft(fetch);

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_EDITING_POLICY_PERMISSION));

  $effect(() => {
    void sessionPermissions.load(fetch);
  });
</script>

<svelte:head>
  <title>Editing · Settings · Magna Carta</title>
</svelte:head>

<SettingsPage
  sectionId={EDITING_SECTION_ID}
  title="Editing"
  meta="What every document edited in the browser keeps a record of."
  {draft}
  definitions={EDITING_DEFINITIONS}
  {canEdit}
  readLabel="Reading the firm's editing policy"
  readFailureTitle="The Editing Policy Could Not Be Read"
  readFailureFallback="The firm's editing policy was not read."
  saveFailureFallback="The editing policy is unchanged. What you chose is still staged."
  saveFailureWhenSilent="Nothing answered, so the editing policy is unchanged. What you chose is still staged."
/>
