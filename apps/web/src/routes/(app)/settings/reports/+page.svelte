<script lang="ts">
  /*
   * Settings · Reports — what the firm decides once about what its reports list, under Practice.
   * Two settings today, both about the trust-compliance document: whether a ledger at zero all
   * period appears, and whether the member who authorized each payment is named. FIRM settings
   * rather than per-run choices, by the owner's ruling: a compliance document should read the same
   * every time the firm produces it.
   *
   * Server-backed through the standard page (settings-page.svelte): the draft reads and writes
   * GET/PATCH /api/v1/firm/reports/policy and stages nothing into local storage; the edit right is
   * `firm:manageReportPolicy`, read from the session. A member without it sees the firm's answer
   * engraved as a fact. History is withheld: the record of a change is the audit row the server
   * writes.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import {
    REPORT_POLICY_DEFINITIONS,
    REPORTS_SETTINGS_SECTION_ID,
    ReportPolicyDraft,
  } from "$lib/reports/report-policy-draft.svelte.ts";
  import { MANAGE_REPORT_POLICY_PERMISSION } from "$lib/reports/reports-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const draft = new ReportPolicyDraft(fetch);

  let session = $state<SessionBootstrap | null>(null);
  // Read-only until the session says otherwise: a control that appears and then vanishes when
  // the permission turns out to be missing reads as a broken page.
  const canEdit = $derived(session?.permissions.includes(MANAGE_REPORT_POLICY_PERMISSION) ?? false);

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>Reports · Settings · Magna Carta</title>
</svelte:head>

<SettingsPage
  sectionId={REPORTS_SETTINGS_SECTION_ID}
  title="Reports"
  meta="What the firm's reports list, decided once for every copy."
  {draft}
  definitions={REPORT_POLICY_DEFINITIONS}
  {canEdit}
  readLabel="Reading the firm's report policy"
  readFailureTitle="The Report Policy Could Not Be Read"
  readFailureFallback="The firm's report policy was not read."
  saveFailureFallback="The report policy was not changed. What you chose is still staged."
  saveFailureWhenSilent="Couldn't connect. The report policy is unchanged, and your choices are still here."
/>
