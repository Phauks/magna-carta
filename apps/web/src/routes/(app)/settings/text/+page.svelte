<script lang="ts">
  /*
   * Settings · Text — how interface text reads, under Appearance in the user band. A BESPOKE
   * page composing the standard parts (settings-masthead, settings-scroll-region,
   * settings-plate, settings-row). Both rows are instant-apply axes through the shared
   * appearance-axes machinery ($lib/settings/appearance-axes.svelte.ts); each change appends to
   * this page's own ledger, and Restore re-applies. The no-FOUC boot script applies both before
   * first paint.
   *
   * - Font Family sets data-typeface on <html>; the token overlays re-point --mc-font-sans, and
   *   every surface that reads the reading face follows with no reload. Each option in the open
   *   list is SET IN ITS OWN FACE: its row carries data-typeface-sample, which re-points
   *   --mc-font-sans for that row alone (the sample blocks in
   *   @magna-carta/design-tokens), so the list shows the faces rather than describing them.
   * - Text Size is a percentage from 50% to 200%, written as the root font size on <html>, so
   *   every rem type size follows.
   */
  import {
    appearanceRestoreAction,
    instantForAxis,
    TEXT_SIZE_AXIS,
    TEXT_SIZE_DEFINITION,
    TYPEFACE_AXIS,
    TYPEFACE_DEFINITION,
  } from "$lib/settings/appearance-axes.svelte.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const restoreAction = appearanceRestoreAction([TYPEFACE_AXIS, TEXT_SIZE_AXIS]);
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
    <SettingsRow definition={TYPEFACE_DEFINITION} instant={instantForAxis(TYPEFACE_AXIS)}>
      {#snippet choiceRow(option)}
        <span class="font-sans" data-typeface-sample={option.value}>{option.label}</span>
      {/snippet}
    </SettingsRow>

    <SettingsRow definition={TEXT_SIZE_DEFINITION} instant={instantForAxis(TEXT_SIZE_AXIS)} />
  </SettingsPlate>
</SettingsScrollRegion>
