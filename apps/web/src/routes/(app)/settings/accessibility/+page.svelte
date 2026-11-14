<script lang="ts">
  /*
   * Settings · Accessibility — how the interface reads and moves for THIS member, its own page
   * (owner-directed). Density lives here rather than under Theme: how tightly the interface
   * packs is reading ergonomics, not brand. High Contrast is the switch (seed-then-own — see
   * the shared axes module); Motion and Density are dropdowns.
   *
   * Instant posture: every choice applies through the shared appearance-axes machinery
   * ($lib/settings/appearance-axes.svelte.ts — the seam the no-FOUC boot script reads) and
   * appends to this page's own change ledger. Scroll Edge Markers is the one axis that seam
   * carries and the boot script does not: nothing paints a scroll-edge rule before the
   * application mounts, so there is no flash for an inline script to end.
   */
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
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
    applyScrollEdgeHints,
    SCROLL_EDGE_HINTS_DEFINITION,
    scrollEdgeHintsShown,
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
      "Keep the sidebar collapsed. Hovering opens it, moving the page over, and it closes when you move away.",
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
  posture="instant"
  {restoreAction}
/>

<SettingsScrollRegion>
  <SettingsDescription>How the interface reads and moves: contrast, motion, density and the marks it draws at a scroll edge, yours alone.</SettingsDescription>

  <SettingsPlate heading="Comfort">
    <SettingsRow
      definition={HIGH_CONTRAST_DEFINITION}
      instant={{ value: highContrastActive(), apply: (next) => applyHighContrast(next === true) }}
    />
    <SettingsRow definition={MOTION_DEFINITION} instant={instantForAxis(MOTION_AXIS)} />
    <SettingsRow definition={DENSITY_DEFINITION} instant={instantForAxis(DENSITY_AXIS)} />
    <SettingsRow
      definition={SCROLL_EDGE_HINTS_DEFINITION}
      instant={{
        value: scrollEdgeHintsShown(),
        apply: (next) => applyScrollEdgeHints(next === true),
      }}
    />
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
</SettingsScrollRegion>
