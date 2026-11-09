<script lang="ts">
  /*
   * The appearance module — live switchers for the four personalization axes (theme, mode,
   * density, motion) so a design session can flip them without leaving the current screen. It
   * rides the SAME persistence seam the settings page drives (theme-preference.ts): every change
   * applies instantly and survives reload — this is the real preference, not a preview layer.
   */
  import * as Select from "@magna-carta/design-system/select";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import {
    applyThemePreference,
    readThemePreference,
    type DensityPreference,
    type Mode,
    type MotionPreference,
  } from "@magna-carta/design-system/internal/theme-preference";

  const THEMES = [
    { value: "chancery", label: "Chancery — ink & gold" },
    { value: "verdigris", label: "Verdigris — aged copper" },
    { value: "parchment", label: "Parchment — warm cream" },
    { value: "oxblood", label: "Oxblood — burgundy" },
    { value: "aubergine", label: "Aubergine — deep plum" },
    { value: "slate", label: "Slate — near neutral" },
  ];
  const MODES = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "Match my system" },
  ];
  const DENSITIES = [
    { value: "comfortable", label: "Comfortable" },
    { value: "compact", label: "Compact" },
  ];
  const MOTIONS = [
    { value: "full", label: "Full" },
    { value: "reduced", label: "Reduced" },
    { value: "off", label: "Off" },
    { value: "system", label: "Match my system" },
  ];

  const initial = readThemePreference();
  let theme = $state(initial.theme);
  let mode = $state<Mode>(initial.mode);
  let motion = $state<MotionPreference>(initial.motion);
  let density = $state<DensityPreference>(initial.density);

  function apply(): void {
    // The axes this module has no switcher for are read back and passed through unchanged, so
    // flipping the theme here never resets a person's contrast, scroll-edge or typeface choice.
    const { contrast, scrollEdgeHints, typeface } = readThemePreference();
    applyThemePreference(theme, mode, motion, density, contrast, scrollEdgeHints, typeface);
  }
</script>

<div class="flex flex-col gap-12">
  <div class="flex flex-col gap-8">
    <FieldLabel as="p">
      Theme
    </FieldLabel>
    <Select.Root
      type="single"
      items={THEMES}
      bind:value={
        () => theme,
        (next) => {
          theme = next as string;
          apply();
        }
      }
      allowDeselect={false}
    >
      <Select.Trigger aria-label="Theme" class="w-full">
        <Select.Value placeholder="Select a theme" />
      </Select.Trigger>
      <Select.Content>
        {#each THEMES as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex flex-col gap-8">
    <FieldLabel as="p">
      Mode
    </FieldLabel>
    <Select.Root
      type="single"
      items={MODES}
      bind:value={
        () => mode,
        (next) => {
          mode = next as Mode;
          apply();
        }
      }
      allowDeselect={false}
    >
      <Select.Trigger aria-label="Mode" class="w-full">
        <Select.Value placeholder="Select a mode" />
      </Select.Trigger>
      <Select.Content>
        {#each MODES as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex flex-col gap-8">
    <FieldLabel as="p">
      Density
    </FieldLabel>
    <Select.Root
      type="single"
      items={DENSITIES}
      bind:value={
        () => density,
        (next) => {
          density = next as DensityPreference;
          apply();
        }
      }
      allowDeselect={false}
    >
      <Select.Trigger aria-label="Density" class="w-full">
        <Select.Value placeholder="Select a density" />
      </Select.Trigger>
      <Select.Content>
        {#each DENSITIES as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex flex-col gap-8">
    <FieldLabel as="p">
      Motion
    </FieldLabel>
    <Select.Root
      type="single"
      items={MOTIONS}
      bind:value={
        () => motion,
        (next) => {
          motion = next as MotionPreference;
          apply();
        }
      }
      allowDeselect={false}
    >
      <Select.Trigger aria-label="Motion" class="w-full">
        <Select.Value placeholder="Select a motion level" />
      </Select.Trigger>
      <Select.Content>
        {#each MOTIONS as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <p class="text-xs text-text-muted">
    The real preference — the same seam Settings · Appearance writes, applied and persisted.
  </p>
</div>
