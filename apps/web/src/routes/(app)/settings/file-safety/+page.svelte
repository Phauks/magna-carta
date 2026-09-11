<script lang="ts">
  /*
   * Settings · File Safety & Scanning — the firm's stance toward what its uploads are allowed to
   * do, under Documents.
   *
   * LIVE, over GET/PATCH /api/v1/firm/scan-policy. The per-firm scan-policy engine was already
   * there — the ingest consumer reads it at queue-consume time and the download route reads it at
   * access time — so what changes here reaches both without re-ingesting anything, and a save is
   * audited by the route rather than remembered by this browser.
   *
   * The page stages through the shared server-backed draft, so the rows, the footer's pending count
   * and its confirmation recap are the settings surface's own anatomy rather than a second copy of
   * it. Nothing touches local storage: a firm setting with a server behind it must not keep a
   * per-browser copy that can disagree with the firm.
   *
   * HISTORY IS WITHHELD, for the reason the calendar page withholds it: the record of a change is
   * the audit row the server writes, and a per-browser ledger would be one browser's recollection
   * of a firm-wide fact, silent about every change a colleague made.
   *
   * THE THRESHOLD IS A NUMBER HERE, AND WANTS TO BE A PLOT. The engine publishes the score
   * distribution of its own rule corpus (`/api/v1/firm/scan-policy/score-histogram`), which is what
   * makes a threshold answerable rather than a number in a vacuum — a firm should be able to see
   * how many rules it is about to start trusting. That control is its own piece of work; until it
   * lands the field is the plain number, which is honest and settable, rather than absent.
   */
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import {
    createScanPolicyDraft,
    FILE_SAFETY_DEFINITIONS,
    FILE_SAFETY_SECTION_ID,
  } from "$lib/file-manager/scan-policy-draft.svelte.ts";
  import { MANAGE_SCAN_POLICY_PERMISSION } from "$lib/file-manager/scan-policy-api.ts";
  import UploadReadinessPlate from "$lib/file-manager/upload-readiness-plate.svelte";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";

  const draft = createScanPolicyDraft(fetch);

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_SCAN_POLICY_PERMISSION));

  $effect(() => {
    void draft.load();
    void sessionPermissions.load(fetch);
  });

  /** The plates, in the order their definitions declare — the page never re-groups them itself. */
  const plates = $derived.by(() => {
    const grouped: { label: string; definitions: (typeof FILE_SAFETY_DEFINITIONS)[number][] }[] = [];
    for (const definition of FILE_SAFETY_DEFINITIONS) {
      const label = definition.plateLabel ?? "General";
      const plate = grouped.find((candidate) => candidate.label === label);
      if (plate === undefined) grouped.push({ label, definitions: [definition] });
      else plate.definitions.push(definition);
    }
    return grouped;
  });
</script>

<svelte:head>
  <title>File Safety & Scanning · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId={FILE_SAFETY_SECTION_ID}
  title="File Safety & Scanning"
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
  showHistory={false}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsDescription>
      How the firm's uploads are scanned, and what it can do with a file the scan distrusts.
    </SettingsDescription>

    {#if draft.saveFailure !== null}
      <FailureNotice
        failure={draft.saveFailure}
        title="The Change Was Not Saved"
        fallback="The scan policy is unchanged. What you chose is still staged."
        whenSilent="Nothing answered, so the scan policy is unchanged. What you chose is still staged."
        onRetry={() => void draft.commit()}
      />
    {/if}

    {#each plates as plate (plate.label)}
      <SettingsPlate heading={plate.label}>
        <LoadingRegion
          loading={!draft.loaded}
          failed={draft.readFailure !== null && !draft.loaded}
          label="Reading the firm's scan policy"
          onRetry={() => void draft.load()}
        >
          {#snippet failure()}
            {#if draft.readFailure !== null}
              <FailureNotice
                failure={draft.readFailure}
                title="The Scan Policy Could Not Be Read"
                fallback="The firm's scan policy was not read."
                onRetry={() => void draft.load()}
              />
            {/if}
          {/snippet}
          <!-- The rows keep their own shape while the read is out: the setting's name stays
               readable and its value grey, so the plate does not change height when it lands. -->
          {#snippet fixture()}
            {#each plate.definitions as definition (definition.id)}
              <SettingsRow {definition} value={definition.defaultValue} />
            {/each}
          {/snippet}
          {#each plate.definitions as definition (definition.id)}
            {#if canEdit}
              <SettingsRow {definition} {draft} />
            {:else}
              <SettingsRow {definition} value={draft.value(definition)} />
            {/if}
          {/each}
        </LoadingRegion>
      </SettingsPlate>
    {/each}

    <!-- The readiness check is an act on the firm's storage, so it sits with the people who may
         change what happens to its files — the same key that gates the rows above. -->
    {#if canEdit}
      <SettingsPlate heading="Upload Readiness">
        <UploadReadinessPlate />
      </SettingsPlate>
    {/if}
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
