<script lang="ts">
  /*
   * Settings · Text — how interface text reads, under Appearance in the user band. A BESPOKE
   * page composing the standard parts (settings-masthead, settings-scroll-region,
   * settings-plate, settings-row):
   *
   * - Font Family is LIVE: the typeface axis, an instant-apply choice through the shared
   *   appearance-axes machinery ($lib/settings/appearance-axes.svelte.ts). It sets data-typeface on
   *   <html>, the token overlays re-point --mc-font-sans, and every surface that reads the reading
   *   face follows — no reload. The no-FOUC boot script applies the persisted face before first
   *   paint. Each change appends to this page's own ledger, and Restore re-applies.
   * - Text Size is still an honest Soon seam — it becomes a real axis when the type system grows a
   *   text-scale overlay (the base size the interface renders at). It carries the real control,
   *   disabled, with the Soon badge and the line saying what it waits on: these controls announce
   *   a coming choice, not a current value. Until then a browser's own text-size setting already
   *   scales the whole interface, because every type size is in rem.
   */
  import Badge from "@magna-carta/design-system/badge";
  import {
    appearanceRestoreAction,
    instantForAxis,
    TYPEFACE_AXIS,
    TYPEFACE_DEFINITION,
  } from "$lib/settings/appearance-axes.svelte.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  const restoreAction = appearanceRestoreAction([TYPEFACE_AXIS]);

  // Page-local seam definition: rendering through SettingsRow keeps the shared table grid.
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

<SettingsMasthead sectionId="text" title="Text" posture="instant" {restoreAction} />

<SettingsScrollRegion>
  <SettingsDescription>
    How interface text reads: typeface and size, yours across every screen.
  </SettingsDescription>

  <SettingsPlate heading="Type">
    <SettingsRow definition={TYPEFACE_DEFINITION} instant={instantForAxis(TYPEFACE_AXIS)} />

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
