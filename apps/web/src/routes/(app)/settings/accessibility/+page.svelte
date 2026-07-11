<script lang="ts">
  /*
   * Settings · Accessibility — how the interface reads and moves for THIS member, its own page
   * (owner-directed). Density lives here rather than under Theme: how tightly the interface
   * packs is reading ergonomics, not brand. High Contrast is the switch (seed-then-own — see
   * the shared axes module); Motion and Density are dropdowns.
   *
   * Instant posture: every choice applies through the shared appearance-axes machinery
   * ($lib/settings/appearance-axes.svelte.ts — the seam the no-FOUC boot script reads) and
   * appends to this page's own change ledger.
   */
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import {
    appearanceRestoreAction,
    applyHighContrast,
    DENSITY_AXIS,
    DENSITY_DEFINITION,
    HIGH_CONTRAST_DEFINITION,
    highContrastActive,
    instantForAxis,
    MOTION_AXIS,
    MOTION_DEFINITION,
  } from "$lib/settings/appearance-axes.svelte.ts";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import {
    expandSidebarOnHover,
    setExpandSidebarOnHover,
  } from "$lib/navigation/sidebar-preferences.svelte.ts";

  const restoreAction = appearanceRestoreAction([DENSITY_AXIS, MOTION_AXIS]);

  /*
   * Navigation ergonomics belong on the Accessibility page: expand-on-hover reduces pointer
   * travel and reclaims screen space by keeping the rail collapsed at rest — reading/interaction
   * ergonomics, the same family as motion and density. It is a per-browser preference kept in the
   * sidebar-preferences store (not the theme-preference seam the axes use), so it applies
   * instantly through the store's setter rather than the appearance ledger.
   */
  const EXPAND_ON_HOVER_DEFINITION: SettingDefinition = {
    id: "accessibility.expand-sidebar-on-hover",
    sectionId: "accessibility",
    label: "Expand sidebar on hover",
    description:
      "Keep the sidebar collapsed, and hovering it opens the rail — the page shifts over to make room, and closes again when you move away.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Accessibility · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="accessibility"
  title="Accessibility"
  meta="How the interface reads and moves — contrast, motion, and density, yours alone."
  posture="instant"
  {restoreAction}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsPlate heading="Comfort">
    <SettingsRow
      definition={HIGH_CONTRAST_DEFINITION}
      instant={{ value: highContrastActive(), apply: (next) => applyHighContrast(next === true) }}
    />
    <SettingsRow definition={MOTION_DEFINITION} instant={instantForAxis(MOTION_AXIS)} />
    <SettingsRow definition={DENSITY_DEFINITION} instant={instantForAxis(DENSITY_AXIS)} />
  </SettingsPlate>
  <SettingsPlate heading="Navigation">
    <SettingsRow
      definition={EXPAND_ON_HOVER_DEFINITION}
      instant={{
        value: expandSidebarOnHover(),
        apply: (next) => setExpandSidebarOnHover(next === true),
      }}
    />
  </SettingsPlate>
  </div>
</div>
