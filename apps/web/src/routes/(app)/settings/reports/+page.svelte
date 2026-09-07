<script lang="ts">
  /*
   * Settings · Reports — what the firm decides once about what its reports list, under Practice.
   * Two settings today, both about the trust-compliance document: whether a ledger at zero all
   * period appears, and whether the member who authorized each payment is named. FIRM settings
   * rather than per-run choices, by the owner's ruling: a compliance document should read the same
   * every time the firm produces it.
   *
   * Server-backed on the calendar settings page's pattern: the draft reads and writes
   * GET/PATCH /api/v1/firm/reports/policy and stages nothing into local storage; the edit right is
   * `firm:manageReportPolicy`, read from the session. A member without it sees the firm's answer
   * engraved as a fact. History is withheld: the record of a change is the audit row the server
   * writes.
   */
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
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
    void draft.load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>Reports · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId={REPORTS_SETTINGS_SECTION_ID}
  title="Reports"
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
  showHistory={false}
/>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsDescription>What the firm's reports list, decided once for every copy.</SettingsDescription>

    {#if draft.saveFailure !== null}
      <FailureNotice
        failure={draft.saveFailure}
        title="The Change Was Not Saved"
        fallback="The report policy was not changed. What you chose is still staged."
        whenSilent="Nothing answered, so the report policy was not changed. What you chose is still staged."
        onRetry={() => void draft.commit()}
      />
    {/if}

    <SettingsPlate heading="The Trust Compliance Report">
      <LoadingRegion
        loading={!draft.loaded}
        failed={draft.readFailure !== null && !draft.loaded}
        label="Reading the firm's report policy"
        onRetry={() => void draft.load()}
      >
        {#snippet failure()}
          {#if draft.readFailure !== null}
            <FailureNotice
              failure={draft.readFailure}
              title="The Report Policy Could Not Be Read"
              fallback="The firm's report policy was not read."
              onRetry={() => void draft.load()}
            />
          {/if}
        {/snippet}
        {#snippet fixture()}
          {#each REPORT_POLICY_DEFINITIONS as definition (definition.id)}
            <SettingsRow {definition} value={definition.defaultValue} />
          {/each}
        {/snippet}
        {#each REPORT_POLICY_DEFINITIONS as definition (definition.id)}
          {#if canEdit}
            <SettingsRow {definition} {draft} />
          {:else}
            <SettingsRow {definition} value={draft.value(definition)} />
          {/if}
        {/each}
      </LoadingRegion>
    </SettingsPlate>
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
