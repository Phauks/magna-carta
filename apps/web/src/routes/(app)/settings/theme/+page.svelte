<script lang="ts">
  /*
   * Settings · Theme — the firm's brand face, its own page because themes will grow variety (a
   * gallery, the firm default and lock, custom brand generation later; owner-directed). Mode
   * lives here rather than under Accessibility: light/dark is the theme's own axis — every
   * theme ships a light and a dark cut, so the pair is one brand decision.
   *
   * Instant posture: every pick applies through the shared appearance-axes machinery
   * ($lib/settings/appearance-axes.svelte.ts — the seam the no-FOUC boot script reads) and
   * appends to this page's own change ledger.
   */
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import {
    appearanceRestoreAction,
    instantForAxis,
    MODE_AXIS,
    MODE_DEFINITION,
    THEME_AXIS,
    THEME_DEFINITION,
  } from "$lib/settings/appearance-axes.svelte.ts";

  const restoreAction = appearanceRestoreAction([THEME_AXIS, MODE_AXIS]);
</script>

<svelte:head>
  <title>Theme · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="theme"
  title="Theme"
  posture="instant"
  {restoreAction}
/>

<SettingsScrollRegion>
  <SettingsDescription>The firm's theme: six themes, each in light and dark.</SettingsDescription>

  <SettingsPlate heading="Brand">
    <SettingsRow definition={THEME_DEFINITION} instant={instantForAxis(THEME_AXIS)} />
    <SettingsRow definition={MODE_DEFINITION} instant={instantForAxis(MODE_AXIS)} />
  </SettingsPlate>
</SettingsScrollRegion>
