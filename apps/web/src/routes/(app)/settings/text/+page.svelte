<script lang="ts">
  /*
   * Settings · Text — how interface text reads, under Appearance in the user band. A BESPOKE
   * page composing the standard parts (settings-masthead, settings-scroll-region,
   * settings-plate, settings-row): both rows are honest Soon seams — per the only-real-rows rule
   * nothing here pretends to work before the machinery exists:
   *
   * - Font Family becomes a real appearance axis when the type system grows font tokens (a
   *   swappable reading face across the interface).
   * - Text Size becomes a real appearance axis when the type system grows a text-scale overlay
   *   (the base size the interface renders at).
   *
   * Each row carries the real control — the product's one closed-choice field, disabled — with
   * the Soon badge and the line saying what it waits on: the deliberate honest-seam device (the
   * badge states why the control is inert), distinct from the dead-control rule the engraved rows
   * follow: these controls announce a coming choice, not a current value. When either axis ships,
   * its row swaps to a live instant-apply choice (the Appearance page's axis pattern) and this
   * page collapses toward the standard composition. The history trigger is already wired to this
   * section's ledger, ready for the first live setting.
   */
  import Badge from "@magna-carta/design-system/badge";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // Page-local seam definitions: rendering through SettingsRow keeps the shared table grid.
  const FONT_FAMILY_DEFINITION: SettingDefinition = {
    id: "text.font-family",
    sectionId: "text",
    label: "Font Family",
    description: "The reading typeface across the interface. Arrives with the type system's font tokens.",
    kind: "select",
    defaultValue: "",
    sensitivity: "open",
  };

  const TEXT_SIZE_DEFINITION: SettingDefinition = {
    id: "text.text-size",
    sectionId: "text",
    label: "Text Size",
    description:
      "The base size interface text renders at. Arrives with the type system's text-scale overlay.",
    kind: "select",
    defaultValue: "",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Text · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead sectionId="text" title="Text" posture="instant" />

<SettingsScrollRegion>
  <SettingsDescription>
    How interface text reads: typeface and size, yours across every screen.
  </SettingsDescription>

  <SettingsPlate heading="Type">
    <SettingsRow definition={FONT_FAMILY_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <ChoicePicker
          options={[]}
          inputId="settings-{FONT_FAMILY_DEFINITION.id}"
          label={FONT_FAMILY_DEFINITION.label}
          disabled
          title="Arrives with the type system's font tokens."
        />
      {/snippet}
    </SettingsRow>

    <SettingsRow definition={TEXT_SIZE_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <ChoicePicker
          options={[]}
          inputId="settings-{TEXT_SIZE_DEFINITION.id}"
          label={TEXT_SIZE_DEFINITION.label}
          disabled
          title="Arrives with the type system's text-scale overlay."
        />
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
</SettingsScrollRegion>
