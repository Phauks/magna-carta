<script lang="ts">
  /*
   * Settings · Matter Numbering — the scheme new matter numbers follow, under Practice. A
   * BESPOKE stub in the Beta Access pattern: the real routes exist (numbering-scheme read and
   * update plus preview, audited), and the REAL page is a segment-template editor with a live
   * preview — this stub reserves its home with honest Soon seams until that editor is built.
   * It supersedes the interim two-preset row Firm Profile used to carry.
   */
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";

  const canEdit = canEditFirmSettings("firm");
  const draft = new SettingsDraft("matter-numbering");

  const NUMBERING_SCHEME_DEFINITION: SettingDefinition = {
    id: "matter-numbering.scheme",
    sectionId: "matter-numbering",
    label: "Numbering Scheme",
    description: "The segment template new matter numbers follow.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  // The preview is a reported fact (a sample number computed from the scheme), so its seam is
  // the same honest em-dash the diagnostics rows use.
  const SCHEME_PREVIEW_DEFINITION: SettingDefinition = {
    id: "matter-numbering.preview",
    sectionId: "matter-numbering",
    label: "Scheme Preview",
    description: "What the next matter number would look like under the scheme.",
    kind: "text",
    defaultValue: "—",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Matter Numbering · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="matter-numbering"
  title="Matter Numbering"
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsDescription>The scheme new matter numbers follow across the whole firm.</SettingsDescription>

  <SettingsPlate heading="Scheme">
    <SettingsRow definition={NUMBERING_SCHEME_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <Select.Root type="single" items={[]} disabled>
          <Select.Trigger
            class="w-full"
            aria-label="Numbering Scheme (arrives with the segment-template editor)"
          >
            <Select.Value placeholder="—" />
          </Select.Trigger>
        </Select.Root>
      {/snippet}
    </SettingsRow>

    <SettingsRow definition={SCHEME_PREVIEW_DEFINITION} value="—" />
  </SettingsPlate>
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
