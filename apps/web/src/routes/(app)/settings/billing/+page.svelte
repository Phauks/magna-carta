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
   * minutes up to an hour; the picker carries the seven firms actually bill at. A firm holding
   * something else gets its value stated rather than a control that cannot express it — a field
   * that resolved to nothing over a real value would be a screen lying about the firm.
   *
   * The standard page (settings-page.svelte) over the shared server-backed draft; this file is the
   * words and the one row rule above.
   */
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { MANAGE_TIME_SETTINGS_PERMISSION } from "$lib/settings/firm-time-policy-api.ts";
  import {
    BILLING_DEFINITIONS,
    BILLING_SECTION_ID,
    createFirmTimePolicyDraft,
    INCREMENT_DEFINITION,
    isOfferedIncrement,
  } from "$lib/settings/firm-time-policy-draft.svelte.ts";
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  const draft = createFirmTimePolicyDraft(fetch);

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_TIME_SETTINGS_PERMISSION));

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  // An increment outside the picker's list is real and has to be stated, not offered away.
  const customIncrement = $derived.by(() => {
    const committed = draft.committed;
    if (committed === null) return null;
    return isOfferedIncrement(committed.incrementMinutes) ? null : committed.incrementMinutes;
  });

  function editable(definition: SettingDefinition): boolean {
    if (!canEdit) return false;
    return !(definition.id === INCREMENT_DEFINITION.id && customIncrement !== null);
  }
</script>

<svelte:head>
  <title>Billing · Settings · Magna Carta</title>
</svelte:head>

{#snippet plateEnd(plateLabel: string)}
  {#if plateLabel === INCREMENT_DEFINITION.plateLabel}
    {#if customIncrement !== null}
      <SettingsPlateNote>
        This firm bills in {customIncrement}-minute units, which is not one of the increments this
        page offers. It is shown rather than changed, so choosing from a shorter list cannot
        quietly move the firm off it.
      </SettingsPlateNote>
    {/if}
    {#if canEdit}
      <SettingsPlateNote>
        Time already captured keeps the rounding it was recorded under. A change applies to what is
        captured after it.
      </SettingsPlateNote>
    {/if}
  {/if}
{/snippet}

<SettingsPage
  sectionId={BILLING_SECTION_ID}
  title="Billing"
  meta="How the firm measures the time it bills. A matter, a client or a timekeeper can carry its own increment, which takes precedence over the firm's."
  {draft}
  definitions={BILLING_DEFINITIONS}
  {canEdit}
  {editable}
  readLabel="Reading the firm's time policy"
  readFailureTitle="The Time Policy Could Not Be Read"
  readFailureFallback="The firm's time policy was not read."
  saveFailureFallback="The firm's time policy is unchanged. What you chose is still staged."
  saveFailureWhenSilent="Couldn't connect. The time policy is unchanged, and your choices are still here."
  {plateEnd}
/>
