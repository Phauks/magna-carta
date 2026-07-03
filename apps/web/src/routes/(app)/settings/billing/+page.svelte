<script lang="ts">
  /*
   * Settings · Billing — the draft-posture firm page in the engraved-table anatomy: one header
   * band (page legend + the commit rail) seated on the table's opening rule, then the settings
   * as plates of ruled rows. Every row stages into ONE page draft; the band's rail owns the
   * moment changes land.
   *
   * Whether this member edits or only reads comes from the permission seam
   * (settings-permissions.ts), never a hardcoded flag — flip the mock and the page flips
   * posture. Read-only rows carry the per-row request affordance, opening the change-request
   * composer pre-scoped to that setting. The arrangement mirrors the Firm profile page
   * deliberately: two pages carrying a small duplication read clearer than a premature shared
   * page-shell.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import RequestChangeDialog from "$lib/settings/components/request-change-dialog.svelte";
  import SettingsHeaderBand from "$lib/settings/components/settings-header-band.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import { platesForSection, type SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { committedSettingValue, SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";

  const canEdit = canEditFirmSettings("billing");

  // One draft for the whole page: edits from every row stage into the same batch, so the band's
  // count chip and the confirm dialog always describe the page, never one control.
  const draft = new SettingsDraft("billing");

  let requestOpen = $state(false);
  let requestDefinition = $state<SettingDefinition | null>(null);

  function openRequest(definition: SettingDefinition): void {
    requestDefinition = definition;
    requestOpen = true;
  }
</script>

<svelte:head>
  <title>Billing · Settings · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Billing</Masthead.Title>
    <Masthead.Meta>
      <span>Time is billed by these rules across the whole firm.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<div class="flex flex-col gap-24" style="max-inline-size: var(--mc-size-prose)">
  <SettingsHeaderBand
    sectionId="billing"
    legend="Billing rules"
    posture={canEdit ? "draft" : "readOnly"}
    draft={canEdit ? draft : undefined}
  />

  {#each platesForSection("billing", canEdit) as plate (plate.label)}
    <SettingsPlate heading={plate.label}>
      <!-- Without the edit right, a restricted setting is absent from the plates entirely —
           never a locked box advertising a secret (platesForSection filters by sensitivity). -->
      {#each plate.definitions as definition (definition.id)}
        {#if canEdit}
          <SettingsRow {definition} {draft} />
        {:else}
          <SettingsRow
            {definition}
            value={committedSettingValue(definition)}
            onRequestChange={openRequest}
          />
        {/if}
      {/each}
    </SettingsPlate>
  {/each}
</div>

{#if requestDefinition !== null}
  <RequestChangeDialog bind:open={requestOpen} definition={requestDefinition} />
{/if}
