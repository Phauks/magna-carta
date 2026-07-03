<script lang="ts">
  /*
   * Settings · Firm profile — the read-only posture of a firm page demonstrated end to end, in
   * the owner's three-zone settings architecture: the NAVIGATION (the layout's section nav), the
   * SETTINGS THEMSELVES (the engraved rows below — facts, no dead controls), and the META
   * INTERACTIONS — change history and the change-request seam — gathered at the top right in the
   * masthead's Actions slot, sharing the vertical band the large title already spends.
   *
   * Whether this member edits or only reads comes from the permission seam
   * (settings-permissions.ts), never a hardcoded flag — flip the mock and the page renders the
   * editable draft arrangement instead. The editable arrangement below mirrors the Billing page
   * deliberately: two pages carrying a small duplication read clearer than a premature shared
   * page-shell.
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

  const canEdit = canEditFirmSettings("firm");

  // One draft for the whole page (only rendered against when this member holds the edit
  // right): edits from every row stage into the same batch, so the meta corner's staged count
  // and the confirm dialog always describe the page, never one control.
  const draft = new SettingsDraft("firm-profile");
</script>

<svelte:head>
  <title>Firm profile · Settings · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Firm profile</Masthead.Title>
    <Masthead.Meta>
      <span>
        Identity facts about the firm that flow into invoices, the portal, and generated
        documents.
      </span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <!-- Posture follows the draft: with the edit right the meta corner carries the save
         cluster; without it, the history trigger and the change-request seam. -->
    <SettingsMeta sectionId="firm-profile" draft={canEdit ? draft : undefined} />
  </Masthead.Actions>
</Masthead.Root>

{#if canEdit}
  <div class="flex flex-col gap-24" style="max-inline-size: var(--mc-size-prose)">
    {#each settingsForSection("firm-profile") as definition (definition.id)}
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
      {#each visibleSettingsForSection("firm-profile", canEdit) as definition (definition.id)}
        <SettingsRow {definition} readOnly value={committedSettingValue(definition)} />
      {/each}
    </div>
  </div>
{/if}
