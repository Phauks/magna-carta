<script lang="ts">
  /*
   * Settings · Developer — controls over the development-only tooling itself, in the
   * engraved-table anatomy (instant posture). The master switch pulls double duty: it is the
   * kill switch (turning it off turns every subordinate flag off, in the store) AND the reveal
   * (while off, the subordinate rows are not rendered at all — a disabled-switch graveyard
   * invites toggling; an absent one reads as "enable to see more"). Everything lives in the
   * developer-preferences store, so a flip takes effect everywhere immediately and survives
   * reload.
   *
   * The flags are PAGE-LOCAL SettingDefinition rows (their values live in the
   * developer-preferences store, not the settings store — one fact, one home), speaking the
   * definition contract so the rows and the history render through the shared components. Each
   * flip appends to the section's trail; a cascade the master's kill causes in the store is not
   * itemized — the master's own entry records the kill.
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
  import { developerPreferences } from "$lib/settings/developer-preferences.svelte.ts";

  const ENABLED_DEFINITION: SettingDefinition = {
    id: "developer.settings-enabled",
    sectionId: "developer",
    label: "Enable developer settings",
    description: "The master switch: turning it off turns every developer control off.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };

  const TOOLKIT_DEFINITION: SettingDefinition = {
    id: "developer.toolkit-in-header",
    sectionId: "developer",
    label: "Show developer toolkit in the header",
    description: "Places the developer console in the top bar on every page.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };

  interface DeveloperFlag {
    readonly definition: SettingDefinition;
    readonly current: () => boolean;
    readonly set: (value: boolean) => void;
  }

  const ENABLED_FLAG: DeveloperFlag = {
    definition: ENABLED_DEFINITION,
    current: () => developerPreferences.developerSettingsEnabled,
    set: (value) => (developerPreferences.developerSettingsEnabled = value),
  };
  const TOOLKIT_FLAG: DeveloperFlag = {
    definition: TOOLKIT_DEFINITION,
    current: () => developerPreferences.developerToolkitInHeader,
    set: (value) => (developerPreferences.developerToolkitInHeader = value),
  };

  const FLAGS: readonly DeveloperFlag[] = [ENABLED_FLAG, TOOLKIT_FLAG];

  /** Apply a flag flip and append it to the trail in the same breath. */
  function applyFlag(flag: DeveloperFlag, next: boolean): void {
    const current = flag.current();
    if (next === current) return;
    flag.set(next);
    appendSettingsLedgerEntries("developer", [
      {
        settingId: flag.definition.id,
        label: flag.definition.label,
        from: settingValueLabel(flag.definition, current),
        to: settingValueLabel(flag.definition, next),
      },
    ]);
  }

  function instantFor(flag: DeveloperFlag): {
    value: SettingValue;
    apply: (next: SettingValue) => void;
  } {
    return {
      value: flag.current(),
      apply: (next) => applyFlag(flag, next === true),
    };
  }

  // Restore re-applies immediately (instant page) and appends its own entry via applyFlag —
  // append-only, like every other change. Switch entries store On/Off display labels.
  function restoreAction(entry: SettingsLedgerEntry): (() => void) | null {
    const flag = FLAGS.find((candidate) => candidate.definition.id === entry.settingId);
    if (flag === undefined) return null;
    if (entry.from !== "On" && entry.from !== "Off") return null;
    const restoredValue = entry.from === "On";
    return () => applyFlag(flag, restoredValue);
  }
</script>

<svelte:head>
  <title>Developer · Settings · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Developer</Masthead.Title>
    <Masthead.Meta>
      <span>Controls that exist only in development builds.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<div class="flex flex-col gap-24" style="max-inline-size: var(--mc-size-prose)">
  <SettingsHeaderBand
    sectionId="developer"
    legend="Developer controls"
    posture="instant"
    {restoreAction}
  />

  <SettingsPlate heading="Development toolkit">
    <SettingsRow definition={ENABLED_DEFINITION} instant={instantFor(ENABLED_FLAG)} />
    {#if developerPreferences.developerSettingsEnabled}
      <SettingsRow definition={TOOLKIT_DEFINITION} instant={instantFor(TOOLKIT_FLAG)} />
    {:else}
      <p class="py-12 text-sm text-text-muted">
        Enabling developer settings reveals the individual developer controls, all off until you
        turn them on.
      </p>
    {/if}
  </SettingsPlate>
</div>
