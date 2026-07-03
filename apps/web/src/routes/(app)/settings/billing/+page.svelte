<script lang="ts">
  /*
   * Settings · Billing — the draft-mode firm page demonstrated end to end, in the owner's
   * three-zone settings architecture: the NAVIGATION (the layout's section nav), the SETTINGS
   * THEMSELVES (the rows below), and the META INTERACTIONS — save posture, change history,
   * change requests — gathered at the top right in the masthead's Actions slot, sharing the
   * vertical band the large title already spends. Every row stages into ONE page draft, and the
   * meta corner owns the moment changes land.
   *
   * Whether this member edits or only reads comes from the permission seam
   * (settings-permissions.ts), never a hardcoded flag — flip the mock and the page flips
   * posture. The read-only arrangement below mirrors the Firm profile page deliberately: two
   * pages carrying a small duplication read clearer than a premature shared page-shell.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import SettingsMeta from "$lib/settings/components/settings-meta.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import {
    settingsForSection,
    visibleSettingsForSection,
  } from "$lib/settings/settings-definitions.ts";
  import { committedSettingValue, SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";

  const canEdit = canEditFirmSettings("billing");

  // One draft for the whole page: edits from every row stage into the same batch, so the meta
  // corner's staged count and the confirm dialog always describe the page, never one control.
  const draft = new SettingsDraft("billing");
</script>

<svelte:head>
  <title>Billing · Settings · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Billing</Masthead.Title>
    <Masthead.Meta>
      <span>Time is billed by these rules across the whole firm — changes apply when saved.</span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <!-- Posture follows the draft: with the edit right the meta corner carries the save
         cluster; without it, the history trigger and the change-request seam. -->
    <SettingsMeta sectionId="billing" draft={canEdit ? draft : undefined} />
  </Masthead.Actions>
</Masthead.Root>

{#if canEdit}
  <div class="flex flex-col gap-24" style="max-inline-size: var(--mc-size-prose)">
    {#each settingsForSection("billing") as definition (definition.id)}
      <SettingsRow {definition} {draft} />
    {/each}
  </div>
{:else}
  <div class="flex flex-col gap-32" style="max-inline-size: var(--mc-size-prose)">
    <!-- Stated once as the CONTENT's posture (not a meta action, so it stays with the rows) —
         repeating it per row would be nagging, and the engraved rows already read as facts,
         not controls. -->
    <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Managed by your firm administrators
    </p>

    <div class="flex flex-col gap-24">
      <!-- Without the edit right, a restricted setting is absent from this list entirely —
           never a locked box advertising a secret. -->
      {#each visibleSettingsForSection("billing", canEdit) as definition (definition.id)}
        <SettingsRow {definition} readOnly value={committedSettingValue(definition)} />
      {/each}
    </div>
  </div>
{/if}
