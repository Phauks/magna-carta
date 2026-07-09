<script lang="ts">
  /*
   * Settings · Text — how interface text reads, under Appearance in the user band. A BESPOKE
   * page composing the standard parts (settings-masthead, settings-plate, settings-row): both
   * rows are honest Soon seams — per the only-real-rows rule nothing here pretends to work
   * before the machinery exists:
   *
   * - Font Family becomes a real appearance axis when the type system grows font tokens (a
   *   swappable reading face across the interface).
   * - Text Size becomes a real appearance axis when the type system grows a text-scale overlay
   *   (the base size the interface renders at).
   *
   * Each row carries a disabled control with the Soon badge — the deliberate honest-seam device
   * (the badge states why the control is inert), distinct from the dead-control rule the
   * engraved rows follow: these controls announce a coming choice, not a current value. When
   * either axis ships, its row swaps to a live instant-apply dropdown (the Appearance page's
   * axis pattern) and this page collapses toward the standard composition. The history trigger
   * is already wired to this section's ledger, ready for the first live setting.
   */
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // Page-local seam definitions: rendering through SettingsRow keeps the shared table grid.
  const FONT_FAMILY_DEFINITION: SettingDefinition = {
    id: "text.font-family",
    sectionId: "text",
    label: "Font Family",
    description: "The reading typeface across the interface.",
    kind: "select",
    defaultValue: "",
    sensitivity: "open",
  };

  const TEXT_SIZE_DEFINITION: SettingDefinition = {
    id: "text.text-size",
    sectionId: "text",
    label: "Text Size",
    description: "The base size interface text renders at.",
    kind: "select",
    defaultValue: "",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Text · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="text"
  title="Text"
  meta="How interface text reads — typeface and size, yours across every screen."
  posture="instant"
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsPlate heading="Type">
    <SettingsRow definition={FONT_FAMILY_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <Select.Root type="single" items={[]} disabled>
          <Select.Trigger class="w-full" aria-label="Font Family (arrives with font tokens)">
            <Select.Value placeholder="—" />
          </Select.Trigger>
        </Select.Root>
      {/snippet}
    </SettingsRow>

    <SettingsRow definition={TEXT_SIZE_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <Select.Root type="single" items={[]} disabled>
          <Select.Trigger class="w-full" aria-label="Text Size (arrives with the text-scale overlay)">
            <Select.Value placeholder="—" />
          </Select.Trigger>
        </Select.Root>
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
  </div>
</div>
