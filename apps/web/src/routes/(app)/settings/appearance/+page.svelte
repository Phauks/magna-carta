<script lang="ts">
  /*
   * Settings · Appearance — the instant-posture page in the engraved-table anatomy: the header
   * band states "Applies immediately", and every control applies on interaction through the SAME
   * seam the boot script reads (theme-preference.ts), so a choice lands instantly and survives
   * reload. Intent, never implementation: users pick "reduced", never a millisecond value.
   *
   * The axes are PAGE-LOCAL SettingDefinition rows, not registry entries: their values live in
   * the theme-preference storage the boot script reads, not the settings store, so registering
   * them would put one fact in two homes. They move into the registry when the firm-wide theme
   * default (and lock) arrives and the backend owns the value. The local definitions still speak
   * the definition contract, so the rows and the history render through the same components as
   * every other page.
   *
   * Every instant apply appends to the section's change ledger in the same breath — instant
   * pages get the same trail as draft pages. Restore from the trail re-APPLIES immediately (and
   * appends its own entry): on an instant page a restore is just another instant change,
   * append-only like every other.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import SettingsHeaderBand from "$lib/settings/components/settings-header-band.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import {
    settingValueLabel,
    type SettingDefinition,
    type SettingValue,
  } from "$lib/settings/settings-definitions.ts";
  import {
    appendSettingsLedgerEntries,
    type SettingsLedgerEntry,
  } from "$lib/settings/settings-ledger-store.svelte.ts";
  import {
    applyThemePreference,
    readThemePreference,
    type DensityPreference,
    type Mode,
    type MotionPreference,
  } from "@magna-carta/design-system/internal/theme-preference";

  const THEME_DEFINITION: SettingDefinition = {
    id: "appearance.theme",
    sectionId: "appearance",
    label: "Theme",
    description: "Six curated themes, each in light and dark; the firm's brand choice.",
    kind: "select",
    options: [
      { value: "chancery", label: "Chancery — ink & gold (flagship)" },
      { value: "verdigris", label: "Verdigris — aged copper" },
      { value: "parchment", label: "Parchment — warm cream" },
      { value: "oxblood", label: "Oxblood — burgundy" },
      { value: "aubergine", label: "Aubergine — deep plum" },
      { value: "slate", label: "Slate — near neutral" },
    ],
    defaultValue: "chancery",
    sensitivity: "open",
  };

  const MODE_DEFINITION: SettingDefinition = {
    id: "appearance.mode",
    sectionId: "appearance",
    label: "Mode",
    kind: "radio",
    options: [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
      { value: "system", label: "Match my system" },
    ],
    defaultValue: "system",
    sensitivity: "open",
  };

  const DENSITY_DEFINITION: SettingDefinition = {
    id: "appearance.density",
    sectionId: "appearance",
    label: "Density",
    kind: "radio",
    options: [
      { value: "comfortable", label: "Comfortable" },
      { value: "compact", label: "Compact — tighter rows and controls" },
    ],
    defaultValue: "comfortable",
    sensitivity: "open",
  };

  const MOTION_DEFINITION: SettingDefinition = {
    id: "appearance.motion",
    sectionId: "appearance",
    label: "Motion",
    kind: "radio",
    options: [
      { value: "full", label: "Full" },
      { value: "reduced", label: "Reduced — shorter, quieter" },
      { value: "off", label: "Off — instant" },
      { value: "system", label: "Match my system" },
    ],
    defaultValue: "system",
    sensitivity: "open",
  };

  const initial = readThemePreference();
  let theme = $state(initial.theme);
  let mode = $state<Mode>(initial.mode);
  let motion = $state<MotionPreference>(initial.motion);
  let density = $state<DensityPreference>(initial.density);

  /** Apply an axis change and append it to the trail in the same breath. */
  function applyAxis(
    definition: SettingDefinition,
    current: string,
    next: string,
    set: (value: string) => void,
  ): void {
    if (next === current) return;
    set(next);
    applyThemePreference(theme, mode, motion, density);
    appendSettingsLedgerEntries("appearance", [
      {
        settingId: definition.id,
        label: definition.label,
        from: settingValueLabel(definition, current),
        to: settingValueLabel(definition, next),
      },
    ]);
  }

  // One row per axis: the definition, the live value, and the typed setter — the rows and the
  // restore resolver both work off these.
  interface AppearanceAxis {
    readonly definition: SettingDefinition;
    readonly current: () => string;
    readonly set: (value: string) => void;
  }

  const THEME_AXIS: AppearanceAxis = {
    definition: THEME_DEFINITION,
    current: () => theme,
    set: (value) => (theme = value),
  };
  const MODE_AXIS: AppearanceAxis = {
    definition: MODE_DEFINITION,
    current: () => mode,
    set: (value) => (mode = value as Mode),
  };
  const DENSITY_AXIS: AppearanceAxis = {
    definition: DENSITY_DEFINITION,
    current: () => density,
    set: (value) => (density = value as DensityPreference),
  };
  const MOTION_AXIS: AppearanceAxis = {
    definition: MOTION_DEFINITION,
    current: () => motion,
    set: (value) => (motion = value as MotionPreference),
  };

  const AXES: readonly AppearanceAxis[] = [THEME_AXIS, MODE_AXIS, DENSITY_AXIS, MOTION_AXIS];

  function instantFor(axis: AppearanceAxis): {
    value: SettingValue;
    apply: (next: SettingValue) => void;
  } {
    return {
      value: axis.current(),
      apply: (next) => applyAxis(axis.definition, axis.current(), String(next), axis.set),
    };
  }

  // Restore on an instant page re-applies immediately; applyAxis appends the new entry, so the
  // trail stays append-only. Labels map back to raw values through the axis's own options.
  function restoreAction(entry: SettingsLedgerEntry): (() => void) | null {
    const axis = AXES.find((candidate) => candidate.definition.id === entry.settingId);
    if (axis === undefined) return null;
    const restoredValue = axis.definition.options?.find(
      (option) => option.label === entry.from,
    )?.value;
    if (restoredValue === undefined) return null;
    return () => applyAxis(axis.definition, axis.current(), restoredValue, axis.set);
  }
</script>

<svelte:head>
  <title>Appearance · Settings · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Appearance</Masthead.Title>
    <Masthead.Meta>
      <span>The theme is the firm's brand; how the interface reads is yours.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<div class="flex flex-col gap-24" style="max-inline-size: var(--mc-size-prose)">
  <SettingsHeaderBand
    sectionId="appearance"
    legend="Personalization"
    posture="instant"
    {restoreAction}
  />

  <SettingsPlate heading="Brand">
    <SettingsRow definition={THEME_DEFINITION} instant={instantFor(THEME_AXIS)} />
  </SettingsPlate>

  <SettingsPlate heading="Accessibility">
    <SettingsRow definition={MODE_DEFINITION} instant={instantFor(MODE_AXIS)} />
    <SettingsRow definition={DENSITY_DEFINITION} instant={instantFor(DENSITY_AXIS)} />
    <SettingsRow definition={MOTION_DEFINITION} instant={instantFor(MOTION_AXIS)} />
  </SettingsPlate>
</div>
