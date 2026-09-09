<script lang="ts">
  /*
   * Settings · Billing — how the firm measures the time it bills, under Billing.
   *
   * LIVE, over GET/PATCH /api/v1/firm/time-policy. The rounding engine was always there: the
   * timer, the quick-add preview and every capture already resolve these two keys through the
   * scoped-setting chain, and the time-entries surface serves the resolved answer to the screens
   * that record time. What was missing was the firm's own door to the firm tier, and that is what
   * this page is now — not a local-storage preview that governed nothing.
   *
   * THE FIRM TIER, AND THE PAGE SAYS SO. Both settings are scope-overridable: a matter, a client,
   * a timekeeper or a location may carry its own value, and the resolver walks most-specific-first.
   * So this page states that what it sets is the firm's rule rather than an absolute — otherwise an
   * administrator moving the firm to quarter hours would reasonably expect every matter to follow,
   * and a matter deliberately pinned to tenths would look like a bug.
   *
   * WHAT ALREADY HAPPENED IS NOT RE-MEASURED. Time already captured keeps the rounding it was
   * recorded under; the change reaches what is captured after it. Said before the save, because
   * somebody changing the increment is deciding about the invoices they are about to send.
   *
   * A CUSTOM INCREMENT IS SHOWN, NEVER SILENTLY OFFERED AWAY. The server takes any whole number of
   * minutes up to an hour; the select carries the seven firms actually bill at. A firm holding
   * something else gets its value stated rather than a control that cannot express it — a select
   * that resolved to its placeholder over a real value would be a screen lying about the firm.
   *
   * HISTORY IS WITHHELD, for the reason the calendar and file-safety pages withhold it: the record
   * of a change is the audit row the server writes, and a per-browser ledger would be one browser's
   * recollection of a firm-wide fact, silent about every change a colleague made.
   */
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { MANAGE_TIME_SETTINGS_PERMISSION } from "$lib/settings/firm-time-policy-api.ts";
  import {
    BILLING_DEFINITIONS,
    BILLING_SECTION_ID,
    createFirmTimePolicyDraft,
    INCREMENT_DEFINITION,
    isOfferedIncrement,
  } from "$lib/settings/firm-time-policy-draft.svelte.ts";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";

  const draft = createFirmTimePolicyDraft(fetch);

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_TIME_SETTINGS_PERMISSION));

  $effect(() => {
    void draft.load();
    void sessionPermissions.load(fetch);
  });

  // An increment outside the select's list is real and has to be stated, not offered away.
  const customIncrement = $derived.by(() => {
    const committed = draft.committed;
    if (committed === null) return null;
    return isOfferedIncrement(committed.incrementMinutes) ? null : committed.incrementMinutes;
  });

  function editableRow(definitionId: string): boolean {
    if (!canEdit) return false;
    return !(definitionId === INCREMENT_DEFINITION.id && customIncrement !== null);
  }
</script>

<svelte:head>
  <title>Billing · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId={BILLING_SECTION_ID}
  title="Billing"
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
      How the firm measures the time it bills. A matter, a client or a timekeeper can carry its own
      increment, which takes precedence over the firm's.
    </SettingsDescription>

    {#if draft.saveFailure !== null}
      <FailureNotice
        failure={draft.saveFailure}
        title="The Change Was Not Saved"
        fallback="The firm's time policy is unchanged. What you chose is still staged."
        whenSilent="Nothing answered, so the firm's time policy is unchanged. What you chose is still staged."
        onRetry={() => void draft.commit()}
      />
    {/if}

    <SettingsPlate heading="Time Capture">
      <LoadingRegion
        loading={!draft.loaded}
        failed={draft.readFailure !== null && !draft.loaded}
        label="Reading the firm's time policy"
        onRetry={() => void draft.load()}
      >
        {#snippet failure()}
          {#if draft.readFailure !== null}
            <FailureNotice
              failure={draft.readFailure}
              title="The Time Policy Could Not Be Read"
              fallback="The firm's time policy was not read."
              onRetry={() => void draft.load()}
            />
          {/if}
        {/snippet}
        <!-- The rows keep their own shape while the read is out: the setting's name stays
             readable and its value grey, so the plate does not change height when it lands. -->
        {#snippet fixture()}
          {#each BILLING_DEFINITIONS as definition (definition.id)}
            <SettingsRow {definition} value={definition.defaultValue} />
          {/each}
        {/snippet}
        {#each BILLING_DEFINITIONS as definition (definition.id)}
          {#if editableRow(definition.id)}
            <SettingsRow {definition} {draft} />
          {:else}
            <SettingsRow {definition} value={draft.value(definition)} />
          {/if}
        {/each}
        {#if customIncrement !== null}
          <p class="py-8 text-sm text-text-muted">
            This firm bills in {customIncrement}-minute units, which is not one of the increments
            this page offers. It is shown rather than changed, so choosing from a shorter list
            cannot quietly move the firm off it.
          </p>
        {/if}
        {#if canEdit}
          <p class="py-8 text-sm text-text-muted">
            Time already captured keeps the rounding it was recorded under. A change applies to what
            is captured after it.
          </p>
        {/if}
      </LoadingRegion>
    </SettingsPlate>
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
