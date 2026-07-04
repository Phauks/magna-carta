<script lang="ts">
  /*
   * Settings · File Safety & Scanning — the firm's stance toward what uploads are allowed to
   * do, under Documents. A BESPOKE stub in the Beta Access pattern: the per-firm scan policy
   * engine and its routes ALREADY EXIST server-side (the score histogram read and the policy
   * update, both behind the firm's manage-scan-policy right), so this page is the FIRST
   * candidate for real wiring when the authenticated settings integration lands — its rows are
   * honest Soon seams until then, never invented live controls. When wired, the rows become
   * real draft settings and the page collapses toward the standard settings-page composition.
   */
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";

  const canEdit = canEditFirmSettings("documents");
  const draft = new SettingsDraft("file-safety");

  const SCANNING_STRICTNESS_DEFINITION: SettingDefinition = {
    id: "file-safety.scanning-strictness",
    sectionId: "file-safety",
    label: "Scanning Strictness",
    description: "How aggressively uploads are scored and blocked.",
    kind: "select",
    defaultValue: "",
    sensitivity: "open",
  };

  const QUARANTINE_BEHAVIOR_DEFINITION: SettingDefinition = {
    id: "file-safety.quarantine-behavior",
    sectionId: "file-safety",
    label: "Quarantine Behavior",
    description: "What happens to a file that fails scanning.",
    kind: "select",
    defaultValue: "",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>File Safety & Scanning · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="file-safety"
  title="File Safety & Scanning"
  meta="How the firm's uploads are scanned, scored, and held when they fail."
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsPlate heading="Scan Policy">
    <SettingsRow definition={SCANNING_STRICTNESS_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <Select.Root type="single" items={[]} disabled>
          <Select.Trigger
            class="w-full"
            aria-label="Scanning Strictness (arrives with the settings integration)"
          >
            <Select.Value placeholder="—" />
          </Select.Trigger>
        </Select.Root>
      {/snippet}
    </SettingsRow>

    <SettingsRow definition={QUARANTINE_BEHAVIOR_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <Select.Root type="single" items={[]} disabled>
          <Select.Trigger
            class="w-full"
            aria-label="Quarantine Behavior (arrives with the settings integration)"
          >
            <Select.Value placeholder="—" />
          </Select.Trigger>
        </Select.Root>
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
